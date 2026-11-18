// Runtime configuration, read from environment variables (Node: process.env,
// Cloudflare Workers: the `env` binding). Every option is validated up front so
// a misconfigured deployment fails loudly instead of behaving insecurely.

export const EXPIRY_OPTIONS = Object.freeze({
  '1h': 60 * 60,
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
});

const MB = 1024 * 1024;

function str(env, key, fallback = '') {
  const v = env[key];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim();
}

function int(env, key, fallback, min, max) {
  const raw = str(env, key, '');
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

function bool(env, key, fallback = false) {
  const raw = str(env, key, '').toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export function loadConfig(env = {}) {
  const storage = str(env, 'STORAGE', 'github').toLowerCase();
  if (!['github', 'memory'].includes(storage)) {
    throw new Error(`STORAGE must be "github" or "memory" (got "${storage}")`);
  }

  const masterKey = str(env, 'MASTER_KEY');
  if (masterKey.length < 32) {
    throw new Error('MASTER_KEY is required and must be at least 32 characters. Generate one with: npm run keygen');
  }

  const githubRepo = str(env, 'GITHUB_REPO');
  const githubToken = str(env, 'GITHUB_TOKEN');
  if (storage === 'github') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) {
      throw new Error('GITHUB_REPO must look like "owner/repo"');
    }
    if (!githubToken) throw new Error('GITHUB_TOKEN is required when STORAGE=github');
  }

  const maxExpiry = str(env, 'MAX_EXPIRY', '30d');
  if (!(maxExpiry in EXPIRY_OPTIONS)) {
    throw new Error(`MAX_EXPIRY must be one of ${Object.keys(EXPIRY_OPTIONS).join(', ')}`);
  }
  const expiries = Object.keys(EXPIRY_OPTIONS).filter((k) => EXPIRY_OPTIONS[k] <= EXPIRY_OPTIONS[maxExpiry]);
  let defaultExpiry = str(env, 'DEFAULT_EXPIRY', '1d');
  if (!expiries.includes(defaultExpiry)) defaultExpiry = expiries[expiries.length - 1];

  let publicUrl = str(env, 'PUBLIC_URL');
  if (publicUrl) {
    const u = new URL(publicUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('PUBLIC_URL must be http(s)');
    publicUrl = u.origin;
  }

  const uploadToken = str(env, 'UPLOAD_TOKEN');
  if (uploadToken && uploadToken.length < 8) throw new Error('UPLOAD_TOKEN must be at least 8 characters');

  return Object.freeze({
    storage,
    masterKey,
    githubRepo,
    githubToken,
    githubBranch: str(env, 'GITHUB_BRANCH', 'main'),
    githubApi: str(env, 'GITHUB_API_URL', 'https://api.github.com').replace(/\/+$/, ''),
    // 7 base62 chars = 62^7 ≈ 3.5 trillion combinations (~41.7 bits).
    idLength: int(env, 'ID_LENGTH', 7, 5, 16),
    // GitHub's API accepts blobs up to 100 MB; Workers have a 128 MB memory cap,
    // so keep the default comfortably small.
    maxFileSize: int(env, 'MAX_FILE_SIZE_MB', 20, 1, 50) * MB,
    expiries,
    defaultExpiry,
    uploadToken,
    publicUrl,
    trustProxy: bool(env, 'TRUST_PROXY'),
    rateUploads: int(env, 'RATE_LIMIT_UPLOADS', 10, 1, 10000),
    rateRequests: int(env, 'RATE_LIMIT_REQUESTS', 120, 1, 100000),
    rateNotFound: int(env, 'RATE_LIMIT_NOT_FOUND', 20, 1, 10000),
  });
}
