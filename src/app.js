// Core HTTP handler. Uses only web-standard APIs (Request, Response, crypto)
// so it can run unchanged on Node.js (see server.js) and Cloudflare Workers
// (see worker.js).
//
// Storage layout (inside the GitHub repo), where h = HMAC(masterKey, id):
//   m/<h>           encrypted JSON metadata (name, type, size, expiry, ...)
//   b/<exp>/<h>     encrypted file content; <exp> = unix expiry time so the
//                   cleanup job can find expired files from one tree listing.
import { EXPIRY_OPTIONS } from './config.js';
import { createKeyring, decrypt, encrypt, randomId, randomToken, safeEqual, sha256Hex } from './crypto.js';
import { RateLimiter } from './ratelimit.js';

const te = new TextEncoder();
const td = new TextDecoder();

const ID_RE = /^[0-9A-Za-z]{5,16}$/;
// Client-side (password) encryption format, see public/app.js:
// "SFE1" | iterations u32 | salt 16 | iv 12 | ciphertext (+16 byte tag)
const E2E_MAGIC = [0x53, 0x46, 0x45, 0x31];
const E2E_MIN_SIZE = 4 + 4 + 16 + 12 + 16 + 4;
const E2E_OVERHEAD = 64 * 1024; // header + tag + encrypted name/type
const RECENTLY_DELETED_MS = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const metaPath = (h) => `m/${h}`;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function text(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function flag(v) {
  return v != null && ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

// Removes control characters, bidi overrides (used for "exe.txt" spoofing),
// and path separators; caps length while keeping the extension.
export function sanitizeName(raw) {
  let n = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  if (!n || /^\.+$/.test(n)) n = 'file';
  if (n.length > 200) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : '';
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}

function sanitizeType(raw) {
  const t = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][\w.+-]{0,63}\/[\w.+-]{1,100}$/.test(t) ? t : 'application/octet-stream';
}

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function readLimited(request, max) {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > max) throw new HttpError(413, 'too_large', 'File is too large');
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, 'too_large', 'File is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
    "manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // Never leak share links to third parties through the Referer header.
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function createApp({ config, storage, assets, now = () => Date.now(), logger = console }) {
  const keyringPromise = createKeyring(config.masterKey);
  const limiter = new RateLimiter(now);
  const inFlightBurns = new Set();
  const recentlyDeleted = new Map(); // h -> until (guards against stale reads)

  const publicConfig = {
    maxFileSize: config.maxFileSize,
    expiries: config.expiries,
    defaultExpiry: config.defaultExpiry,
    uploadAuth: Boolean(config.uploadToken),
  };

  function limit(key, max) {
    const retry = limiter.hit(key, max);
    if (retry) {
      throw new HttpError(429, 'rate_limited', 'Too many requests, slow down', { 'Retry-After': String(retry) });
    }
  }

  function baseUrl(url) {
    return config.publicUrl || url.origin;
  }

  // Blocks cross-site browser requests (CSRF). Non-browser clients such as
  // curl send no Origin header and are allowed.
  function checkOrigin(request, url) {
    const origin = request.headers.get('origin');
    if (!origin) return;
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
    }
    const allowed = [url.host, config.publicUrl && new URL(config.publicUrl).host];
    if (!allowed.includes(host)) throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
  }

  function bearer(request) {
    const auth = request.headers.get('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    return m ? m[1].trim() : '';
  }

  async function removeFiles(h, meta, reason) {
    recentlyDeleted.set(h, now() + RECENTLY_DELETED_MS);
    await storage.commit(
      [
        { path: metaPath(h), delete: true },
        { path: meta.blob, delete: true },
      ],
      `${reason} ${h.slice(0, 8)}`,
    );
  }

  async function lookup(id, ctx) {
    const notFound = () => {
      limiter.hit(`nf:${ctx.ip}`, Infinity);
      return new HttpError(404, 'not_found', 'File not found or expired');
    };
    if (!ID_RE.test(id)) throw notFound();
    limit(`rq:${ctx.ip}`, config.rateRequests);
    // Too many misses from one client looks like link guessing.
    const retry = limiter.check(`nf:${ctx.ip}`, config.rateNotFound);
    if (retry) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down', { 'Retry-After': String(retry) });

    const keyring = await keyringPromise;
    const h = await keyring.pathHash(id);
    const deletedUntil = recentlyDeleted.get(h);
    if (deletedUntil && deletedUntil > now()) throw notFound();

    const raw = await storage.get(metaPath(h));
    if (!raw) throw notFound();
    const key = await keyring.fileKey(id);
    let meta;
    try {
      meta = JSON.parse(td.decode(await decrypt(key, raw, te.encode(`meta:${h}`))));
    } catch {
      throw notFound();
    }
    if (meta.exp * 1000 <= now()) {
      ctx.waitUntil(removeFiles(h, meta, 'expire').catch((e) => logger.error('[expire]', e)));
      throw notFound();
    }
    return { id, h, key, meta };
  }

  function publicInfo(f) {
    const m = f.meta;
    return {
      id: f.id,
      name: m.name,
      type: m.type,
      size: m.size,
      createdAt: new Date(m.created * 1000).toISOString(),
      expiresAt: new Date(m.exp * 1000).toISOString(),
      burn: m.burn,
      e2e: m.e2e,
    };
  }

  async function upload(request, url, ctx, pathName) {
    checkOrigin(request, url);
    limit(`up:${ctx.ip}`, config.rateUploads);
    if (config.uploadToken) {
      const token = bearer(request) || request.headers.get('x-upload-token') || '';
      if (!token || !(await safeEqual(token, config.uploadToken))) {
        throw new HttpError(401, 'unauthorized', 'A valid upload key is required');
      }
    }

    const q = url.searchParams;
    const e2e = flag(q.get('e2e') ?? request.headers.get('x-e2e'));
    const burn = flag(q.get('burn') ?? request.headers.get('x-burn'));
    const expKey = q.get('expires') ?? request.headers.get('x-expires') ?? config.defaultExpiry;
    if (!config.expiries.includes(expKey)) {
      throw new HttpError(400, 'bad_expiry', `expires must be one of: ${config.expiries.join(', ')}`);
    }
    let rawName = q.get('name');
    if (rawName == null && request.headers.get('x-file-name')) {
      try {
        rawName = decodeURIComponent(request.headers.get('x-file-name'));
      } catch {
        throw new HttpError(400, 'bad_name', 'X-File-Name must be URI-encoded');
      }
    }
    const name = sanitizeName(rawName ?? pathName ?? 'file');
    const type = sanitizeType(request.headers.get('content-type'));

    const data = await readLimited(request, config.maxFileSize + (e2e ? E2E_OVERHEAD : 0));
    if (data.length === 0) throw new HttpError(400, 'empty', 'File is empty');
    if (e2e && (data.length < E2E_MIN_SIZE || E2E_MAGIC.some((b, i) => data[i] !== b))) {
      throw new HttpError(400, 'bad_e2e', 'Invalid encrypted payload');
    }

    const keyring = await keyringPromise;
    let id;
    let h;
    for (let attempt = 0; ; attempt++) {
      id = randomId(config.idLength);
      h = await keyring.pathHash(id);
      if (!(await storage.get(metaPath(h)))) break;
      if (attempt >= 4) throw new HttpError(500, 'id_exhausted', 'Could not allocate a link, try again');
    }

    const created = Math.floor(now() / 1000);
    const exp = created + EXPIRY_OPTIONS[expKey];
    const deleteToken = randomToken(16);
    const meta = {
      v: 1,
      name: e2e ? null : name,
      type: e2e ? 'application/octet-stream' : type,
      size: data.length,
      created,
      exp,
      burn,
      e2e,
      del: await sha256Hex(deleteToken),
      blob: `b/${exp}/${h}`,
    };
    const key = await keyring.fileKey(id);
    const encBlob = await encrypt(key, data, te.encode(`blob:${h}`));
    const encMeta = await encrypt(key, te.encode(JSON.stringify(meta)), te.encode(`meta:${h}`));
    await storage.commit(
      [
        { path: meta.blob, data: encBlob },
        { path: metaPath(h), data: encMeta },
      ],
      `add ${h.slice(0, 8)}`,
    );

    const base = baseUrl(url);
    const result = {
      id,
      url: `${base}/${id}`,
      download: `${base}/${id}/dl`,
      name: meta.name,
      size: meta.size,
      expiresAt: new Date(exp * 1000).toISOString(),
      burn,
      e2e,
      deleteToken,
      deleteUrl: `${base}/api/file/${id}`,
    };
    const ua = request.headers.get('user-agent') || '';
    if (q.get('format') === 'text' || (q.get('format') !== 'json' && /^(curl|wget)\//i.test(ua))) {
      return text(`${result.url}\n`, 201, { 'X-Delete-Token': deleteToken, 'X-Expires-At': result.expiresAt });
    }
    return json(result, 201);
  }

  async function download(id, request, ctx) {
    const f = await lookup(id, ctx);
    const name = f.meta.e2e ? `${id}.sfe` : f.meta.name;
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(name),
      'Content-Length': String(f.meta.size),
      'Cache-Control': 'no-store',
      // Downloaded bytes are never rendered as a page on our origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    // HEAD never consumes a burn-after-download file (link previewers use it).
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

    if (f.meta.burn) {
      if (inFlightBurns.has(f.h)) throw new HttpError(404, 'not_found', 'File not found or expired');
      inFlightBurns.add(f.h);
    }
    try {
      const raw = await storage.get(f.meta.blob);
      if (!raw) throw new HttpError(404, 'not_found', 'File not found or expired');
      const data = await decrypt(f.key, raw, te.encode(`blob:${f.h}`));
      if (f.meta.burn) {
        // Delete before sending: if deletion fails the file is not served.
        try {
          await removeFiles(f.h, f.meta, 'burn');
        } catch (err) {
          recentlyDeleted.delete(f.h);
          throw err;
        }
      }
      return new Response(data, { status: 200, headers });
    } finally {
      inFlightBurns.delete(f.h);
    }
  }

  async function remove(id, request, url, ctx) {
    checkOrigin(request, url);
    const token = bearer(request);
    const f = await lookup(id, ctx);
    if (!token || !(await safeEqual(await sha256Hex(token), f.meta.del))) {
      limiter.hit(`nf:${ctx.ip}`, Infinity);
      throw new HttpError(403, 'forbidden', 'Invalid delete token');
    }
    await removeFiles(f.h, f.meta, 'delete');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  function serveAsset(asset, request, url) {
    const headers = { 'Content-Type': asset.type, ETag: asset.etag };
    if (asset.immutable && url.searchParams.get('v') === asset.hash) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = asset.html ? 'no-cache' : 'public, max-age=300';
    }
    if (request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
  }

  async function route(request, ctx) {
    const url = new URL(request.url);
    const { pathname: path } = url;
    const method = request.method;
    const isGet = method === 'GET' || method === 'HEAD';

    if (isGet && assets[path]) return serveAsset(assets[path], request, url);

    if (path === '/api/config') {
      if (!isGet) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
      return json(publicConfig);
    }

    if (path === '/api/upload' || path.startsWith('/api/upload/')) {
      if (method !== 'POST' && method !== 'PUT') throw new HttpError(405, 'method_not_allowed', 'Use POST or PUT');
      let pathName;
      if (path.length > '/api/upload/'.length) {
        try {
          pathName = decodeURIComponent(path.slice('/api/upload/'.length));
        } catch {
          throw new HttpError(400, 'bad_name', 'Bad file name');
        }
      }
      return upload(request, url, ctx, pathName);
    }

    let m = /^\/api\/file\/([^/]+)$/.exec(path);
    if (m) {
      if (isGet) return json(publicInfo(await lookup(m[1], ctx)));
      if (method === 'DELETE') return remove(m[1], request, url, ctx);
      throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
    }

    m = /^\/([0-9A-Za-z]{5,16})(\/dl)?\/?$/.exec(path);
    if (m && isGet) {
      if (m[2]) return download(m[1], request, ctx);
      return serveAsset(assets['/'], request, url); // the client renders the download view
    }

    throw new HttpError(404, 'not_found', 'Not found');
  }

  async function handle(request, ctx = {}) {
    const fullCtx = {
      ip: ctx.ip || 'unknown',
      waitUntil: ctx.waitUntil || ((p) => p.catch?.(() => {})),
    };
    let response;
    try {
      response = await route(request, fullCtx);
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.code, message: err.message }, err.status, err.headers);
      } else {
        logger.error('[error]', err);
        response = json({ error: 'internal', message: 'Something went wrong, please try again' }, 500);
      }
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    if (new URL(request.url).protocol === 'https:' || config.publicUrl?.startsWith('https:')) {
      headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    return new Response(response.body, { status: response.status, headers });
  }

  // Deletes every expired file in a single commit. Run periodically.
  async function cleanup() {
    const paths = await storage.list();
    const existing = new Set(paths);
    const nowSec = Math.floor(now() / 1000);
    const changes = [];
    for (const p of paths) {
      const m = /^b\/(\d+)\/([0-9a-f]{32})$/.exec(p);
      if (m && Number(m[1]) <= nowSec) {
        changes.push({ path: p, delete: true });
        if (existing.has(metaPath(m[2]))) changes.push({ path: metaPath(m[2]), delete: true });
      }
    }
    for (let i = 0; i < changes.length; i += 400) {
      const batch = changes.slice(i, i + 400);
      await storage.commit(batch, `cleanup ${batch.length} expired objects`);
    }
    return changes.length;
  }

  return { fetch: handle, cleanup };
}
