import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { GitHubStorage } from '../src/storage/github.js';
import { createFakeGitHub } from './fake-github.js';

const quiet = { warn() {}, error() {}, log() {} };
const bytes = (s) => new TextEncoder().encode(s);
const make = (gh, branch = 'main') =>
  new GitHubStorage({ token: gh.token, repo: gh.repo, branch, apiBase: 'https://api.test', fetch: gh.fetch, logger: quiet });

test('commit, get, list and delete files atomically', async () => {
  const gh = createFakeGitHub();
  const s = make(gh);
  assert.equal(await s.get('m/abc'), null);
  await s.commit([{ path: 'b/1/abc', data: bytes('content') }, { path: 'm/abc', data: bytes('meta') }], 'add');
  assert.deepEqual(await s.get('b/1/abc'), bytes('content'));
  assert.deepEqual(await s.get('m/abc'), bytes('meta'));
  assert.deepEqual((await s.list()).sort(), ['README.md', 'b/1/abc', 'm/abc']);

  assert.equal(await s.commit([{ path: 'b/1/abc', delete: true }, { path: 'm/abc', delete: true }], 'del'), true);
  assert.equal(await s.get('m/abc'), null);
  // Deleting again reports "already gone" instead of throwing.
  assert.equal(await s.commit([{ path: 'm/abc', delete: true }], 'del'), false);
});

test('handles binary data byte-for-byte', async () => {
  const gh = createFakeGitHub();
  const s = make(gh);
  const data = new Uint8Array(randomBytes(300_000));
  await s.commit([{ path: 'b/x', data }], 'bin');
  assert.deepEqual(await s.get('b/x'), data);
});

test('retries when another writer moves the branch (no lost updates)', async () => {
  const gh = createFakeGitHub();
  const s = make(gh);
  gh.state.beforeRefUpdate = () => gh.externalCommit('other.txt', 'concurrent');
  await s.commit([{ path: 'mine.txt', data: bytes('mine') }], 'add');
  const files = gh.filesOf();
  assert.equal(files.get('other.txt').toString(), 'concurrent');
  assert.equal(files.get('mine.txt').toString(), 'mine');
});

test('creates a missing storage branch as an orphan branch', async () => {
  const gh = createFakeGitHub();
  const s = make(gh, 'storage');
  await s.commit([{ path: 'f', data: bytes('x') }], 'add');
  assert.deepEqual(await s.get('f'), bytes('x'));
  assert.equal(gh.filesOf('main').has('f'), false);
});

test('initialises an empty repository', async () => {
  const gh = createFakeGitHub({ empty: true });
  const s = make(gh);
  await s.commit([{ path: 'f', data: bytes('x') }], 'add');
  assert.deepEqual(await s.get('f'), bytes('x'));
});

test('surfaces auth errors clearly', async () => {
  const gh = createFakeGitHub();
  const s = new GitHubStorage({ token: 'wrong', repo: gh.repo, apiBase: 'https://api.test', fetch: gh.fetch });
  await assert.rejects(s.commit([{ path: 'f', data: bytes('x') }], 'add'), /GitHub API 401/);
});
