import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getDB, saveDB, verifyPassword } from './store.js';

const PORT = process.env.PORT || 3001;
const CLIENT_DIST = path.join(process.cwd(), 'client', 'dist');
const TOKEN_TTL = 1000 * 60 * 60 * 8; // 8h

const sessions = new Map(); // token -> { userId, expiresAt }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 5 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role }; }

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(token); return null; }
  const db = getDB();
  const user = db.users.find((u) => u.id === s.userId) || null;
  return user || null;
}

function requireAuth(req, res, next) {
  const user = authUser(req);
  if (!user) { send(res, 401, { error: 'Unauthenticated' }); return null; }
  req.user = user;
  return user;
}

function isValidStatut(s) { return ['recu', 'enregistre', 'en_cours', 'traite', 'transmis', 'archive'].includes(s); }
function isValidType(t) { return ['officielle', 'arrete', 'decret', 'note', 'courrier', 'mandat', 'autre'].includes(t); }
function isValidCategorie(c) { return ['administration', 'juridique', 'finances', 'rh', 'communication', 'securite', 'autre'].includes(c); }
function isValidPriorite(p) { return ['normale', 'urgente', 'confidentielle'].includes(p); }

function nextRef(db) {
  const year = new Date().getFullYear();
  const count = db.letters.filter((l) => (l.ref || '').startsWith(`BO-${year}-`)).length + 1;
  return `BO-${year}-${String(count).padStart(4, '0')}`;
}

