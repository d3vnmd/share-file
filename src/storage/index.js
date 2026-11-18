import { GitHubStorage } from './github.js';
import { MemoryStorage } from './memory.js';

export function createStorage(config, { logger = console } = {}) {
  if (config.storage === 'memory') return new MemoryStorage();
  return new GitHubStorage({
    token: config.githubToken,
    repo: config.githubRepo,
    branch: config.githubBranch,
    apiBase: config.githubApi,
    logger,
  });
}
