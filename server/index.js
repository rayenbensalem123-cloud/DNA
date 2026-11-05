import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getDB, saveDB, verifyPassword, hashPassword, initializeDB, getSessionSecret } from './store.js';

const PORT = process.env.PORT || 3001;
const CLIENT_DIST = path.join(process.cwd(), 'client', 'dist');
const UPLOAD_DIR = path.join(process.cwd(), 'server', 'data', 'uploads');
const TOKEN_TTL = 1000 * 60 * 60 * 8; // 8h

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

function readBody(req, limitMB = 10) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limitMB * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, commission: u.commission || null, createdAt: u.createdAt }; }

// ---- Department access -------------------------------------------------------------
// Admin sees and does everything. A department account sees only the letters that are in its
// department now, or that passed through it (so it can follow what it sent on). It can only change
// a letter while the letter is in its department. Accounts without a department see their own letters.
function letterTouches(letter, committee) {
  return letter.commission === committee || (Array.isArray(letter.commissionHisto) && letter.commissionHisto.some((h) => h.committee === committee || h.fromCommittee === committee));
}
function canSeeLetter(user, letter) {
  if (user.role === 'admin') return true;
  return user.commission ? letterTouches(letter, user.commission) : letter.createdBy === user.id;
}
function holdsLetter(user, letter) {
  if (user.role === 'admin') return true;
  if (user.role !== 'agent') return false;
  return user.commission ? letter.commission === user.commission : letter.createdBy === user.id;
}
const NOT_IN_DEPARTMENT = 'Cette lettre n’est plus dans votre département : vous pouvez la consulter mais plus la modifier.';

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let s;
  try { s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!s.userId || s.expiresAt < Date.now()) return null;
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

const ROLES = ['admin', 'agent', 'lecture'];
function isValidStatut(s) { return ['recu', 'en_cours', 'archive'].includes(s); }
function isValidType(t) { return ['officielle', 'arrete', 'decret', 'note', 'courrier', 'mandat', 'autre'].includes(t); }
function isValidCategorie(c) { return ['administration', 'juridique', 'finances', 'rh', 'communication', 'securite', 'autre'].includes(c); }
function isValidPriorite(p) { return ['normale', 'urgente', 'confidentielle'].includes(p); }
function isValidCommission(db, c) { return !c || (Array.isArray(db.committees) && db.committees.some((x) => x.id === c)); }

const COMMISSION_EVENTS = ['recu_comite', 'vu_comite', 'traite_comite', 'note'];

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'document.pdf'));
  return base.replace(/[^\w., ()\-\u00C0-\u017F]/g, '_').slice(0, 120) || 'document.pdf';
}

function nextRef(db) {
  const year = new Date().getFullYear();
  const count = db.letters.filter((l) => (l.ref || '').startsWith(`BO-${year}-`)).length + 1;
  return `BO-${year}-${String(count).padStart(4, '0')}`;
}

function publicLetter(l) {
  const { id, createdAt, updatedAt, createdBy, ...rest } = l;
  const uploadedAt = (piece) => {
    if (piece.uploadedAt) return piece.uploadedAt;
    const stamp = String(piece.storedAs || '').split('-')[1];
    const milliseconds = parseInt(stamp, 36);
    return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
  };
  return {
    ...rest,
    id, createdAt, updatedAt, createdBy,
    numeroLettre: l.numeroLettre || '',
    commission: l.commission || null,
    commissionHisto: Array.isArray(l.commissionHisto) ? l.commissionHisto : [],
    pieces: (l.pieces || []).map((p) => ({ id: p.id, nom: p.nom, taille: p.taille, uploadedAt: uploadedAt(p), hasFile: !!p.storedAs })),
  };
}

process.on('uncaughtException', (e) => { console.error('uncaught', e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection', e); });

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    console.error('Request error', req.url, e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status === 409 ? e.message : 'Erreur serveur' });
    else res.end();
  }
});

