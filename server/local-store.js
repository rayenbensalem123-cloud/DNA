// Local storage for `node server/index.js` and for the tests: data in memory (optionally saved to a
// JSON file) and scanned files in memory or in a folder. Same interface as the Supabase version.
// The JSON file keeps the format of the first local version, so existing local data still works.
import fs from 'node:fs';
import path from 'node:path';
import { randomHex, hashPassword } from '../supabase/functions/api/auth.js';

export const DEFAULT_COMMITTEES = [
  { id: 'cna', nom: "Comité National d'Arbitrage" },
  { id: 'discipline', nom: 'Commission de Discipline' },
  { id: 'appel', nom: "Commission d'Appel" },
  { id: 'administration', nom: 'Administration' },
];

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const dupError = () => Object.assign(new Error('Duplicate ref'), { code: 'DUPLICATE_REF' });

/**
 * @param {object} opts
 * @param {string} [opts.file]   JSON file to load from and save to. Without it everything stays in memory.
 * @param {Array}  [opts.users]  users to create when the store starts empty: { id, username, name, role, passwordHash }
 */
export function createLocalStore({ file, users } = {}) {
  let db = null;
  if (file && fs.existsSync(file)) {
    try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = null; }
  }
  const fresh = !db;
  db ??= { users: users || [], committees: DEFAULT_COMMITTEES.map((c) => ({ ...c })), letters: [], config: {} };

  // Bring older local files up to date.
  db.config ??= {};
  if (!db.config.tokenSecret) db.config.tokenSecret = randomHex(32);
  if (!Array.isArray(db.committees)) db.committees = DEFAULT_COMMITTEES.map((c) => ({ ...c }));
  for (const u of db.users) {
    if (!u.passwordHash && u.password && u.password.salt) u.passwordHash = `scrypt$${u.password.salt}$${u.password.hash}`;
    delete u.password;
  }
  for (const l of db.letters) {
    l.numeroLettre ??= l.ref || '';
    l.commission ??= null;
    if (!Array.isArray(l.commissionHisto)) l.commissionHisto = [];
    if (!Array.isArray(l.pieces)) l.pieces = [];
    for (const p of l.pieces) p.id ||= 'p' + Math.random().toString(36).slice(2, 10);
    l.expediteur ??= { nom: '', fonction: '', service: '' };
    l.destinataire ??= { nom: '', fonction: '', service: '' };
  }

  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  };
  if (file) save();

  const find = (id) => db.letters.find((l) => l.id === id);
  const refTaken = (ref, exceptId) => db.letters.some((l) => l.ref === ref && l.id !== exceptId);

  return {
    fresh,
    async getTokenSecret() { return db.config.tokenSecret; },

    async getUserByUsername(username) { return clone(db.users.find((u) => u.username === username)) || null; },
    async getUserById(id) { return clone(db.users.find((u) => u.id === id)) || null; },
    async setPasswordHash(id, hash) {
      const u = db.users.find((x) => x.id === id);
      if (u) { u.passwordHash = hash; save(); }
    },

    async listCommittees() { return clone(db.committees); },
    async committeeExists(id) { return !id || db.committees.some((c) => c.id === id); },

    async queryLetters(f) {
      const needle = (f.q || '').toLowerCase();
      let items = db.letters.filter((l) => {
        if (f.direction && (l.direction || 'entrant') !== f.direction) return false;
        if (f.statut && (l.statut || 'recu') !== f.statut) return false;
        if (f.type && (l.type || 'autre') !== f.type) return false;
        if (f.categorie && (l.categorie || 'autre') !== f.categorie) return false;
        if (f.priorite && (l.priorite || 'normale') !== f.priorite) return false;
        if (f.commission && (l.commission || '') !== f.commission) return false;
        if (f.from && !(l.dateEmission && new Date(l.dateEmission) >= new Date(f.from))) return false;
        if (f.to && !(l.dateEmission && new Date(l.dateEmission) <= new Date(f.to))) return false;
        if (needle) {
          const hay = [l.ref, l.numeroLettre, l.objet, l.resume, l.expediteur?.nom, l.destinataire?.nom, l.expediteur?.fonction, l.destinataire?.fonction]
            .join(' ').toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });
      const key = f.sort === 'ref' ? (l) => l.ref || '' : (l) => l.createdAt || '';
      items = [...items].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : a.id < b.id ? 1 : -1)); // newest first
      return { items: clone(items.slice(f.offset, f.offset + f.limit)), total: items.length };
    },
    async getLetter(id) { return clone(find(id)) || null; },
    async statsRows() { return clone(db.letters); },
    async nextRef() {
      const year = new Date().getFullYear();
      let max = 0;
      for (const l of db.letters) {
        const m = /^BO-(\d{4})-(\d+)$/.exec(l.ref || '');
        if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
      }
      return `BO-${year}-${String(max + 1).padStart(4, '0')}`;
    },
    async insertLetter(letter) {
      if (refTaken(letter.ref)) throw dupError();
      db.letters.push(clone(letter));
      save();
    },
    async updateLetter(id, patch, events) {
      const l = find(id);
      if (!l) return;
      if (patch.ref !== undefined && refTaken(patch.ref, id)) throw dupError();
      Object.assign(l, clone(patch));
      l.commissionHisto.push(...clone(events));
      l.updatedAt = new Date().toISOString();
      save();
    },
    async addEvent(letterId, event, statut) {
      const l = find(letterId);
      if (!l) return;
      l.commissionHisto.push(clone(event));
      if (statut) l.statut = statut;
      l.updatedAt = new Date().toISOString();
      save();
    },
    async deleteLetter(id) {
      const i = db.letters.findIndex((l) => l.id === id);
      if (i < 0) return null;
      const [removed] = db.letters.splice(i, 1);
      save();
      return removed.pieces.filter((p) => p.storedAs).map((p) => p.storedAs);
    },

    async addPiece(letterId, piece) {
      const l = find(letterId);
      if (!l) return;
      l.pieces.push(clone(piece));
      l.updatedAt = new Date().toISOString();
      save();
    },
    async getPiece(letterId, pieceId) { return clone(find(letterId)?.pieces.find((p) => p.id === pieceId)) || null; },
    async removePiece(letterId, pieceId) {
      const l = find(letterId);
      const i = l ? l.pieces.findIndex((p) => p.id === pieceId) : -1;
      if (i < 0) return null;
      const [removed] = l.pieces.splice(i, 1);
      l.updatedAt = new Date().toISOString();
      save();
      return clone(removed);
    },
  };
}

