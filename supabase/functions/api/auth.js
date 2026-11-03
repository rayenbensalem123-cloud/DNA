// Password hashing and signed tokens, using only Web Crypto so the same code runs
// in Supabase Edge Functions (Deno) and in Node 18+.
const webcrypto = globalThis.crypto ?? (await import('node:crypto')).webcrypto;
const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 210000;

const toB64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function randomHex(bytes = 16) {
  return Array.from(webcrypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password, salt, iterations) {
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Format: pbkdf2$<iterations>$<salt base64>$<hash base64> */
export async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export function needsRehash(stored) {
  return !String(stored).startsWith('pbkdf2$') || Number(String(stored).split('$')[1]) < PBKDF2_ITERATIONS;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const hash = await pbkdf2(password, fromB64(parts[2]), Number(parts[1]));
    return bytesEqual(hash, fromB64(parts[3]));
  }
  if (parts[0] === 'scrypt' && parts.length === 3) {
    // Accounts created by the first local version (scrypt). Upgraded to pbkdf2 on the next login.
    const { scryptSync, timingSafeEqual } = await import('node:crypto');
    const hash = scryptSync(password, parts[1], 64);
    const expected = Uint8Array.from(parts[2].match(/../g) || [], (h) => parseInt(h, 16));
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  }
  return false;
}

async function hmacKey(secret) {
  return subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256). `exp` (ms since epoch) is required. */
export async function signToken(payload, secret) {
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${toB64Url(sig)}`;
}

export async function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await subtle.verify('HMAC', await hmacKey(secret), fromB64Url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64Url(body)));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
