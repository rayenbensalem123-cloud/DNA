import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const COMMITTEES = [
  { id: 'cna', nom: "Comité National d'Arbitrage" },
  { id: 'discipline', nom: 'Commission de Discipline' },
  { id: 'appel', nom: "Commission d'Appel" },
  { id: 'administration', nom: 'Administration' },
];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const hash = crypto.scryptSync(password, stored.salt, 64).toString('hex');
  const a = hash;
  const b = stored.hash;
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function seed() {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();

  // Official mode: a single administrator account, no demo data.
  // The password can be set once at install time via DNA_ADMIN_PASSWORD;
  // it should be changed from the Accounts page after the first login.
  const users = [
    {
      id: 'u1',
      username: 'admin',
      password: hashPassword(process.env.DNA_ADMIN_PASSWORD || 'admin'),
      name: 'Administrateur',
      role: 'admin',
      createdAt: iso(now),
    },
  ];

  return { users, letters: [], seq: 1 };
}

const DEMO_SIGNATURES = [
  { username: 'admin', name: 'Amira Benali' },
  { username: 'agent', name: 'Karim Bensaïd' },
  { username: 'lecture', name: 'Sara Oufkir' },
];

// The public demo build shipped with sample accounts and sample letters.
// When that data is detected on first boot of the official build, replace it
// with the official seed (single administrator, empty ledger).
function isDemoSeed(db) {
  if (!db || !Array.isArray(db.users)) return false;
  const isDemoUser = (signature) => db.users.some((u) => u.username === signature.username && u.name === signature.name);
  if (!DEMO_SIGNATURES.every(isDemoUser)) return false;
  const letters = Array.isArray(db.letters) ? db.letters : [];
  return letters.length <= 20;
}

function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.users)) { db.users = []; changed = true; }
  if (!Array.isArray(db.letters)) { db.letters = []; changed = true; }
  if (!Array.isArray(db.committees)) {
    db.committees = COMMITTEES.map((c) => ({ ...c }));
    changed = true;
  }
  if (!db.secret || typeof db.secret !== 'string' || db.secret.length < 32) {
    db.secret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  for (const l of db.letters) {
    if (l.numeroLettre === undefined) { l.numeroLettre = l.ref || ''; changed = true; }
    if (l.commission === undefined) { l.commission = null; changed = true; }
    if (!Array.isArray(l.commissionHisto)) { l.commissionHisto = []; changed = true; }
    if (Array.isArray(l.pieces)) {
      for (const p of l.pieces) {
        if (!p.id) { p.id = 'p' + Math.random().toString(36).slice(2, 10); changed = true; }
      }
    }
  }
  return changed;
}

let cache = null;
let dbRevision = null;
let sqlClient = null;

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for persistent storage');
  if (!sqlClient) {
    return import('@neondatabase/serverless').then(({ neon }) => {
      sqlClient = neon(process.env.DATABASE_URL);
      return sqlClient;
    });
  }
  return Promise.resolve(sqlClient);
}

export async function initializeDB() {
  if (!process.env.DATABASE_URL) {
    getDB();
    return;
  }
  const sql = await database();
  await sql`CREATE TABLE IF NOT EXISTS dna_app_state (id text PRIMARY KEY, revision bigint NOT NULL, data jsonb NOT NULL)`;
  const initial = seed();
  await sql`INSERT INTO dna_app_state (id, revision, data) VALUES ('main', 1, ${JSON.stringify(initial)}::jsonb) ON CONFLICT (id) DO NOTHING`;
  const rows = await sql`SELECT revision, data FROM dna_app_state WHERE id = 'main'`;
  if (!rows.length) throw new Error('Could not initialize application database');
  cache = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
  dbRevision = Number(rows[0].revision);
  if (isDemoSeed(cache)) {
    cache = seed();
    await saveDB(cache);
    return;
  }
  if (migrate(cache)) await saveDB(cache);
}

export function getDB() {
  if (cache) return cache;
  let db = null;
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { db = null; }
  if (!db) { db = seed(); }
  if (isDemoSeed(db)) db = seed();
  cache = db;
  migrate(db);
  saveDB(db);
  return db;
}

export function saveDB(db) {
  cache = db;
  if (process.env.DATABASE_URL) return saveRemoteDB(db);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function saveRemoteDB(db) {
  const sql = await database();
  if (dbRevision === null) await initializeDB();
  const rows = await sql`UPDATE dna_app_state SET data = ${JSON.stringify(db)}::jsonb, revision = revision + 1 WHERE id = 'main' AND revision = ${dbRevision} RETURNING revision`;
  if (!rows.length) {
    const error = new Error('Data changed in another request; reload and retry');
    error.status = 409;
    throw error;
  }
  dbRevision = Number(rows[0].revision);
}

export async function resetDB() { cache = null; await saveDB(seed()); }

let sessionSecretCache = null;

// Session tokens are HMAC-signed. Prefer an explicit SESSION_SECRET from the
// environment; otherwise fall back to a random secret persisted in the database
// so that sessions survive restarts, cold starts and redeployments.
export function getSessionSecret() {
  if (sessionSecretCache) return sessionSecretCache;
  if (process.env.SESSION_SECRET) {
    sessionSecretCache = process.env.SESSION_SECRET;
    return sessionSecretCache;
  }
  const db = getDB();
  if (!db.secret || typeof db.secret !== 'string' || db.secret.length < 32) {
    db.secret = crypto.randomBytes(32).toString('hex');
    saveDB(db);
  }
  sessionSecretCache = db.secret;
  return sessionSecretCache;
}

