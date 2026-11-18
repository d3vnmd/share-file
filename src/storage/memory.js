// In-memory storage for local development and tests. Data is lost on restart.
export class MemoryStorage {
  constructor() {
    this.files = new Map();
    this.commits = [];
  }

  async get(path) {
    const v = this.files.get(path);
    return v ? v.slice() : null;
  }

  async list() {
    return [...this.files.keys()];
  }

  async commit(changes, message) {
    if (changes.every((c) => c.delete) && !changes.some((c) => this.files.has(c.path))) return false;
    for (const c of changes) {
      if (c.delete) this.files.delete(c.path);
      else this.files.set(c.path, c.data.slice());
    }
    this.commits.push(message);
    return true;
  }
}
