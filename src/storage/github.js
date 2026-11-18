// Stores files in a GitHub repository using the Git Data API.
// Every change (upload, delete, cleanup) is a single atomic commit, retried
// automatically when another request moved the branch in the meantime.
import { Buffer } from 'node:buffer';

export class GitHubError extends Error {
  constructor(status, message) {
    super(`GitHub API ${status}: ${message}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHubStorage {
  constructor({ token, repo, branch = 'main', apiBase = 'https://api.github.com', fetch: fetchImpl, logger = console }) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.apiBase = apiBase;
    this.fetch = fetchImpl || ((...args) => fetch(...args));
    this.logger = logger;
  }

  async request(method, path, { body, accept = 'application/vnd.github+json' } = {}) {
    const url = `${this.apiBase}/repos/${this.repo}${path}`;
    const init = {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'share-file',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    // Retry transient failures. Every call we make is idempotent (git objects
    // are content-addressed, ref updates are compare-and-swap).
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(url, init);
      } catch (err) {
        if (attempt >= 2) throw err;
        await sleep(300 * 2 ** attempt);
        continue;
      }
      if ([500, 502, 503, 504].includes(res.status) && attempt < 2) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      return res;
    }
  }

  async json(method, path, body, expected = [200]) {
    const res = await this.request(method, path, { body });
    if (!expected.includes(res.status)) {
      let message = res.statusText;
      try {
        message = (await res.json()).message || message;
      } catch {
        /* ignore */
      }
      throw new GitHubError(res.status, message);
    }
    return res.json();
  }

  get refPath() {
    return `/git/refs/heads/${encodePath(this.branch)}`;
  }

  // Returns { commitSha, treeSha } for the head of the storage branch,
  // creating the branch (or initialising an empty repository) if needed.
  async head() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.request('GET', `/git/ref/heads/${encodePath(this.branch)}`);
      if (res.ok) {
        const ref = await res.json();
        const commitSha = ref.object.sha;
        const commit = await this.json('GET', `/git/commits/${commitSha}`);
        return { commitSha, treeSha: commit.tree.sha };
      }
      if (res.status === 409) {
        // Empty repository: the Git Data API needs at least one commit.
        await this.json(
          'PUT',
          '/contents/README.md',
          {
            message: 'Initialize share-file storage',
            content: Buffer.from('# share-file storage\n\nEncrypted files. Do not edit by hand.\n').toString('base64'),
          },
          [200, 201, 422],
        );
        continue;
      }
      if (res.status === 404) {
        await this.createBranch();
        continue;
      }
      throw new GitHubError(res.status, 'could not read storage branch');
    }
    throw new GitHubError(404, `branch "${this.branch}" not found and could not be created (check GITHUB_REPO and token permissions)`);
  }

  // Creates the storage branch as an orphan branch so it shares no history
  // with the code.
  async createBranch() {
    const tree = await this.json(
      'POST',
      '/git/trees',
      { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: '# share-file storage\n\nEncrypted files. Do not edit by hand.\n' }] },
      [201],
    );
    const commit = await this.json(
      'POST',
      '/git/commits',
      { message: 'Initialize share-file storage', tree: tree.sha, parents: [] },
      [201],
    );
    const res = await this.request('POST', '/git/refs', {
      body: { ref: `refs/heads/${this.branch}`, sha: commit.sha },
    });
    if (!res.ok && res.status !== 422 /* already exists (race) */) {
      throw new GitHubError(res.status, 'could not create storage branch');
    }
  }

  async get(path) {
    const res = await this.request('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`, {
      accept: 'application/vnd.github.raw+json',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, `could not read ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async list() {
    const { treeSha } = await this.head();
    const tree = await this.json('GET', `/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) this.logger.warn('[storage] tree listing truncated; cleanup will be partial');
    return tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
  }

  // changes: [{ path, data: Uint8Array } | { path, delete: true }]
  // Returns true when committed, false when a delete-only change found the
  // files already gone.
  async commit(changes, message) {
    // Resolving the head first also initialises an empty repo / missing
    // branch, which must happen before blobs can be created.
    let head = await this.head();
    const entries = [];
    for (const c of changes) {
      if (c.delete) {
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      } else {
        const data = c.data;
        const blob = await this.json(
          'POST',
          '/git/blobs',
          { content: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'), encoding: 'base64' },
          [201],
        );
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    const deleteOnly = entries.every((e) => e.sha === null);

    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) head = await this.head();
      let tree;
      try {
        tree = await this.json('POST', '/git/trees', { base_tree: head.treeSha, tree: entries }, [201]);
      } catch (err) {
        if (deleteOnly && err.status === 422) return false; // already deleted
        throw err;
      }
      const commit = await this.json(
        'POST',
        '/git/commits',
        { message, tree: tree.sha, parents: [head.commitSha] },
        [201],
      );
      const res = await this.request('PATCH', this.refPath, { body: { sha: commit.sha, force: false } });
      if (res.ok) return true;
      if (res.status !== 422 && res.status !== 409) {
        throw new GitHubError(res.status, 'could not update storage branch');
      }
      // Branch moved under us (concurrent upload); rebuild on the new head.
      await sleep(100 + Math.random() * 200 * (attempt + 1));
    }
    throw new GitHubError(409, 'too many concurrent updates, try again');
  }
}
