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

  // Base de données officielle : registre vide, un seul compte administrateur.
  // Les autres comptes (agents, lecteurs) pourront être créés par l'administrateur.
  const users = [
    { id: 'u1', username: 'admin', password: hashPassword(String(process.env.DNA_ADMIN_PASSWORD || 'admin')), name: 'Administrateur', role: 'admin', createdAt: iso(now) },
  ];

  const letters = [];
  const committees = COMMITTEES.map((c) => ({ ...c }));

  return { users, committees, letters, seq: 1 };
}


function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.committees)) {
    db.committees = COMMITTEES.map((c) => ({ ...c }));
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
  if (changed) saveDB(db);
}

let cache = null;

export function getDB() {
  if (cache) return cache;
  let db = null;
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { db = null; }
  if (!db) { db = seed(); }
  cache = db;
  migrate(db);
  saveDB(db);
  return db;
}

export function saveDB(db) {
  cache = db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function resetDB() { cache = null; saveDB(seed()); }
