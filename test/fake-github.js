// Minimal in-memory imitation of the GitHub REST endpoints GitHubStorage uses.
// Behaves like the real API for: refs, commits, trees (base_tree, sha: null
// deletions, inline content), blobs, raw contents and empty repositories.
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

export function createFakeGitHub({ repo = 'owner/store', token = 'test-token', empty = false } = {}) {
  const blobs = new Map(); // sha -> Buffer
  const trees = new Map(); // sha -> Map(path -> blobSha)
  const commits = new Map(); // sha -> { tree, parents }
  const refs = new Map(); // 'heads/main' -> commit sha
  const state = { calls: [], beforeRefUpdate: null, isEmpty: empty };

  const newSha = () => randomBytes(20).toString('hex');
  const blobSha = (buf) => createHash('sha1').update(buf).digest('hex');
  const res = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  function putBlob(buf) {
    const sha = blobSha(buf);
    blobs.set(sha, buf);
    return sha;
  }

  function makeCommit(files, parents) {
    const treeSha = newSha();
    trees.set(treeSha, new Map(files));
    const sha = newSha();
    commits.set(sha, { tree: treeSha, parents });
    return sha;
  }

  if (!empty) refs.set('heads/main', makeCommit([['README.md', putBlob(Buffer.from('hi'))]], []));

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const headers = init.headers || {};
    state.calls.push(`${method} ${u.pathname}`);
    if (headers.Authorization !== `Bearer ${token}`) return res(401, { message: 'Bad credentials' });
    if (!headers['User-Agent']) return res(403, { message: 'User-Agent required' });
    const prefix = `/repos/${repo}`;
    if (!u.pathname.startsWith(prefix)) return res(404, { message: 'Not Found' });
    const path = decodeURIComponent(u.pathname.slice(prefix.length));
    const body = init.body ? JSON.parse(init.body) : undefined;
    let m;

    if (state.isEmpty && path.startsWith('/git/')) return res(409, { message: 'Git Repository is empty.' });

    if (method === 'GET' && (m = /^\/git\/ref\/(heads\/.+)$/.exec(path))) {
      const sha = refs.get(m[1]);
      return sha ? res(200, { ref: `refs/${m[1]}`, object: { sha, type: 'commit' } }) : res(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const c = commits.get(m[1]);
      return c ? res(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : res(404, {});
    }
    if (method === 'POST' && path === '/git/blobs') {
      if (body.encoding !== 'base64') return res(422, { message: 'bad encoding' });
      return res(201, { sha: putBlob(Buffer.from(body.content, 'base64')) });
    }
    if (method === 'POST' && path === '/git/trees') {
      const files = body.base_tree ? new Map(trees.get(body.base_tree)) : new Map();
      if (body.base_tree && !trees.has(body.base_tree)) return res(422, { message: 'base_tree not found' });
      for (const e of body.tree) {
        if (e.sha === null) {
          if (!files.has(e.path)) return res(422, { message: `path ${e.path} does not exist` });
          files.delete(e.path);
        } else if (typeof e.content === 'string') {
          files.set(e.path, putBlob(Buffer.from(e.content)));
        } else {
          if (!blobs.has(e.sha)) return res(422, { message: 'blob not found' });
          files.set(e.path, e.sha);
        }
      }
      const sha = newSha();
      trees.set(sha, files);
      return res(201, { sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      if (!trees.has(body.tree)) return res(422, { message: 'tree not found' });
      const sha = newSha();
      commits.set(sha, { tree: body.tree, parents: body.parents });
      return res(201, { sha });
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/(heads\/.+)$/.exec(path))) {
      if (state.beforeRefUpdate) {
        const hook = state.beforeRefUpdate;
        state.beforeRefUpdate = null;
        await hook();
      }
      const current = refs.get(m[1]);
      if (!current) return res(422, { message: 'Reference does not exist' });
      const c = commits.get(body.sha);
      if (!body.force && !c.parents.includes(current)) return res(422, { message: 'Update is not a fast forward' });
      refs.set(m[1], body.sha);
      return res(200, { object: { sha: body.sha } });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace(/^refs\//, '');
      if (refs.has(name)) return res(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return res(201, {});
    }
    if (method === 'GET' && (m = /^\/git\/trees\/(\w+)$/.exec(path))) {
      const files = trees.get(m[1]);
      if (!files) return res(404, {});
      return res(200, { sha: m[1], truncated: false, tree: [...files].map(([p, sha]) => ({ path: p, type: 'blob', sha })) });
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      if (state.isEmpty) return res(404, { message: 'This repository is empty.' });
      const ref = u.searchParams.get('ref') || 'main';
      const commitSha = refs.get(`heads/${ref}`);
      if (!commitSha) return res(404, { message: 'No commit found for the ref' });
      const blob = trees.get(commits.get(commitSha).tree).get(m[1]);
      if (!blob) return res(404, { message: 'Not Found' });
      if (headers.Accept !== 'application/vnd.github.raw+json') return res(415, {});
      return new Response(blobs.get(blob), { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } });
    }
    if (method === 'PUT' && (m = /^\/contents\/(.+)$/.exec(path))) {
      if (!state.isEmpty) return res(422, { message: 'sha wasn\'t supplied' });
      state.isEmpty = false;
      refs.set('heads/main', makeCommit([[m[1], putBlob(Buffer.from(body.content, 'base64'))]], []));
      return res(201, {});
    }
    return res(404, { message: `fake: unhandled ${method} ${path}` });
  }

  function filesOf(branch = 'main') {
    const sha = refs.get(`heads/${branch}`);
    if (!sha) return null;
    const files = trees.get(commits.get(sha).tree);
    return new Map([...files].map(([p, b]) => [p, blobs.get(b)]));
  }

  // Simulates another writer committing to the branch.
  function externalCommit(path, content, branch = 'main') {
    const parent = refs.get(`heads/${branch}`);
    const files = new Map(trees.get(commits.get(parent).tree));
    files.set(path, putBlob(Buffer.from(content)));
    refs.set(`heads/${branch}`, makeCommit(files, [parent]));
  }

  return { fetch: fetchImpl, state, refs, filesOf, externalCommit, repo, token };
}