export function createMemoryStorage() {
  const files = new Map();
  return {
    files,
    async put(key, bytes) { files.set(key, new Uint8Array(bytes)); },
    async head(key, n) {
      const b = files.get(key);
      return b ? { size: b.length, bytes: b.subarray(0, n) } : null;
    },
    async get(key) {
      const b = files.get(key);
      return b ? { body: b, size: b.length } : null;
    },
    async remove(key) { files.delete(key); },
  };
}

export function createDiskStorage(dir) {
  const root = path.resolve(dir);
  const file = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Invalid file key');
    return p;
  };
  return {
    async put(key, bytes) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(file(key), bytes);
    },
    async head(key, n) {
      const p = file(key);
      if (!fs.existsSync(p)) return null;
      const size = fs.statSync(p).size;
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(Math.min(n, size));
        fs.readSync(fd, buf, 0, buf.length, 0);
        return { size, bytes: new Uint8Array(buf) };
      } finally { fs.closeSync(fd); }
    },
    async get(key) {
      const p = file(key);
      if (!fs.existsSync(p)) return null;
      const b = fs.readFileSync(p);
      return { body: new Uint8Array(b), size: b.length };
    },
    async remove(key) {
      const p = file(key);
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    },
  };
}

/** The account a brand-new local install starts with. Set DNA_ADMIN_PASSWORD to choose its password. */
export async function defaultAdmin() {
  return {
    id: 'u1', username: 'admin', name: 'Administrateur', role: 'admin',
    passwordHash: await hashPassword(String(process.env.DNA_ADMIN_PASSWORD || 'admin')),
    createdAt: new Date().toISOString(),
  };
}