async function route(req, res) {
  await initializeDB();
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
    const payload = Buffer.from(JSON.stringify({ userId: user.id, expiresAt: Date.now() + TOKEN_TTL })).toString('base64url');
    const signature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
    const token = `${payload}.${signature}`;
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    // The signed token expires after eight hours; logout clears it on the client.
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === '/api/users' && (method === 'GET' || method === 'POST')) {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    if (method === 'GET') return send(res, 200, { items: db.users.map(publicUser) });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const commission = body.commission ? String(body.commission) : null;
    if (username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) return send(res, 400, { error: 'Identifiant invalide (3 caractères minimum, lettres, chiffres, . _ -)' });
    if (db.users.some((u) => u.username === username)) return send(res, 409, { error: 'Cet identifiant existe déjà' });
    if (!name) return send(res, 400, { error: 'Le nom est obligatoire' });
    if (password.length < 8) return send(res, 400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });
    if (!isValidCommission(db, commission)) return send(res, 400, { error: 'Comité invalide' });
    const role = body.role === undefined ? 'agent' : String(body.role);
    if (!ROLES.includes(role)) return send(res, 400, { error: 'Rôle invalide' });
    if (role === 'agent' && !commission) return send(res, 400, { error: 'Choisissez le département de ce compte' });
    const created = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), username, name, password: hashPassword(password), role, commission, createdAt: new Date().toISOString() };
    db.users.push(created);
    await saveDB(db);
    return send(res, 201, { item: publicUser(created) });
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const target = db.users.find((u) => u.id === decodeURIComponent(userMatch[1]));
    if (!target) return send(res, 404, { error: 'Compte introuvable' });
    const body = await readBody(req);
    const name = String(body.name ?? target.name).trim();
    const commission = body.commission === undefined ? (target.commission || null) : (body.commission ? String(body.commission) : null);
    const password = body.password === undefined ? '' : String(body.password);
    if (!name) return send(res, 400, { error: 'Le nom est obligatoire' });
    if (!isValidCommission(db, commission)) return send(res, 400, { error: 'Comité invalide' });
    if (password && password.length < 8) return send(res, 400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });
    const role = body.role === undefined ? target.role : String(body.role);
    if (!ROLES.includes(role)) return send(res, 400, { error: 'Rôle invalide' });
    if (role !== target.role && target.id === user.id) return send(res, 400, { error: 'Vous ne pouvez pas changer votre propre rôle' });
    if (target.role === 'admin' && role !== 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) return send(res, 400, { error: 'Le dernier compte administrateur doit rester administrateur' });
    if (role === 'agent' && !commission) return send(res, 400, { error: 'Choisissez le département de ce compte' });
    target.name = name;
    target.commission = commission;
    target.role = role;
    if (password) target.password = hashPassword(password);
    await saveDB(db);
    return send(res, 200, { item: publicUser(target) });
  }

  if (userMatch && method === 'DELETE') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const id = decodeURIComponent(userMatch[1]);
    const target = db.users.find((u) => u.id === id);
    if (!target) return send(res, 404, { error: 'Compte introuvable' });
    if (target.id === user.id) return send(res, 400, { error: 'Vous ne pouvez pas supprimer votre propre compte' });
    if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) return send(res, 400, { error: 'Le dernier compte administrateur ne peut pas être supprimé' });
    db.users = db.users.filter((u) => u.id !== id);
    await saveDB(db);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/committees' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    return send(res, 200, { items: db.committees });
  }

  if (pathname === '/api/blob-upload' && method === 'POST') {
    let body;
    try { body = await readBody(req, 1); }
    catch { return send(res, 400, { error: 'Requête de téléversement invalide' }); }
    try {
      const { handleUpload } = await import('@vercel/blob/client');
      const result = await handleUpload({
        request: req,
        body,
        onBeforeGenerateToken: async (pathnameForBlob, clientPayload) => {
          const user = authUser(req);
          if (!user || !['admin', 'agent'].includes(user.role)) throw new Error('Droits insuffisants pour ajouter un fichier');
          let details;
          try { details = JSON.parse(clientPayload || '{}'); } catch { throw new Error('Informations du fichier invalides'); }
          const letterId = String(details.letterId || '');
          const filename = sanitizeFilename(details.filename);
          const extension = path.extname(filename).toLowerCase();
          const letter = getDB().letters.find((item) => item.id === letterId);
          if (!letter) throw new Error('Lettre introuvable');
          if (!canSeeLetter(user, letter)) throw new Error('Lettre introuvable');
          if (!holdsLetter(user, letter)) throw new Error(NOT_IN_DEPARTMENT);
          if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Format non pris en charge');
          // Vercel Blob may add a random suffix to the pathname, and the client
          // normalizes spaces in filenames. Validate the letter prefix and
          // extension instead of requiring an exact filename suffix.
          if (!pathnameForBlob.startsWith(`${letterId}-`) || path.extname(pathnameForBlob).toLowerCase() !== extension) throw new Error('Chemin de fichier invalide');
          return {
            allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
            maximumSizeInBytes: 25 * 1024 * 1024,
            addRandomSuffix: true,
          };
        },
        onUploadCompleted: async () => {},
      });
      return send(res, 200, result);
    } catch (error) {
      return send(res, 400, { error: error.message || 'Téléversement impossible' });
    }
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const isAdmin = user.role === 'admin';
    let lettres = db.letters;
    if (!isAdmin) {
      lettres = lettres.filter((l) => canSeeLetter(user, l));
    }
    const parStatut = {};
    const parCategorie = {};
    const parType = {};
    const parCommission = {};
    let recusCetteSaison = 0, archivesCetteSaison = 0, urgentes = 0;
    const now = new Date();
    const seasonStart = now.getMonth() >= 8
      ? new Date(now.getFullYear(), 8, 1)
      : new Date(now.getFullYear() - 1, 8, 1);
    const debutSaison = seasonStart.toISOString();
    for (const l of lettres) {
      const k = l.statut || 'recu';
      parStatut[k] = (parStatut[k] || 0) + 1;
      const ck = l.categorie || 'autre';
      parCategorie[ck] = (parCategorie[ck] || 0) + 1;
      const tk = l.type || 'autre';
      parType[tk] = (parType[tk] || 0) + 1;
      const mk = l.commission || 'non_assigne';
      parCommission[mk] = (parCommission[mk] || 0) + 1;
      if ((l.direction || 'entrant') === 'entrant' && (l.dateReception || l.createdAt) >= debutSaison) recusCetteSaison++;
      if (l.statut === 'archive' && (l.dateEmission || l.createdAt) >= debutSaison) archivesCetteSaison++;
      if (l.priorite === 'urgente') urgentes++;
      if (l.priorite === 'urgente') urgentes++;
    }
    return send(res, 200, {
      total: lettres.length,
      entrants: lettres.filter((l) => (l.direction || 'entrant') === 'entrant').length,
      sortants: lettres.filter((l) => l.direction === 'sortant').length,
      recusCetteSaison, archivesCetteSaison, urgentes,
      parStatut, parCategorie, parType, parCommission,
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
    const commission = url.searchParams.get('commission') || '';
    const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')).toISOString() : null;
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to') + 'T23:59:59.999Z').toISOString() : null;

    const isAdmin = user.role === 'admin';

    let items = db.letters.filter((l) => {
      if (direction && (l.direction || 'entrant') !== direction) return false;
      if (statut && (l.statut || 'recu') !== statut) return false;
      if (type && (l.type || 'autre') !== type) return false;
      if (categorie && (l.categorie || 'autre') !== categorie) return false;
      if (priorite && (l.priorite || 'normale') !== priorite) return false;
      if (commission === 'non_assigne' && l.commission) return false;
      if (commission && commission !== 'non_assigne' && ((l.commission || '') !== commission)) return false;
      if (from && (l.dateEmission || l.createdAt) < from) return false;
      if (to && (l.dateEmission || l.createdAt) > to) return false;
      if (q) {
        const hay = [l.ref, l.numeroLettre, l.objet, l.resume, l.expediteur?.nom || '', l.destinataire?.nom || '', l.expediteur?.fonction || '', l.destinataire?.fonction || '', l.service || '']
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Committee-based access control: non-admins only see their own letters
      // (received by their committee or created/sent by them). Admin sees all.
      if (!isAdmin) {
        if (!canSeeLetter(user, l)) return false;
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
      // access control
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      return send(res, 200, { item: publicLetter(letter) });
    }

    if (method === 'PATCH') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
      const letter = db.letters.find((l) => l.id === id);
      if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      if (!holdsLetter(user, letter)) return send(res, 403, { error: NOT_IN_DEPARTMENT });
      const body = await readBody(req);
      const nextStatut = body.statut !== undefined ? body.statut : letter.statut;
      if (!isValidStatut(nextStatut)) return send(res, 400, { error: 'Statut invalide' });
      const prevCommission = letter.commission || null;
      const nextCommission = body.commission !== undefined ? (body.commission || null) : prevCommission;
      if (!isValidCommission(db, nextCommission)) return send(res, 400, { error: 'Comité invalide' });
      if (body.ref) letter.ref = body.ref;
      if (body.numeroLettre !== undefined) letter.numeroLettre = String(body.numeroLettre || '');
      Object.assign(letter, {
        direction: body.direction !== undefined ? body.direction : letter.direction,
        type: body.type !== undefined ? body.type : letter.type,
        categorie: body.categorie !== undefined ? body.categorie : letter.categorie,
        objet: body.objet !== undefined ? body.objet : letter.objet,
        personneConcernee: body.personneConcernee !== undefined ? String(body.personneConcernee || '') : (letter.personneConcernee || ''),
        resume: body.resume !== undefined ? body.resume : letter.resume,
        priorite: body.priorite !== undefined ? body.priorite : letter.priorite,
        statut: nextStatut,
        expediteur: body.expediteur !== undefined ? body.expediteur : letter.expediteur,
        destinataire: body.destinataire !== undefined ? body.destinataire : letter.destinataire,
        dateEmission: body.dateEmission !== undefined ? body.dateEmission : letter.dateEmission,
        dateReception: body.dateReception !== undefined ? body.dateReception : letter.dateReception,
      });
      letter.commission = nextCommission;
      if (nextCommission !== prevCommission) {
        const eventType = prevCommission && nextCommission ? 'transfert'
          : prevCommission && !nextCommission ? 'retire'
          : 'assigne';
        letter.commissionHisto.push({
          id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          date: new Date().toISOString(),
          type: eventType,
          committee: nextCommission,
          fromCommittee: prevCommission || null,
          by: user.id, byName: user.name,
          note: String(body.commissionNote || ''),
        });
        if (body.statut === undefined) letter.statut = 'en_cours';
      }
      letter.updatedAt = new Date().toISOString();
      await saveDB(db);
      const updated = db.letters.find((l) => l.id === id);
      return send(res, 200, { item: publicLetter(updated) });
    }

    if (method === 'DELETE') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
      const letter = db.letters.find((l) => l.id === id);
      if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
      for (const p of letter.pieces || []) {
        if (p.storedAs) {
          if (process.env.VERCEL) {
            try { const { del } = await import('@vercel/blob'); await del(p.storedAs); } catch (e) { /* ignore */ }
          } else {
            const fp = path.join(UPLOAD_DIR, p.storedAs);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
          }
        }
      }
      const idx = db.letters.findIndex((l) => l.id === id);
      if (idx < 0) return send(res, 404, { error: 'Lettre introuvable' });
      db.letters.splice(idx, 1);
      await saveDB(db);
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/letters' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
    const body = await readBody(req);
    const db = getDB();
    if (!isValidCommission(db, body.commission || null)) return send(res, 400, { error: 'Comité invalide' });
    const newEvent = (type, committee, fromCommittee) => ({ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: new Date().toISOString(), type, committee, fromCommittee, by: user.id, byName: user.name, note: '' });
    // A department account registers the letter in its own department; it can send it straight on to another one.
    const own = user.role === 'agent' ? (user.commission || null) : null;
    const commission = body.commission || own || null;
    const statut = body.statut || (commission ? 'en_cours' : 'recu');
    if (!isValidStatut(statut)) return send(res, 400, { error: 'Statut invalide' });
    const commissionHisto = [];
    if (own) {
      commissionHisto.push(newEvent('assigne', own, null));
      if (commission !== own) commissionHisto.push(newEvent('transfert', commission, own));
    } else if (commission) {
      commissionHisto.push(newEvent('assigne', commission, null));
    }
    const lettre = {
      id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ref: body.ref || nextRef(db),
      numeroLettre: String(body.numeroLettre || ''),
      direction: body.direction === 'sortant' ? 'sortant' : 'entrant',
      type: isValidType(body.type) ? body.type : 'courrier',
      categorie: isValidCategorie(body.categorie) ? body.categorie : 'autre',
      objet: String(body.objet || ''),
      personneConcernee: String(body.personneConcernee || ''),
      resume: String(body.resume || ''),
      priorite: isValidPriorite(body.priorite) ? body.priorite : 'normale',
      statut,
      commission,
      commissionHisto,
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
    await saveDB(db);
    return send(res, 201, { item: publicLetter(lettre) });
  }

  // Committee tracking events
  const eventsMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/commission-events$/.exec(pathname);
  if (eventsMatch && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const letter = db.letters.find((l) => l.id === eventsMatch[1]);
    if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
    // access control
    if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
    const body = await readBody(req);
    const type = String(body.type || '');
    if (!COMMISSION_EVENTS.includes(type)) return send(res, 400, { error: 'Type d\'événement invalide' });
    const canManage = holdsLetter(user, letter);
    const canUpdateCommitteeStatus = user.role === 'lecture' && ['vu_comite', 'traite_comite'].includes(type) && letter.commission === user.commission;
    if (!canManage && !canUpdateCommitteeStatus) return send(res, 403, { error: user.role === 'agent' ? NOT_IN_DEPARTMENT : 'Droits insuffisants' });
    if (type !== 'note' && !letter.commission) return send(res, 400, { error: 'Aucun comité assigné' });
    if (type === 'vu_comite' && (letter.commissionHisto || []).some((h) => h.type === 'vu_comite')) return send(res, 200, { item: publicLetter(letter) });
    const event = {
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: new Date().toISOString(),
      type,
      committee: letter.commission,
      by: user.id, byName: user.name,
      note: String(body.note || ''),
    };
    letter.commissionHisto.push(event);
    if (type === 'recu_comite' || type === 'vu_comite') letter.statut = 'en_cours';
    if (type === 'traite_comite') letter.statut = 'archive';
    letter.updatedAt = new Date().toISOString();
    await saveDB(db);
    return send(res, 200, { item: publicLetter(db.letters.find((l) => l.id === letter.id)) });
  }

  // Attachments (scanned letter PDF): upload / stream / delete
  const completedUploadMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/pieces\/complete$/.exec(pathname);
  if (completedUploadMatch && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const letterId = completedUploadMatch[1];
    const letter = db.letters.find((item) => item.id === letterId);
    if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
    // access control: non-admins may only touch their own letters
    if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
    if (!holdsLetter(user, letter)) return send(res, 403, { error: NOT_IN_DEPARTMENT });
    const body = await readBody(req, 1);
    const pathnameForBlob = String(body.pathname || '');
    const filename = sanitizeFilename(body.filename);
    const extension = path.extname(filename).toLowerCase();
    if (!pathnameForBlob.startsWith(`${letterId}-`) || path.extname(pathnameForBlob).toLowerCase() !== extension) return send(res, 400, { error: 'Chemin de fichier invalide' });
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) return send(res, 400, { error: 'Format non pris en charge' });
    try {
      const { head } = await import('@vercel/blob');
      const blob = await head(pathnameForBlob, { access: 'private' });
      if (blob.size > 25 * 1024 * 1024) return send(res, 413, { error: 'Fichier trop volumineux (25 Mo maximum)' });
      let piece = (letter.pieces || []).find((item) => item.storedAs === pathnameForBlob);
      if (!piece) {
        piece = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), nom: filename, taille: blob.size, storedAs: pathnameForBlob, uploadedAt: new Date().toISOString() };
        letter.pieces.push(piece);
        letter.updatedAt = new Date().toISOString();
        await saveDB(db);
      }
      return send(res, 201, { item: { id: piece.id, nom: piece.nom, taille: piece.taille, hasFile: true } });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Fichier téléversé, mais rattachement à la lettre impossible' });
    }
  }

  const piecesMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/pieces(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
  if (piecesMatch) {
    const [_, letterId, pieceId] = piecesMatch;
    const db = getDB();
    const letter = db.letters.find((l) => l.id === letterId);
    if (!letter) return send(res, 404, { error: 'Lettre introuvable' });

    if (method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!['admin', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      if (!holdsLetter(user, letter)) return send(res, 403, { error: NOT_IN_DEPARTMENT });
      let body;
      try { body = await readBody(req, 14); } catch (e) { return send(res, 413, { error: 'Fichier trop volumineux (max ~10 Mo)' }); }
      const filename = sanitizeFilename(body.filename);
      if (!/^[A-Za-z0-9+/=\s]+$/.test(String(body.dataBase64 || ''))) return send(res, 400, { error: 'Données base64 invalides' });
      const buf = Buffer.from(String(body.dataBase64), 'base64');
      if (!buf.length) return send(res, 400, { error: 'Fichier vide' });
      if (buf.length > 10 * 1024 * 1024) return send(res, 413, { error: 'Fichier trop volumineux (max 10 Mo)' });
      const storedAs = letterId + '-' + Date.now().toString(36) + '-' + filename.replace(/[^.\w]/g, '_');
      const uploadedAt = new Date().toISOString();
      if (process.env.VERCEL) {
        const { put } = await import('@vercel/blob');
        const blob = await put(storedAs, buf, { access: 'private', contentType: filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', addRandomSuffix: true });
        const piece = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), nom: filename, taille: buf.length, storedAs: blob.pathname, uploadedAt };
        letter.pieces.push(piece);
        letter.updatedAt = new Date().toISOString();
        await saveDB(db);
        return send(res, 201, { item: { id: piece.id, nom: piece.nom, taille: piece.taille, hasFile: true }, letters: db.letters.length });
      }
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, storedAs), buf);
      const piece = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), nom: filename, taille: buf.length, storedAs, uploadedAt };
      letter.pieces.push(piece);
      letter.updatedAt = new Date().toISOString();
      await saveDB(db);
      return send(res, 201, { item: { id: piece.id, nom: piece.nom, taille: piece.taille, hasFile: true }, letters: db.letters.length });
    }

    if (method === 'GET' && !pieceId) {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      return send(res, 200, { items: (letter.pieces || []).map((p) => ({ id: p.id, nom: p.nom, taille: p.taille, hasFile: !!p.storedAs })) });
    }

    if (method === 'GET' && pieceId) {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Fichier non disponible' });
      const piece = (letter.pieces || []).find((p) => p.id === pieceId);
      if (!piece || !piece.storedAs) return send(res, 404, { error: 'Fichier non disponible' });
      if (process.env.VERCEL) {
        const { get } = await import('@vercel/blob');
        const blob = await get(piece.storedAs, { access: 'private' });
        if (!blob || blob.statusCode !== 200) return send(res, 404, { error: 'Fichier non disponible' });
        const ext = path.extname(piece.nom).toLowerCase();
        const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(piece.nom)}` });
        const { Readable } = await import('node:stream');
        Readable.fromWeb(blob.stream).pipe(res);
        return;
      }
      const filePath = path.join(UPLOAD_DIR, piece.storedAs);
      if (!fs.existsSync(filePath)) return send(res, 404, { error: 'Fichier non disponible' });
      const ext = path.extname(piece.storedAs).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(piece.nom)}`,
      });
      res.end(data);
      return;
    }

    if (method === 'DELETE' && pieceId) {
      const user = requireAuth(req, res);
      if (!user) return;
      if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
      const idx = (letter.pieces || []).findIndex((p) => p.id === pieceId);
      if (idx < 0) return send(res, 404, { error: 'Fichier introuvable' });
      const [removed] = letter.pieces.splice(idx, 1);
      if (removed && removed.storedAs) {
        if (process.env.VERCEL) {
          try { const { del } = await import('@vercel/blob'); await del(removed.storedAs); } catch (e) { /* ignore */ }
        } else {
          const fp = path.join(UPLOAD_DIR, removed.storedAs);
          try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
        }
      }
      letter.updatedAt = new Date().toISOString();
      await saveDB(db);
      return send(res, 200, { ok: true });
    }
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
}

if (!process.env.VERCEL) server.listen(PORT, () => {
  console.log(`Bureau Ordre server listening on http://localhost:${PORT}`);
});


export { route };
