import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assets } from '../src/assets.generated.js';
import { createApp, sanitizeName } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { GitHubStorage } from '../src/storage/github.js';
import { createFakeGitHub } from './fake-github.js';

const MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnop';
const quiet = { warn() {}, error() {}, log() {} };
const BASE = 'https://share.test';

function setup(env = {}, { storage = new MemoryStorage() } = {}) {
  const clock = { t: Date.UTC(2026, 0, 1) };
  const config = loadConfig({ STORAGE: 'memory', MASTER_KEY, ...env });
  const pending = [];
  const app = createApp({ config, storage, assets, now: () => clock.t, logger: quiet });
  const call = (path, init = {}, ip = '1.2.3.4') =>
    app.fetch(new Request(BASE + path, init), { ip, waitUntil: (p) => pending.push(p) });
  const upload = async (content = 'hello world', { query = 'expires=1d', headers = {}, ip } = {}) => {
    const res = await call(
      `/api/upload?${query}`,
      { method: 'POST', body: content, headers: { 'X-File-Name': encodeURIComponent('report.pdf'), 'Content-Type': 'application/pdf', ...headers } },
      ip,
    );
    return { res, body: res.status === 201 ? await res.json() : await res.json().catch(() => null) };
  };
  return { app, call, upload, storage, clock, config, pending };
}

test('upload returns a short random link; file and metadata round-trip', async () => {
  const { call, upload } = setup();
  const { res, body } = await upload('hello world');
  assert.equal(res.status, 201);
  assert.match(body.id, /^[0-9A-Za-z]{7}$/);
  assert.equal(body.url, `${BASE}/${body.id}`);
  assert.match(body.deleteToken, /^[\w-]{22}$/);

  const info = await (await call(`/api/file/${body.id}`)).json();
  assert.equal(info.name, 'report.pdf');
  assert.equal(info.type, 'application/pdf');
  assert.equal(info.size, 11);
  assert.equal(info.burn, false);

  const dl = await call(`/${body.id}/dl`);
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), 'hello world');
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename="report\.pdf"; filename\*=UTF-8''report\.pdf$/);
  assert.equal(dl.headers.get('cache-control'), 'no-store');
  assert.match(dl.headers.get('content-security-policy'), /sandbox/);

  // The share page itself is the app HTML.
  const page = await call(`/${body.id}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
});

test('ids are unique and use the configured length', async () => {
  const { upload } = setup({ ID_LENGTH: '6', RATE_LIMIT_UPLOADS: '1000' });
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add((await upload(`f${i}`)).body.id);
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9A-Za-z]{6}$/);
});

test('stored data is encrypted and never reveals the link id or file name', async () => {
  const { upload, storage } = setup();
  const secret = 'TOP-SECRET-CONTENT-1234567890';
  const { body } = await upload(secret);
  assert.equal(storage.files.size, 2);
  for (const [path, data] of storage.files) {
    assert.ok(!path.includes(body.id), 'path must not contain the id');
    const asText = Buffer.from(data).toString('latin1');
    assert.ok(!asText.includes(secret), 'content must be encrypted');
    assert.ok(!asText.includes('report.pdf'), 'name must be encrypted');
  }
  assert.ok([...storage.files.keys()].every((p) => /^(m\/[0-9a-f]{32}|b\/\d+\/[0-9a-f]{32})$/.test(p)));
});

test('unknown, malformed and tampered links return 404', async () => {
  const { call, upload, storage } = setup();
  assert.equal((await call('/api/file/AAAAAAA')).status, 404);
  assert.equal((await call('/AAAAAAA/dl')).status, 404);
  assert.equal((await call('/api/file/..%2F..%2Fetc')).status, 404);
  assert.equal((await call('/not-a-valid-id!')).status, 404);

  const { body } = await upload();
  for (const [path, data] of storage.files) {
    data[data.length - 1] ^= 1; // flip a bit: authenticated encryption must reject it
    storage.files.set(path, data);
  }
  assert.equal((await call(`/api/file/${body.id}`)).status, 404);
});

test('files expire', async () => {
  const { call, upload, clock, storage, pending } = setup();
  const { body } = await upload('x', { query: 'expires=1h' });
  clock.t += 59 * 60 * 1000;
  assert.equal((await call(`/api/file/${body.id}`)).status, 200);
  clock.t += 2 * 60 * 1000;
  assert.equal((await call(`/api/file/${body.id}`)).status, 404);
  assert.equal((await call(`/${body.id}/dl`)).status, 404);
  await Promise.all(pending);
  assert.equal(storage.files.size, 0, 'expired file is removed on access');
});

test('cleanup removes only expired files', async () => {
  const { app, upload, clock, storage, call } = setup();
  await upload('a', { query: 'expires=1h' });
  await upload('b', { query: 'expires=1h' });
  const { body: keep } = await upload('c', { query: 'expires=7d' });
  clock.t += 2 * 60 * 60 * 1000;
  assert.equal(await app.cleanup(), 4);
  assert.equal(storage.files.size, 2);
  assert.equal(await (await call(`/${keep.id}/dl`)).text(), 'c');
  assert.equal(await app.cleanup(), 0);
});

test('burn-after-download serves the file exactly once; HEAD does not consume it', async () => {
  const { call, upload, storage } = setup();
  const { body } = await upload('once', { query: 'expires=1d&burn=1' });
  assert.equal((await call(`/api/file/${body.id}`)).status, 200);
  assert.equal((await call(`/${body.id}/dl`, { method: 'HEAD' })).status, 200);
  const first = await call(`/${body.id}/dl`);
  assert.equal(await first.text(), 'once');
  assert.equal((await call(`/${body.id}/dl`)).status, 404);
  assert.equal(storage.files.size, 0);
});

test('owner can delete with the delete token; others cannot', async () => {
  const { call, upload } = setup();
  const { body } = await upload();
  const del = (token) => call(`/api/file/${body.id}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await del()).status, 403);
  assert.equal((await del('wrong-token-wrong-token')).status, 403);
  assert.equal((await del(body.deleteToken)).status, 204);
  assert.equal((await call(`/api/file/${body.id}`)).status, 404);
});

