// Server-side cryptography. Only Web Crypto APIs are used so the same code runs
// on Node.js (>= 20) and Cloudflare Workers.
//
// Key hierarchy (everything derived from MASTER_KEY with HKDF-SHA256):
//   pathKey            -> HMAC-SHA256(id) = storage path of a file.
//                         The short link id never appears in the repository,
//                         so reading the repo does not reveal any links.
//   fileKey(id)        -> AES-256-GCM key, unique per file. Both the metadata
//                         (name, type, ...) and the content are encrypted.
// Without the master key AND the link id, stored data is unreadable.

const te = new TextEncoder();
const SALT = te.encode('share-file/v1');
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const IV_LENGTH = 12;

export function randomId(length) {
  // Rejection sampling: 248 = 62 * 4, so values < 248 map uniformly onto the
  // alphabet without modulo bias.
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < 248) {
        out += ALPHABET[b % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(byteLength = 16) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', te.encode(text)));
}

// Constant-time string comparison (hash both sides first so lengths match).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', te.encode(String(a))),
    crypto.subtle.digest('SHA-256', te.encode(String(b))),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

export async function createKeyring(masterKey) {
  const ikm = await crypto.subtle.importKey('raw', te.encode(masterKey), 'HKDF', false, ['deriveKey']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode(info) });

  const pathKey = await crypto.subtle.deriveKey(
    hkdf('path-hmac'),
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );

  return {
    // 128-bit hex digest used as the storage path component.
    async pathHash(id) {
      const sig = await crypto.subtle.sign('HMAC', pathKey, te.encode(id));
      return toHex(sig).slice(0, 32);
    },
    async fileKey(id) {
      return crypto.subtle.deriveKey(hkdf(`file:${id}`), ikm, { name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
    },
  };
}

// Output format: iv (12 bytes) || ciphertext+tag
export async function encrypt(key, data, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data));
  const out = new Uint8Array(IV_LENGTH + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LENGTH);
  return out;
}

export async function decrypt(key, blob, aad) {
  if (blob.length < IV_LENGTH + 16) throw new Error('ciphertext too short');
  const iv = blob.subarray(0, IV_LENGTH);
  const ct = blob.subarray(IV_LENGTH);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct));
}