function publicLetter(l) {
  const { id, createdAt, updatedAt, createdBy, ...rest } = l;
  return { ...rest, id, createdAt, updatedAt, createdBy };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const db = getDB();
    const user = db.users.find((u) => u.username === String(body.username || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(body.password || ''), user.password)) {
      return send(res, 401, { error: 'Identifiants invalides' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + TOKEN_TTL });
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const lettres = db.letters;
    const parStatut = {};
    const parCategorie = {};
    const parType = {};
    let recusCeMois = 0, archivesCeMois = 0, traiteCeMois = 0, urgentes = 0;
    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    for (const l of lettres) {
      const k = l.statut || 'recu';
      parStatut[k] = (parStatut[k] || 0) + 1;
      const ck = l.categorie || 'autre';
      parCategorie[ck] = (parCategorie[ck] || 0) + 1;
      const tk = l.type || 'autre';
      parType[tk] = (parType[tk] || 0) + 1;
      if ((l.direction || 'entrant') === 'entrant' && (l.dateReception || l.createdAt) >= debutMois) recusCeMois++;
      if (l.statut === 'archive' && (l.dateEmission || l.createdAt) >= debutMois) archivesCeMois++;
      if (l.statut === 'traite' && (l.dateEmission || l.createdAt) >= debutMois) traiteCeMois++;
      if (l.priorite === 'urgente') urgentes++;
    }
    return send(res, 200, {
      total: lettres.length,
      entrants: lettres.filter((l) => (l.direction || 'entrant') === 'entrant').length,
      sortants: lettres.filter((l) => l.direction === 'sortant').length,
      recusCeMois, archivesCeMois, traiteCeMois, urgentes,
      parStatut, parCategorie, parType,
    });
  }

  if (pathname === '/api/letters' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const direction = url.searchParams.get('direction') || '';
    const statut = url.searchParams.get('statut') || '';
    const type = url.searchParams.get('type') || '';
    const categorie = url.searchParams.get('categorie') || '';
    const priorite = url.searchParams.get('priorite') || '';
    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')).toISOString() : null;
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to') + 'T23:59:59.999Z').toISOString() : null;

    let items = db.letters.filter((l) => {
      if (direction && (l.direction || 'entrant') !== direction) return false;
      if (statut && (l.statut || 'recu') !== statut) return false;
      if (type && (l.type || 'autre') !== type) return false;
      if (categorie && (l.categorie || 'autre') !== categorie) return false;
      if (priorite && (l.priorite || 'normale') !== priorite) return false;
      if (from && (l.dateEmission || l.createdAt) < from) return false;
      if (to && (l.dateEmission || l.createdAt) > to) return false;
      if (q) {
        const hay = [l.ref, l.objet, l.resume, l.expediteur?.nom || '', l.destinataire?.nom || '', l.expediteur?.fonction || '', l.destinataire?.fonction || '', l.service || '']
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sort = url.searchParams.get('sort') || 'date';
    items = [...items].sort((a, b) => {
      const av = sort === 'ref' ? (a.ref || '') : (a[sort] || a.createdAt || '');
      const bv = sort === 'ref' ? (b.ref || '') : (b[sort] || b.createdAt || '');
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });

    const total = items.length;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return send(res, 200, { items: pageItems.map(publicLetter), total, page, limit });
  }

  const lettersMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (lettersMatch) {
    const id = lettersMatch[1];
    const db = getDB();

    if (method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const letter = db.letters.find((l) => l.id === id);
      if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
      return send(res, 200, { item: publicLetter(letter) });
    }

    if (method === 'PATCH') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
      const letter = db.letters.find((l) => l.id === id);
      if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
      const body = await readBody(req);
      const nextStatut = body.statut !== undefined ? body.statut : letter.statut;
      if (!isValidStatut(nextStatut)) return send(res, 400, { error: 'Statut invalide' });
      if (body.ref) letter.ref = body.ref;
      Object.assign(letter, {
        direction: body.direction !== undefined ? body.direction : letter.direction,
        type: body.type !== undefined ? body.type : letter.type,
        categorie: body.categorie !== undefined ? body.categorie : letter.categorie,
        objet: body.objet !== undefined ? body.objet : letter.objet,
        resume: body.resume !== undefined ? body.resume : letter.resume,
        priorite: body.priorite !== undefined ? body.priorite : letter.priorite,
        statut: nextStatut,
        expediteur: body.expediteur !== undefined ? body.expediteur : letter.expediteur,
        destinataire: body.destinataire !== undefined ? body.destinataire : letter.destinataire,
        dateEmission: body.dateEmission !== undefined ? body.dateEmission : letter.dateEmission,
        dateReception: body.dateReception !== undefined ? body.dateReception : letter.dateReception,
        pieces: body.pieces !== undefined ? body.pieces : letter.pieces,
      });
      letter.updatedAt = new Date().toISOString();
      saveDB(db);
      const updated = db.letters.find((l) => l.id === id);
      return send(res, 200, { item: publicLetter(updated) });
    }

    if (method === 'DELETE') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
      const idx = db.letters.findIndex((l) => l.id === id);
      if (idx < 0) return send(res, 404, { error: 'Lettre introuvable' });
      db.letters.splice(idx, 1);
      saveDB(db);
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/letters' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
    const body = await readBody(req);
    const db = getDB();
    const statut = body.statut || 'recu';
    if (!isValidStatut(statut)) return send(res, 400, { error: 'Statut invalide' });
    const lettre = {
      id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ref: body.ref || nextRef(db),
      direction: body.direction === 'sortant' ? 'sortant' : 'entrant',
      type: isValidType(body.type) ? body.type : 'courrier',
      categorie: isValidCategorie(body.categorie) ? body.categorie : 'autre',
      objet: String(body.objet || ''),
      resume: String(body.resume || ''),
      priorite: isValidPriorite(body.priorite) ? body.priorite : 'normale',
      statut,
      expediteur: body.expediteur || { nom: '', fonction: '', service: '' },
      destinataire: body.destinataire || { nom: '', fonction: '', service: '' },
      dateEmission: body.dateEmission || new Date().toISOString(),
      dateReception: body.direction === 'entrant' ? (body.dateReception || new Date().toISOString()) : body.dateReception || null,
      pieces: Array.isArray(body.pieces) ? body.pieces : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: user.id,
    };
    db.letters.push(lettre);
    saveDB(db);
    return send(res, 201, { item: publicLetter(lettre) });
  }

  // Static client
  if (method === 'GET' && !pathname.startsWith('/api')) {
    let filePath = path.join(CLIENT_DIST, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(CLIENT_DIST, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
    return;
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Bureau Ordre server listening on http://localhost:${PORT}`);
});