test('rejects oversized, empty and invalid uploads', async () => {
  const { upload } = setup({ MAX_FILE_SIZE_MB: '1' });
  const big = new Uint8Array(1024 * 1024 + 1);
  const r1 = await upload(big);
  assert.equal(r1.res.status, 413);
  assert.equal((await upload(new Uint8Array(1024 * 1024))).res.status, 201);
  assert.equal((await upload('')).res.status, 400);
  assert.equal((await upload('x', { query: 'expires=999d' })).res.status, 400);
  assert.equal((await upload('not encrypted', { query: 'e2e=1' })).body.error, 'bad_e2e');
});

test('size limit is enforced while streaming, even without Content-Length', async () => {
  const { app } = setup({ MAX_FILE_SIZE_MB: '1' });
  const chunk = new Uint8Array(256 * 1024);
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (sent++ < 10) c.enqueue(chunk);
      else c.close();
    },
  });
  const res = await app.fetch(new Request(`${BASE}/api/upload`, { method: 'POST', body: stream, duplex: 'half' }), {
    ip: 'x',
  });
  assert.equal(res.status, 413);
  assert.ok(sent < 10, 'stops reading once the limit is exceeded');
});

test('end-to-end encrypted uploads hide the name', async () => {
  const { call, upload } = setup();
  const payload = new Uint8Array(200);
  payload.set([0x53, 0x46, 0x45, 0x31]);
  const { body } = await upload(payload, { query: 'expires=1d&e2e=1' });
  const info = await (await call(`/api/file/${body.id}`)).json();
  assert.equal(info.e2e, true);
  assert.equal(info.name, null);
  const dl = await call(`/${body.id}/dl`);
  assert.match(dl.headers.get('content-disposition'), new RegExp(`${body.id}\\.sfe`));
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), payload);
});

test('upload key protects uploads when configured', async () => {
  const { upload, call } = setup({ UPLOAD_TOKEN: 'super-secret-key' });
  assert.equal((await (await call('/api/config')).json()).uploadAuth, true);
  assert.equal((await upload()).res.status, 401);
  assert.equal((await upload('x', { headers: { Authorization: 'Bearer nope-nope' } })).res.status, 401);
  assert.equal((await upload('x', { headers: { Authorization: 'Bearer super-secret-key' } })).res.status, 201);
  assert.equal((await upload('x', { headers: { 'X-Upload-Token': 'super-secret-key' } })).res.status, 201);
});

test('cross-site uploads and deletes are blocked (CSRF)', async () => {
  const { upload, call } = setup();
  assert.equal((await upload('x', { headers: { Origin: 'https://evil.example' } })).res.status, 403);
  assert.equal((await upload('x', { headers: { Origin: BASE } })).res.status, 201);
  const { body } = await upload();
  const res = await call(`/api/file/${body.id}`, {
    method: 'DELETE',
    headers: { Origin: 'https://evil.example', Authorization: `Bearer ${body.deleteToken}` },
  });
  assert.equal(res.status, 403);
});

test('rate limits uploads and link guessing per client', async () => {
  const { upload, call } = setup({ RATE_LIMIT_UPLOADS: '3', RATE_LIMIT_NOT_FOUND: '5' });
  for (let i = 0; i < 3; i++) assert.equal((await upload()).res.status, 201);
  const limited = await upload();
  assert.equal(limited.res.status, 429);
  assert.ok(Number(limited.res.headers.get('retry-after')) > 0);
  assert.equal((await upload('x', { ip: '9.9.9.9' })).res.status, 201, 'other clients unaffected');

  for (let i = 0; i < 5; i++) assert.equal((await call(`/api/file/Guess${i}xx`, {}, '5.5.5.5')).status, 404);
  assert.equal((await call('/api/file/Guess9xx', {}, '5.5.5.5')).status, 429);
});

test('security headers are set on every response', async () => {
  const { call } = setup();
  for (const path of ['/', '/api/config', '/nope', '/assets/app.js']) {
    const res = await call(path);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('strict-transport-security'), /max-age=/);
  }
});

test('curl gets a plain-text link', async () => {
  const { call } = setup();
  const res = await call('/api/upload/photo%20one.jpg', { method: 'PUT', body: 'img', headers: { 'User-Agent': 'curl/8.5.0' } });
  assert.equal(res.status, 201);
  const url = (await res.text()).trim();
  assert.match(url, /^https:\/\/share\.test\/[0-9A-Za-z]{7}$/);
  assert.ok(res.headers.get('x-delete-token'));
  const info = await (await call(`/api/file/${url.split('/').pop()}`)).json();
  assert.equal(info.name, 'photo one.jpg');
});

test('file names are sanitised', () => {
  assert.equal(sanitizeName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeName('evil‮txt.exe'), 'eviltxt.exe');
  assert.equal(sanitizeName('a\r\nb'), 'ab');
  assert.equal(sanitizeName(''), 'file');
  assert.equal(sanitizeName('..'), 'file');
  const long = sanitizeName(`${'x'.repeat(300)}.tar.gz`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.gz'));
});

test('config validation', () => {
  assert.throws(() => loadConfig({ STORAGE: 'memory' }), /MASTER_KEY/);
  assert.throws(() => loadConfig({ MASTER_KEY }), /GITHUB_REPO/);
  assert.throws(() => loadConfig({ MASTER_KEY, GITHUB_REPO: 'a/b' }), /GITHUB_TOKEN/);
  assert.throws(() => loadConfig({ STORAGE: 'memory', MASTER_KEY, ID_LENGTH: '3' }), /ID_LENGTH/);
  const c = loadConfig({ STORAGE: 'memory', MASTER_KEY, MAX_EXPIRY: '7d', DEFAULT_EXPIRY: '30d' });
  assert.deepEqual(c.expiries, ['1h', '1d', '7d']);
  assert.equal(c.defaultExpiry, '7d');
});

test('full flow against the (fake) GitHub API', async () => {
  const gh = createFakeGitHub();
  const storage = new GitHubStorage({ token: gh.token, repo: gh.repo, apiBase: 'https://api.test', fetch: gh.fetch, logger: quiet });
  const { call, upload, app, clock } = setup({}, { storage });
  const { body } = await upload('stored on github', { query: 'expires=1h' });
  assert.equal(await (await call(`/${body.id}/dl`)).text(), 'stored on github');
  assert.equal(gh.filesOf().size, 3); // README + meta + blob
  const { body: burn } = await upload('burn me', { query: 'expires=1d&burn=1' });
  assert.equal(await (await call(`/${burn.id}/dl`)).text(), 'burn me');
  assert.equal((await call(`/${burn.id}/dl`)).status, 404);
  clock.t += 2 * 60 * 60 * 1000;
  assert.equal(await app.cleanup(), 2);
  assert.deepEqual([...gh.filesOf().keys()], ['README.md']);
});
