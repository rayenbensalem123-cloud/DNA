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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Headers added to every response (API, files and the web app itself).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.vercel-storage.com https://vercel.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, limitMB = 0.25) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > limitMB * 1024 * 1024) { tooBig = true; chunks.length = 0; const e = new Error('Payload too large'); e.status = 413; reject(e); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (tooBig) return; try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: effectiveRole(u.role), commission: u.commission || null, createdAt: u.createdAt }; }

// ---- Access by comité ---------------------------------------------------------------
// Two kinds of accounts: Administration (role "admin": sees and does everything) and comité accounts
// (role "agent", older "lecture" accounts behave the same). A comité account can send a letter to any
// comité, but only reads the letters its own comité received, and only changes a letter while it is in
// its comité. It cannot see what other comités receive or handle.
const effectiveRole = (role) => (role === 'admin' || role === 'supervisor' ? role : 'agent');
function receivedBy(letter, committee) {
  return letter.commission === committee || (Array.isArray(letter.commissionHisto) && letter.commissionHisto.some((h) => h.committee === committee));
}
function canSeeLetter(user, letter) {
  if (isAdminLike(user)) return true;
  return user.commission ? receivedBy(letter, user.commission) : letter.createdBy === user.id;
}
function holdsLetter(user, letter) {
  if (isAdminLike(user)) return true;
  return user.commission ? letter.commission === user.commission : letter.createdBy === user.id;
}
// Right after sending, the sender may still attach the scanned files to the letter it just created.
function justSent(user, letter) {
  return letter.createdBy === user.id && Date.now() - Date.parse(letter.createdAt || 0) < 15 * 60 * 1000;
}
const canAttach = (user, letter) => holdsLetter(user, letter) || justSent(user, letter);
const NOT_IN_COMMITTEE = 'Cette lettre n’est plus dans votre comité : vous pouvez la consulter mais plus la modifier.';

// ---- Short-lived signed file links ----
// The browser (iframe/img) cannot send the Authorization header, so files are
// opened through a signed, expiring URL. The expiry is bucketed to 30-minute
// boundaries: the same viewer file mints the same URL within the bucket, so
// the browser caches the response and re-opening is instant.
function signFileToken(userId, kind, id) {
  const BUCKET = 30 * 60 * 1000;
  const exp = Math.ceil((Date.now() + BUCKET) / BUCKET) * BUCKET;
  const payload = `${userId}|${kind}|${id}|${exp}`;
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}
function verifyFileToken(tk, kind, id) {
  try {
    const [p64, sig] = String(tk || '').split('.');
    if (!p64 || !sig) return null;
    const payload = Buffer.from(p64, 'base64url').toString('utf8');
    const expect = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const [userId, k, i, exp] = payload.split('|');
    if (k !== kind || i !== id || Number(exp) < Date.now()) return null;
    return userId;
  } catch { return null; }
}
// Accept either the Authorization header or a valid signed token for one file.
// A present Authorization user always wins: file links are for headerless
// requests (viewer iframe/img) and never upgrade an authenticated caller.
function authUserForFile(req, res, kind, id, db) {
  const headerUser = authUser(req);
  if (headerUser) return headerUser;
  const tk = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).searchParams.get('tk');
  const tkUser = tk && verifyFileToken(tk, kind, id);
  if (tkUser) {
    const found = db.users.find((u) => u.id === tkUser);
    if (found) return { ...found, role: effectiveRole(found.role) };
    return null;
  }
  return requireAuth(req, res);
}

function isAdminLike(u) { return !!u && (u.role === 'admin' || u.role === 'supervisor'); }

// ---- Login protection ---------------------------------------------------------------
// Too many wrong passwords from one address (or for one account from one address) → temporary block.
// Counters live in the shared state, not in instance memory: serverless can
// route consecutive requests to different instances, and a memory-only
// counter would reset every time (limit effectively bypassed).
const FAIL_WINDOW = 15 * 60 * 1000;
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}
function throttleMap(db) {
  if (!db.throttle || typeof db.throttle !== 'object' || Array.isArray(db.throttle)) db.throttle = {};
  return db.throttle;
}
function throttleState(db, key, limit) {
  const now = Date.now();
  const entry = throttleMap(db)[key];
  if (!entry || now - entry.first > FAIL_WINDOW) return { blocked: false };
  return entry.count >= limit ? { blocked: true, retryAfter: Math.ceil((entry.first + FAIL_WINDOW - now) / 1000) } : { blocked: false };
}
function noteFailure(db, key) {
  const now = Date.now();
  const map = throttleMap(db);
  // prune expired entries so the state cannot grow unbounded
  for (const k of Object.keys(map)) if (now - map[k].first > FAIL_WINDOW) delete map[k];
  const entry = map[key];
  if (!entry || now - entry.first > FAIL_WINDOW) map[key] = { first: now, count: 1 };
  else entry.count += 1;
}
const failuresClear = (db, key) => { delete throttleMap(db)[key]; };
// Check a password against a throwaway hash when the account does not exist, so response time never reveals which usernames exist.
const DUMMY_PASSWORD = hashPassword(crypto.randomBytes(12).toString('hex'));
const sessionVersion = (u) => Number(u?.sessionVersion || 0);
function signToken(user) {
  const payload = Buffer.from(JSON.stringify({ userId: user.id, jti: crypto.randomBytes(9).toString('hex'), pv: sessionVersion(user), expiresAt: Date.now() + TOKEN_TTL })).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readToken(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const s = readToken(token);
  if (!s || !s.userId || !(s.expiresAt >= Date.now())) return null;
  const db = getDB();
  // A signed-out token stays dead even before it expires.
  if (s.jti && Array.isArray(db.revokedTokens) && db.revokedTokens.some((r) => r.jti === s.jti)) return null;
  const found = db.users.find((u) => u.id === s.userId) || null;
  // Changing a password or role ends every older session of that account.
  if (!found || Number(s.pv || 0) !== sessionVersion(found)) return null;
  return { ...found, role: effectiveRole(found.role) };
}

function requireAuth(req, res, next) {
  const user = authUser(req);
  if (!user) { send(res, 401, { error: 'Unauthenticated' }); return null; }
  req.user = user;
  return user;
}

const ROLES = ['admin', 'supervisor', 'agent'];
const normalizeRole = (r) => (r === 'lecture' ? 'agent' : r);
function isValidStatut(s) { return ['recu', 'en_cours', 'archive'].includes(s); }
function isValidType(t) { return ['officielle', 'arrete', 'decret', 'note', 'courrier', 'mandat', 'autre'].includes(t); }
function isValidCategorie(c) { return ['administration', 'juridique', 'finances', 'rh', 'communication', 'securite', 'autre'].includes(c); }
function isValidPriorite(p) { return ['normale', 'urgente', 'confidentielle'].includes(p); }
function isValidCommission(db, c) { return !c || (Array.isArray(db.committees) && db.committees.some((x) => x.id === c)); }

const COMMISSION_EVENTS = ['recu_comite', 'vu_comite', 'traite_comite', 'note'];

function logActivity(db, user, action, target, details) {
  if (!Array.isArray(db.activity)) db.activity = [];
  db.activity.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: new Date().toISOString(), userId: user?.id || null, userName: user?.name || '—', userRole: isAdminLike(user) ? (user.role === 'supervisor' ? 'supervisor' : 'admin') : 'agent', commission: user?.commission || null, action, target: String(target || ''), details: details || {} });
  if (db.activity.length > 3000) db.activity.splice(0, db.activity.length - 3000);
}

// A letter is "unread" for its current comité until someone in that comité opens it.
function isUnread(letter) {
  const histo = Array.isArray(letter.commissionHisto) ? letter.commissionHisto : [];
  if (!letter.commission) return false;
  let at = -1;
  histo.forEach((h, i) => { if ((h.type === 'assigne' || h.type === 'transfert') && h.committee === letter.commission) at = i; });
  if (at < 0) return false;
  return !histo.slice(at + 1).some((h) => ['vu_comite', 'recu_comite', 'traite_comite'].includes(h.type) && h.committee === letter.commission);
}

// Input hygiene: cap lengths so nobody can bloat the database with giant values.
const clip = (value, max) => String(value ?? '').slice(0, max);
function cleanParty(p) {
  const o = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  return { nom: clip(o.nom, 200), fonction: clip(o.fonction, 200), service: clip(o.service, 200) };
}
function cleanDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}
const FILE_TYPES = {
  '.pdf': { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  '.png': { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  '.jpg': { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  '.jpeg': { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
};
// The file must really be what its extension says (no HTML or scripts renamed to .pdf).
function fileLooksValid(buf, ext) {
  const type = FILE_TYPES[ext];
  if (!type) return false;
  if (ext === '.pdf') return buf.subarray(0, 1024).includes('%PDF-');
  return type.magic.some((m) => m.every((byte, i) => buf[i] === byte));
}
// Browsers may display PDFs and images; anything else is always downloaded, never rendered.
const fileDisposition = (name) => `${FILE_TYPES[path.extname(String(name || '')).toLowerCase()] ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`;
// A stored file name must belong to its letter and can never point outside the upload folder.
function storedNameOk(storedAs) {
  const name = String(storedAs || '');
  return /^[\w.-]+$/.test(name) && !name.includes('..');
}
const FILE_RESPONSE_HEADERS = { ...SECURITY_HEADERS, 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=1800' };

// Lower-case and strip accents so "arbitre" finds "Arbitre" and "arbitré".
function fold(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function validDate(value, endOfDay) {
  if (!value) return null;
  const d = new Date(endOfDay ? value + 'T23:59:59.999Z' : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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

// What a user may see of a letter. Admins and supervisors see everything:
// the tracking history AND a "seen by comité" indicator computed from it.
// Comité accounts never see the history (private to the bureau d'ordre)
// — only a simple "transferred" flag so the badge still works.
function letterView(user, l) {
  const base = publicLetter(l);
  if (isAdminLike(user)) {
    return { ...base, comiteVu: l.commission ? !isUnread(l) : null };
  }
  return {
    ...base,
    commissionHisto: [],
    transferred: (Array.isArray(l.commissionHisto) ? l.commissionHisto : []).some((h) => h.type === 'transfert'),
    comiteVu: null,
    // A comité sees a pending transfer only on letters it currently holds.
    pendingTransfer: holdsLetter(user, l) ? (l.pendingTransfer || null) : null,
  };
}

process.on('uncaughtException', (e) => { console.error('uncaught', e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection', e); });

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    console.error('Request error', req.url, e);
    if (!res.headersSent) send(res, e.status || 500, { error: (e.status === 409 || e.status === 413) ? e.message : 'Erreur serveur' });
    else res.end();
  }
});

async function route(req, res) {
  // Reads may use the short-TTL cache; writes always start from fresh state.
  await initializeDB(req.method !== 'GET' && req.method !== 'HEAD');
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const db = getDB();
    const ip = clientIp(req);
    const username = clip(typeof body.username === 'string' ? body.username : '', 100).trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const keyUser = `u:${ip}:${username}`, keyIp = `i:${ip}`;
    const blockedUser = throttleState(db, keyUser, 6), blockedIp = throttleState(db, keyIp, 30);
    if (blockedUser.blocked || blockedIp.blocked) {
      const wait = Math.max(blockedUser.retryAfter || 0, blockedIp.retryAfter || 0);
      return send(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' }, { 'Retry-After': String(wait) });
    }
    const user = db.users.find((u) => u.username === username);
    const valid = verifyPassword(password, user ? user.password : DUMMY_PASSWORD);
    if (!user || !valid) {
      noteFailure(db, keyUser); noteFailure(db, keyIp);
      try { await saveDB(db); } catch { /* the block still applies on the next attempt */ }
      return send(res, 401, { error: 'Identifiants invalides' });
    }
    failuresClear(db, keyUser);
    const token = signToken(user);
    try { logActivity(db, user, 'login', user.username, {}); await saveDB(db); } catch { /* logging must never block sign-in */ }
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const h = req.headers.authorization || '';
    const s = readToken(h.startsWith('Bearer ') ? h.slice(7) : null);
    if (s && s.jti) {
      // Remember the signed-out token until it would have expired anyway.
      try {
        const db = getDB();
        const now = Date.now();
        db.revokedTokens = (Array.isArray(db.revokedTokens) ? db.revokedTokens : []).filter((r) => r.exp > now);
        db.revokedTokens.push({ jti: s.jti, exp: Number(s.expiresAt) || now + TOKEN_TTL });
        await saveDB(db);
      } catch { /* the client still forgets the token */ }
    }
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
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    if (method === 'GET') return send(res, 200, { items: db.users.map(publicUser) });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const name = clip(body.name, 100).trim();
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const commission = body.commission ? String(body.commission) : null;
    const role = body.role === undefined ? 'agent' : normalizeRole(String(body.role));
    if (!ROLES.includes(role)) return send(res, 400, { error: 'Rôle invalide' });
    if (role === 'agent' && !commission) return send(res, 400, { error: 'Choisissez le comité de ce compte' });
    if (username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) return send(res, 400, { error: 'Identifiant invalide (3 caractères minimum, lettres, chiffres, . _ -)' });
    if (db.users.some((u) => u.username === username)) return send(res, 409, { error: 'Cet identifiant existe déjà' });
    if (!name) return send(res, 400, { error: 'Le nom est obligatoire' });
    if (password.length < 8) return send(res, 400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });
    if (!isValidCommission(db, commission)) return send(res, 400, { error: 'Comité invalide' });
    const created = { id: 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), username, name, password: hashPassword(password), role, commission, createdAt: new Date().toISOString() };
    db.users.push(created);
    logActivity(db, user, 'user.create', created.username, { role: created.role, commission: created.commission });
    await saveDB(db);
    return send(res, 201, { item: publicUser(created) });
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const target = db.users.find((u) => u.id === decodeURIComponent(userMatch[1]));
    if (!target) return send(res, 404, { error: 'Compte introuvable' });
    const body = await readBody(req);
    const name = clip(body.name ?? target.name, 100).trim();
    const commission = body.commission === undefined ? (target.commission || null) : (body.commission ? String(body.commission) : null);
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const role = body.role === undefined ? effectiveRole(target.role) : normalizeRole(String(body.role));
    if (!ROLES.includes(role)) return send(res, 400, { error: 'Rôle invalide' });
    if (!name) return send(res, 400, { error: 'Le nom est obligatoire' });
    if (!isValidCommission(db, commission)) return send(res, 400, { error: 'Comité invalide' });
    if (password && password.length < 8) return send(res, 400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });
    if (role !== effectiveRole(target.role) && target.id === user.id) return send(res, 400, { error: 'Vous ne pouvez pas changer votre propre rôle' });
    if (target.role === 'admin' && role !== 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) return send(res, 400, { error: 'Le dernier compte administrateur doit rester administrateur' });
    if (role === 'agent' && !commission) return send(res, 400, { error: 'Choisissez le comité de ce compte' });
    // A new password, role or comité signs the account out everywhere (old tokens stop working).
    if (password || role !== effectiveRole(target.role) || commission !== (target.commission || null)) target.sessionVersion = sessionVersion(target) + 1;
    target.name = name;
    target.commission = commission;
    target.role = role;
    if (password) target.password = hashPassword(password);
    logActivity(db, user, 'user.update', target.username, { role: target.role, commission: target.commission, passwordReset: Boolean(password) });
    await saveDB(db);
    // Changing your own password keeps you signed in on this device with a fresh token.
    return send(res, 200, { item: publicUser(target), ...(target.id === user.id ? { token: signToken(target) } : {}) });
  }

  if (userMatch && method === 'DELETE') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const id = decodeURIComponent(userMatch[1]);
    const target = db.users.find((u) => u.id === id);
    if (!target) return send(res, 404, { error: 'Compte introuvable' });
    if (target.id === user.id) return send(res, 400, { error: 'Vous ne pouvez pas supprimer votre propre compte' });
    if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) return send(res, 400, { error: 'Le dernier compte administrateur ne peut pas être supprimé' });
    db.users = db.users.filter((u) => u.id !== id);
    logActivity(db, user, 'user.delete', target.username, {});
    await saveDB(db);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/activity' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const action = url.searchParams.get('action') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
    const items = (db.activity || []).filter((a) => !action || a.action.startsWith(action)).slice(-limit).reverse();
    return send(res, 200, { items, total: (db.activity || []).length });
  }

  if (pathname === '/api/notifications' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    if (isAdminLike(user) || !user.commission) return send(res, 200, { unread: 0, items: [] });
    const items = db.letters.filter((l) => l.commission === user.commission && isUnread(l))
      .map((l) => { const h = [...(l.commissionHisto || [])].reverse().find((e) => e.type === 'assigne' || e.type === 'transfert'); return { id: l.id, ref: l.ref, numeroLettre: l.numeroLettre || '', objet: l.objet || '', priorite: l.priorite || 'normale', date: h?.date || l.createdAt, fromCommittee: h?.fromCommittee || null, byName: h?.byName || '' }; })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return send(res, 200, { unread: items.length, items: items.slice(0, 50) });
  }

  if (pathname === '/api/committees' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    return send(res, 200, { items: db.committees });
  }

  // ---- Comité management (create + rename), admin only ----
  const committeeIdMatch = /^\/api\/committees\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if ((pathname === '/api/committees' && method === 'POST') || (committeeIdMatch && method === 'PATCH')) {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.role !== 'admin') return send(res, 403, { error: 'Droits insuffisants' });
    // Force a fresh read: warm serverless instances keep an in-memory copy of
    // the state, which can predate a committee created moments ago.
    await initializeDB(true);
    const db = getDB();
    const body = await readBody(req);
    const nom = String(body.nom || '').trim().replace(/\s+/g, ' ');
    if (nom.length < 2 || nom.length > 80) return send(res, 400, { error: 'Le nom du comité doit contenir entre 2 et 80 caractères' });
    if (db.committees.some((c) => c.nom.toLowerCase() === nom.toLowerCase())) return send(res, 400, { error: 'Un comité porte déjà ce nom' });

    if (method === 'POST') {
      const committee = { id: 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nom };
      db.committees.push(committee);
      logActivity(db, user, 'committee.create', nom, { committeeId: committee.id, by: user.name });
      await saveDB(db);
      return send(res, 201, { item: committee });
    }

    // PATCH: rename; references stay valid because everything points to the id
    const committee = db.committees.find((c) => c.id === committeeIdMatch[1]);
    if (!committee) return send(res, 404, { error: 'Comité introuvable' });
    if (committee.nom === nom) return send(res, 200, { item: committee });
    const oldNom = committee.nom;
    committee.nom = nom;
    logActivity(db, user, 'committee.update', nom, { committeeId: committee.id, oldName: oldNom, by: user.name });
    await saveDB(db);
    return send(res, 200, { item: committee });
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
          if (!user || !['admin', 'supervisor', 'agent'].includes(user.role)) throw new Error('Droits insuffisants pour ajouter un fichier');
          let details;
          try { details = JSON.parse(clientPayload || '{}'); } catch { throw new Error('Informations du fichier invalides'); }
          if (details.courrier) {
            // Scanned courriers: admin / supervisor only.
            if (!isAdminLike(user)) throw new Error('Droits insuffisants pour ajouter un fichier');
            const crExt = path.extname(sanitizeFilename(details.filename)).toLowerCase();
            if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(crExt)) throw new Error('Format non pris en charge pour un gros fichier (PDF, JPG ou PNG)');
            if (!pathnameForBlob.startsWith('cr-') || path.extname(pathnameForBlob).toLowerCase() !== crExt) throw new Error('Chemin de fichier invalide');
            return { allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'], maximumSizeInBytes: 25 * 1024 * 1024, addRandomSuffix: true };
          }
          const letterId = String(details.letterId || '');
          const filename = sanitizeFilename(details.filename);
          const extension = path.extname(filename).toLowerCase();
          const letter = getDB().letters.find((item) => item.id === letterId);
          if (!letter) throw new Error('Lettre introuvable');
          if (!canAttach(user, letter) && !canSeeLetter(user, letter)) throw new Error('Lettre introuvable');
          if (!canAttach(user, letter)) throw new Error(NOT_IN_COMMITTEE);
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
    const isAdmin = isAdminLike(user);
    const myCommission = user.commission || null;
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
    const q = fold((url.searchParams.get('q') || '').trim());
    const expediteurQ = fold((url.searchParams.get('expediteur') || '').trim());
    const direction = url.searchParams.get('direction') || '';
    const statut = url.searchParams.get('statut') || '';
    const type = url.searchParams.get('type') || '';
    const categorie = url.searchParams.get('categorie') || '';
    const priorite = url.searchParams.get('priorite') || '';
    const commission = url.searchParams.get('commission') || '';
    const from = validDate(url.searchParams.get('from'), false);
    const to = validDate(url.searchParams.get('to'), true);

    const isAdmin = isAdminLike(user);
    const myCommission = user.commission || null;

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
      if (expediteurQ) {
        const sender = fold([l.expediteur?.nom, l.expediteur?.fonction, l.expediteur?.service, l.createdByName].join(' '));
        if (!sender.includes(expediteurQ)) return false;
      }
      if (q) {
        const names = (id) => (db.committees || []).find((c) => c.id === id)?.nom || '';
        // Search over what the caller is allowed to see: tracking notes are
        // bureau-private, so a comité must not be able to probe their content
        // through search matches.
        const view = letterView(user, l);
        const hay = fold([
          view.ref, view.numeroLettre, view.objet, view.personneConcernee, view.resume,
          view.expediteur?.nom, view.destinataire?.nom, view.expediteur?.fonction, view.destinataire?.fonction, view.expediteur?.service, view.destinataire?.service, view.service,
          view.createdByName, names(view.commission),
          ...(view.pieces || []).map((p) => p.nom),
          ...(isAdminLike(user) ? (l.commissionHisto || []).map((h) => h.note) : []),
        ].join(' '));
        // Every word must match somewhere, in any order.
        if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
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

    return send(res, 200, { items: pageItems.map((l) => ({ ...letterView(user, l), unread: !isAdmin && l.commission === user.commission && isUnread(l) })), total, page, limit });
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
      return send(res, 200, { item: letterView(user, letter) });
    }

    if (method === 'PATCH') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!['admin', 'supervisor', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
      const letter = db.letters.find((l) => l.id === id);
      if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      if (!holdsLetter(user, letter)) return send(res, 403, { error: NOT_IN_COMMITTEE });
      const body = await readBody(req);
      const nextStatut = body.statut !== undefined ? body.statut : letter.statut;
      if (!isValidStatut(nextStatut)) return send(res, 400, { error: 'Statut invalide' });
      const prevCommission = letter.commission || null;
      const nextCommission = body.commission !== undefined ? (body.commission || null) : prevCommission;
      if (!isValidCommission(db, nextCommission)) return send(res, 400, { error: 'Comité invalide' });
      // A comité's transfer needs bureau approval: record a pending request
      // instead of moving the letter. Admin/supervisor transfers stay instant.
      const wantsCommission = body.commission !== undefined && nextCommission !== prevCommission;
      if (!isAdminLike(user) && wantsCommission) {
        letter.pendingTransfer = {
          to: nextCommission,
          note: clip(body.commissionNote, 2000),
          requestedBy: user.id,
          requestedByName: user.name,
          requestedAt: new Date().toISOString(),
        };
        letter.updatedAt = new Date().toISOString();
        logActivity(db, user, 'letter.transfer.request', letter.ref, { letterId: letter.id, from: prevCommission, to: nextCommission });
        await saveDB(db);
        return send(res, 200, { item: letterView(user, letter), pendingApproval: true, message: 'Transfert soumis — en attente d’approbation du bureau d’ordre' });
      }
      if (wantsCommission) letter.pendingTransfer = null;
      if (body.ref && isAdminLike(user)) letter.ref = clip(body.ref, 60);
      if (body.numeroLettre !== undefined) letter.numeroLettre = clip(body.numeroLettre, 60);
      Object.assign(letter, {
        direction: body.direction !== undefined ? (body.direction === 'sortant' ? 'sortant' : 'entrant') : letter.direction,
        type: body.type !== undefined ? (isValidType(body.type) ? body.type : letter.type) : letter.type,
        categorie: body.categorie !== undefined ? (isValidCategorie(body.categorie) ? body.categorie : letter.categorie) : letter.categorie,
        objet: body.objet !== undefined ? clip(body.objet, 300) : letter.objet,
        personneConcernee: body.personneConcernee !== undefined ? clip(body.personneConcernee, 200) : (letter.personneConcernee || ''),
        resume: body.resume !== undefined ? clip(body.resume, 5000) : letter.resume,
        priorite: body.priorite !== undefined ? (isValidPriorite(body.priorite) ? body.priorite : letter.priorite) : letter.priorite,
        statut: nextStatut,
        expediteur: body.expediteur !== undefined ? cleanParty(body.expediteur) : letter.expediteur,
        destinataire: body.destinataire !== undefined ? cleanParty(body.destinataire) : letter.destinataire,
        dateEmission: body.dateEmission !== undefined ? cleanDate(body.dateEmission, letter.dateEmission) : letter.dateEmission,
        dateReception: body.dateReception !== undefined ? cleanDate(body.dateReception, letter.dateReception || null) : letter.dateReception,
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
          note: clip(body.commissionNote, 2000),
        });
        if (body.statut === undefined) letter.statut = 'en_cours';
      }
      letter.updatedAt = new Date().toISOString();
      logActivity(db, user, nextCommission !== prevCommission ? 'letter.transfer' : 'letter.update', letter.ref, { letterId: letter.id, from: prevCommission, to: nextCommission });
      await saveDB(db);
      const updated = db.letters.find((l) => l.id === id);
      return send(res, 200, { item: letterView(user, updated) });
    }

    if (method === 'DELETE') {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
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
      logActivity(db, user, 'letter.delete', letter.ref, { objet: letter.objet });
      await saveDB(db);
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/letters' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user) && user.role !== 'agent') return send(res, 403, { error: 'Droits insuffisants' });
    const body = await readBody(req);
    const db = getDB();
    if (!isValidCommission(db, body.commission || null)) return send(res, 400, { error: 'Comité invalide' });
    // A comité account must say which comité the letter goes to (its own or any other).
    if (user.role === 'agent' && !body.commission) return send(res, 400, { error: 'Choisissez le comité destinataire' });
    const commission = body.commission || null;
    const statut = body.statut || (commission ? 'en_cours' : 'recu');
    if (!isValidStatut(statut)) return send(res, 400, { error: 'Statut invalide' });
    const commissionHisto = commission
      ? [{ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: new Date().toISOString(), type: 'assigne', committee: commission, fromCommittee: null, by: user.id, byName: user.name, note: '' }]
      : [];
    const lettre = {
      id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ref: (isAdminLike(user) && body.ref) ? clip(body.ref, 60) : nextRef(db),
      numeroLettre: clip(body.numeroLettre, 60),
      direction: body.direction === 'sortant' ? 'sortant' : 'entrant',
      type: isValidType(body.type) ? body.type : 'courrier',
      categorie: isValidCategorie(body.categorie) ? body.categorie : 'autre',
      objet: clip(body.objet, 300),
      personneConcernee: clip(body.personneConcernee, 200),
      resume: clip(body.resume, 5000),
      priorite: isValidPriorite(body.priorite) ? body.priorite : 'normale',
      statut,
      commission,
      commissionHisto,
      expediteur: cleanParty(body.expediteur),
      destinataire: cleanParty(body.destinataire),
      dateEmission: cleanDate(body.dateEmission, new Date().toISOString()),
      dateReception: body.direction === 'entrant' ? cleanDate(body.dateReception, new Date().toISOString()) : cleanDate(body.dateReception, null),
      // Files are only ever attached through the upload routes; a client can never name a stored file itself.
      pieces: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: user.name,
      createdByCommission: user.commission || null,
    };
    db.letters.push(lettre);
    logActivity(db, user, 'letter.create', lettre.ref, { letterId: lettre.id, to: commission });
    await saveDB(db);
    return send(res, 201, { item: letterView(user, lettre) });
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
    if (!canManage) return send(res, 403, { error: NOT_IN_COMMITTEE });
    if (type !== 'note' && !letter.commission) return send(res, 400, { error: 'Aucun comité assigné' });
    if (type === 'vu_comite' && !isUnread(letter)) return send(res, 200, { item: letterView(user, letter) });
    const event = {
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: new Date().toISOString(),
      type,
      committee: letter.commission,
      by: user.id, byName: user.name,
      note: clip(body.note, 2000),
    };
    letter.commissionHisto.push(event);
    if (type === 'recu_comite' || type === 'vu_comite') letter.statut = 'en_cours';
    if (type === 'traite_comite') letter.statut = 'archive';
    letter.updatedAt = new Date().toISOString();
    logActivity(db, user, 'letter.event', letter.ref, { letterId: letter.id, type });
    await saveDB(db);
    return send(res, 200, { item: letterView(user, db.letters.find((l) => l.id === letter.id)) });
  }

  // ---- Transfer approvals -------------------------------------------------------------
  // A comité's transfer request is stored on the letter as `pendingTransfer` until
  // a supervisor/admin approves it (then it is applied), rejects it, or the
  // requester (or an admin) cancels it.
  if (pathname === '/api/transfer-requests' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const items = db.letters
      .filter((l) => l.pendingTransfer)
      .map((l) => ({
        letterId: l.id,
        ref: l.ref || '',
        objet: l.objet || '',
        from: l.commission || null,
        to: l.pendingTransfer.to,
        note: l.pendingTransfer.note || '',
        requestedByName: l.pendingTransfer.requestedByName || '',
        requestedAt: l.pendingTransfer.requestedAt,
      }))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
    return send(res, 200, { items });
  }

  const approvalMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/transfer-approval$/.exec(pathname);
  if (approvalMatch && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const letter = db.letters.find((l) => l.id === approvalMatch[1]);
    if (!letter || !letter.pendingTransfer) return send(res, 404, { error: 'Demande de transfert introuvable' });
    const body = await readBody(req);
    const action = String(body.action || '');
    if (!['approve', 'reject', 'cancel'].includes(action)) return send(res, 400, { error: 'Action invalide' });
    const pending = letter.pendingTransfer;
    const prevCommission = letter.commission || null;

    if (action === 'cancel') {
      // The requester (while they still hold the letter) or an admin may cancel.
      if (!isAdminLike(user) && !(user.id === pending.requestedBy && holdsLetter(user, letter))) {
        return send(res, 403, { error: 'Seul l’auteur de la demande ou le bureau d’ordre peut l’annuler' });
      }
      letter.pendingTransfer = null;
      letter.updatedAt = new Date().toISOString();
      logActivity(db, user, 'letter.transfer.cancel', letter.ref, { letterId: letter.id, to: pending.to });
      await saveDB(db);
      return send(res, 200, { item: letterView(user, letter), message: 'Demande de transfert annulée' });
    }

    // approve / reject: bureau d'ordre only
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    if (action === 'reject') {
      letter.pendingTransfer = null;
      letter.updatedAt = new Date().toISOString();
      logActivity(db, user, 'letter.transfer.reject', letter.ref, { letterId: letter.id, from: prevCommission, to: pending.to });
      await saveDB(db);
      return send(res, 200, { item: letterView(user, letter), message: 'Transfert refusé' });
    }
    // approve: the destination committee must still exist
    if (!isValidCommission(db, pending.to)) {
      letter.pendingTransfer = null;
      await saveDB(db);
      return send(res, 400, { error: 'Le comité destinataire n’existe plus — demande annulée' });
    }
    letter.commission = pending.to;
    letter.commissionHisto.push({
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: new Date().toISOString(),
      type: 'transfert',
      committee: pending.to,
      fromCommittee: prevCommission || null,
      by: pending.requestedBy || null, byName: pending.requestedByName || '',
      approvedBy: user.id, approvedByName: user.name,
      note: pending.note || '',
    });
    letter.statut = 'en_cours';
    letter.pendingTransfer = null;
    letter.updatedAt = new Date().toISOString();
    logActivity(db, user, 'letter.transfer.approve', letter.ref, { letterId: letter.id, from: prevCommission, to: pending.to });
    await saveDB(db);
    return send(res, 200, { item: letterView(user, letter), message: 'Transfert approuvé' });
  }

  // Attachments (scanned letter PDF): upload / stream / delete
  const completedUploadMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/pieces\/complete$/.exec(pathname);
  if (completedUploadMatch && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!['admin', 'supervisor', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const letterId = completedUploadMatch[1];
    const letter = db.letters.find((item) => item.id === letterId);
    if (!letter) return send(res, 404, { error: 'Lettre introuvable' });
    // access control: non-admins may only touch their own letters
    if (!canAttach(user, letter) && !canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
    if (!canAttach(user, letter)) return send(res, 403, { error: NOT_IN_COMMITTEE });
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
        logActivity(db, user, 'piece.add', letter.ref, { letterId: letter.id, file: piece.nom });
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
      if (!['admin', 'supervisor', 'agent'].includes(user.role)) return send(res, 403, { error: 'Droits insuffisants' });
      if (!canAttach(user, letter) && !canSeeLetter(user, letter)) return send(res, 404, { error: 'Lettre introuvable' });
      if (!canAttach(user, letter)) return send(res, 403, { error: NOT_IN_COMMITTEE });
      let body;
      try { body = await readBody(req, 14); } catch (e) { return send(res, 413, { error: 'Fichier trop volumineux (max ~10 Mo)' }); }
      const filename = sanitizeFilename(body.filename);
      if (!/^[A-Za-z0-9+/=\s]+$/.test(String(body.dataBase64 || ''))) return send(res, 400, { error: 'Données base64 invalides' });
      const buf = Buffer.from(String(body.dataBase64), 'base64');
      if (!buf.length) return send(res, 400, { error: 'Fichier vide' });
      if (buf.length > 10 * 1024 * 1024) return send(res, 413, { error: 'Fichier trop volumineux (max 10 Mo)' });
      if (!fileLooksValid(buf, path.extname(filename).toLowerCase())) return send(res, 400, { error: 'Format non pris en charge : PDF, JPG ou PNG uniquement' });
      const storedAs = letterId + '-' + Date.now().toString(36) + '-' + filename.replace(/[^.\w]/g, '_');
      const uploadedAt = new Date().toISOString();
      if (process.env.VERCEL) {
        const { put } = await import('@vercel/blob');
        const blob = await put(storedAs, buf, { access: 'private', contentType: filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', addRandomSuffix: true });
        const piece = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), nom: filename, taille: buf.length, storedAs: blob.pathname, uploadedAt };
        letter.pieces.push(piece);
        letter.updatedAt = new Date().toISOString();
        logActivity(db, user, 'piece.add', letter.ref, { letterId: letter.id, file: piece.nom });
        await saveDB(db);
        return send(res, 201, { item: { id: piece.id, nom: piece.nom, taille: piece.taille, hasFile: true }, letters: db.letters.length });
      }
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, storedAs), buf);
      const piece = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), nom: filename, taille: buf.length, storedAs, uploadedAt };
      letter.pieces.push(piece);
      letter.updatedAt = new Date().toISOString();
      logActivity(db, user, 'piece.add', letter.ref, { letterId: letter.id, file: piece.nom });
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
      const user = authUserForFile(req, res, 'piece', `${letterId}/${pieceId}`, db);
      if (!user) return;
      if (!canSeeLetter(user, letter)) return send(res, 404, { error: 'Fichier non disponible' });
      const piece = (letter.pieces || []).find((p) => p.id === pieceId);
      if (!piece || !piece.storedAs) return send(res, 404, { error: 'Fichier non disponible' });
      // Log the view AFTER the file has streamed (see courrier handler).
      const logView = () => { try { logActivity(db, user, 'letter.file.view', letter.ref, { letterId: letter.id, file: piece.nom }); Promise.resolve(saveDB(db)).catch(() => {}); } catch { /* logging must never break the file */ } };
      if (process.env.VERCEL) {
        const { get } = await import('@vercel/blob');
        const blob = await get(piece.storedAs, { access: 'private' });
        if (!blob || blob.statusCode !== 200) return send(res, 404, { error: 'Fichier non disponible' });
        const ext = path.extname(piece.nom).toLowerCase();
        const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
        res.writeHead(200, { ...FILE_RESPONSE_HEADERS, 'Content-Type': mime, 'Content-Disposition': fileDisposition(piece.nom) });
        const { Readable } = await import('node:stream');
        Readable.fromWeb(blob.stream).pipe(res);
        res.on('finish', logView);
        return;
      }
      if (!storedNameOk(piece.storedAs)) return send(res, 404, { error: 'Fichier non disponible' });
      const filePath = path.join(UPLOAD_DIR, piece.storedAs);
      if (!fs.existsSync(filePath)) return send(res, 404, { error: 'Fichier non disponible' });
      const ext = path.extname(piece.storedAs).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        ...FILE_RESPONSE_HEADERS,
        'Content-Type': mime,
        'Content-Length': data.length,
        'Content-Disposition': fileDisposition(piece.nom),
      });
      res.end(data);
      logView();
      return;
    }

    if (method === 'DELETE' && pieceId) {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
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
      logActivity(db, user, 'piece.delete', letter.ref, { letterId: letter.id });
      await saveDB(db);
      return send(res, 200, { ok: true });
    }
  }

  // ---- Signed file links (for the in-app viewer) ----
  if (pathname === '/api/file-link' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const kind = url.searchParams.get('kind') || '';
    const id = String(url.searchParams.get('id') || '');
    let target = null;
    let ok = false;
    let base = '';
    if (kind === 'courrier') {
      const c = (db.courriers || []).find((x) => x.id === id);
      ok = !!c && !!c.storedAs && (isAdminLike(user) || c.uploadedBy === user.id);
      target = c;
      base = `/api/courriers/${id}/file`;
    } else if (kind === 'piece') {
      const sep = id.indexOf('/');
      const letterId = sep > 0 ? id.slice(0, sep) : '';
      const pieceId = sep > 0 ? id.slice(sep + 1) : '';
      const letter = (db.letters || []).find((l) => l.id === letterId);
      const piece = letter ? (letter.pieces || []).find((p) => p.id === pieceId) : null;
      ok = !!letter && !!piece && !!piece.storedAs && canSeeLetter(user, letter);
      target = piece;
      base = `/api/letters/${letterId}/pieces/${pieceId}`;
    }
    if (!ok || !target) return send(res, 404, { error: 'Fichier non disponible' });
    const ext = path.extname(target.nom || '').toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
    return send(res, 200, { url: `${base}?tk=${signFileToken(user.id, kind, id)}`, mime });
  }

  // ---- Courriers (scanned files awaiting supervisor validation) ----
  if (pathname === '/api/courriers' && (method === 'GET' || method === 'POST')) {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    if (method === 'GET') {
      const status = url.searchParams.get('status') || '';
      let items = Array.isArray(db.courriers) ? db.courriers : [];
      // non-admins see their own uploaded courriers; admin/supervisor see all
      if (!isAdminLike(user)) {
        items = items.filter((c) => c.uploadedBy === user.id);
      }
      if (status) items = items.filter((c) => c.status === status);
      items = [...items].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return send(res, 200, { items });
    }
    // POST: upload a scanned courrier (admin / supervisor only)
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    let body;
    try { body = await readBody(req, 14); } catch (e) { return send(res, 413, { error: 'Fichier trop volumineux (max ~10 Mo)' }); }
    const filename = sanitizeFilename(body.filename);
    if (!/^[A-Za-z0-9+/=\s]+$/.test(String(body.dataBase64 || ''))) return send(res, 400, { error: 'Données base64 invalides' });
    const buf = Buffer.from(String(body.dataBase64), 'base64');
    if (!buf.length) return send(res, 400, { error: 'Fichier vide' });
    if (buf.length > 10 * 1024 * 1024) return send(res, 413, { error: 'Fichier trop volumineux (max 10 Mo)' });
    const storedAs = 'cr-' + Date.now().toString(36) + '-' + filename.replace(/[^.\w]/g, '_');
    const uploadedAt = new Date().toISOString();
    if (process.env.VERCEL) {
      const { put } = await import('@vercel/blob');
      const blob = await put(storedAs, buf, { access: 'private', contentType: filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', addRandomSuffix: true });
      const courrier = { id: 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nom: filename, taille: buf.length, storedAs: blob.pathname, uploadedBy: user.id, uploadedByName: user.name, uploadedAt, status: 'a_valider', note: '', rejectionReason: '', validatedBy: null, validatedAt: null, letterId: null };
      db.courriers.push(courrier);
      logActivity(db, user, 'courrier.upload', filename, { courrierId: courrier.id });
      await saveDB(db);
      return send(res, 201, { item: courrier });
    }
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, storedAs), buf);
    const courrier = { id: 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nom: filename, taille: buf.length, storedAs, uploadedBy: user.id, uploadedByName: user.name, uploadedAt, status: 'a_valider', note: '', rejectionReason: '', validatedBy: null, validatedAt: null, letterId: null };
    db.courriers.push(courrier);
    logActivity(db, user, 'courrier.upload', filename, { courrierId: courrier.id });
    await saveDB(db);
    return send(res, 201, { item: courrier });
  }

  if (pathname === '/api/courriers/complete' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    let body;
    try { body = await readBody(req, 1); } catch { return send(res, 400, { error: 'Requête invalide' }); }
    const pathnameForBlob = String(body.pathname || '');
    const filename = sanitizeFilename(body.filename);
    const ext = path.extname(filename).toLowerCase();
    if (!pathnameForBlob.startsWith('cr-') || !/^[\w.-]+$/.test(pathnameForBlob) || pathnameForBlob.includes('..') || path.extname(pathnameForBlob).toLowerCase() !== ext) return send(res, 400, { error: 'Chemin de fichier invalide' });
    try {
      const { head } = await import('@vercel/blob');
      const blob = await head(pathnameForBlob, { access: 'private' });
      if (blob.size > 25 * 1024 * 1024) return send(res, 413, { error: 'Fichier trop volumineux (25 Mo maximum)' });
      const db = getDB();
      let courrier = db.courriers.find((c) => c.storedAs === pathnameForBlob);
      if (!courrier) {
        courrier = { id: 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), nom: filename, taille: blob.size, storedAs: pathnameForBlob, uploadedBy: user.id, uploadedByName: user.name, uploadedAt: new Date().toISOString(), status: 'a_valider', note: '', rejectionReason: '', validatedBy: null, validatedAt: null, letterId: null };
        db.courriers.push(courrier);
        logActivity(db, user, 'courrier.upload', filename, { courrierId: courrier.id });
        await saveDB(db);
      }
      return send(res, 201, { item: courrier });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Fichier téléversé, mais enregistrement impossible' });
    }
  }

  // ---- "À envoyer": validated scans waiting for the admin to pick the comité ----
  if (pathname === '/api/to-send' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const mine = db.letters.filter((l) => l.fromCourrier);
    const view = (l) => {
      const c = (db.courriers || []).find((x) => x.id === l.fromCourrier);
      return { id: l.id, ref: l.ref, objet: l.objet, priorite: l.priorite, commission: l.commission, validatedAt: c?.validatedAt || l.createdAt, validatedBy: c ? (db.users.find((u) => u.id === c.validatedBy)?.name || '') : '', uploadedByName: c?.uploadedByName || '', fileName: c?.nom || '', pieceId: (l.pieces || [])[0]?.id || null, sentAt: (l.commissionHisto || []).find((h) => h.type === 'assigne')?.date || null };
    };
    const waiting = mine.filter((l) => !l.commission).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(view);
    const sent = mine.filter((l) => l.commission).sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1)).slice(0, 15).map(view);
    return send(res, 200, { waiting, sent });
  }

  const courrierMatch = /^\/api\/courriers\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (courrierMatch && (method === 'PATCH' || method === 'DELETE')) {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!isAdminLike(user)) return send(res, 403, { error: 'Droits insuffisants' });
    const db = getDB();
    const courrier = db.courriers.find((c) => c.id === courrierMatch[1]);
    if (!courrier) return send(res, 404, { error: 'Courrier introuvable' });

    // DELETE: remove a courrier (e.g. a rejected scan) — admin/supervisor only
    if (method === 'DELETE') {
      const idx = db.courriers.findIndex((c) => c.id === courrier.id);
      if (idx >= 0) db.courriers.splice(idx, 1);
      logActivity(db, user, courrier.status === 'rejete' ? 'courrier.reject_delete' : 'courrier.delete', courrier.nom, { courrierId: courrier.id, by: user.name });
      await saveDB(db);
      return send(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const action = String(body.action || '');
    if ((action === 'valide' || action === 'rejete') && courrier.status !== 'a_valider') {
      return send(res, 409, { error: courrier.status === 'valide' ? 'Ce courrier a déjà été validé' : 'Ce courrier a déjà été traité' });
    }
    if (action === 'valide') {
      // auto-create a letter (status recu) with the PDF attached
      const letter = {
        id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        ref: nextRef(db),
        numeroLettre: courrier.nom,
        direction: 'entrant',
        type: 'courrier',
        categorie: 'administration',
        objet: courrier.nom.replace(/\.pdf$/i, ''),
        personneConcernee: '',
        resume: clip(body.note, 5000),
        priorite: 'normale',
        statut: 'recu',
        commission: null,
        commissionHisto: [],
        expediteur: { nom: courrier.uploadedByName || '', fonction: '', service: '' },
        destinataire: { nom: 'Bureau ordre', fonction: '', service: '' },
        dateEmission: courrier.uploadedAt,
        dateReception: new Date().toISOString(),
        pieces: [{ id: 'p' + Date.now().toString(36), nom: courrier.nom, taille: courrier.taille, storedAs: courrier.storedAs, uploadedAt: courrier.uploadedAt }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: user.id,
      };
      letter.fromCourrier = courrier.id;
      db.letters.push(letter);
      courrier.status = 'valide';
      courrier.validatedBy = user.id;
      courrier.validatedAt = new Date().toISOString();
      courrier.note = clip(body.note, 5000);
      courrier.letterId = letter.id;
      logActivity(db, user, 'courrier.validate', courrier.nom, { courrierId: courrier.id, letterRef: letter.ref, by: user.name });
      await saveDB(db);
      return send(res, 200, { item: courrier, letter: letterView(user, letter) });
    }
    if (action === 'rejete') {
      courrier.status = 'rejete';
      courrier.validatedBy = user.id;
      courrier.validatedAt = new Date().toISOString();
      courrier.rejectionReason = clip(body.rejectionReason || body.note, 500);
      courrier.note = clip(body.note, 5000);
      // notify the sender
      db.notifications.push({
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        userId: courrier.uploadedBy,
        type: 'courrier_rejete',
        message: `Courrier "${courrier.nom}" rejeté: ${courrier.rejectionReason || 'non conforme'}`,
        courrierId: courrier.id,
        read: false,
        createdAt: new Date().toISOString(),
      });
      // cap: notifications must never grow unbounded in the shared state
      if (db.notifications.length > 500) db.notifications = db.notifications.slice(-500);
      logActivity(db, user, 'courrier.reject', courrier.nom, { courrierId: courrier.id, reason: courrier.rejectionReason || '', sender: courrier.uploadedByName || '', by: user.name });
      await saveDB(db);
      return send(res, 200, { item: courrier });
    }
    return send(res, 400, { error: 'Action invalide' });
  }

  const courrierFileMatch = /^\/api\/courriers\/([A-Za-z0-9_-]+)\/file$/.exec(pathname);
  if (courrierFileMatch && method === 'GET') {
    const db = getDB();
    const user = authUserForFile(req, res, 'courrier', courrierFileMatch[1], db);
    if (!user) return;
    const courrier = db.courriers.find((c) => c.id === courrierFileMatch[1]);
    if (!courrier || !courrier.storedAs) return send(res, 404, { error: 'Fichier non disponible' });
    // access: admin/supervisor or uploader
    if (!isAdminLike(user) && courrier.uploadedBy !== user.id) return send(res, 404, { error: 'Fichier non disponible' });
    // Log the view AFTER the file has streamed: a synchronous save here (a
    // database write) would delay the first byte of the PDF by ~1s.
    const logView = () => { try { logActivity(db, user, 'courrier.file.view', courrier.nom, { courrierId: courrier.id }); Promise.resolve(saveDB(db)).catch(() => {}); } catch { /* logging must never break the file */ } };
    if (process.env.VERCEL) {
      const { get } = await import('@vercel/blob');
      const blob = await get(courrier.storedAs, { access: 'private' });
      if (!blob || blob.statusCode !== 200) return send(res, 404, { error: 'Fichier non disponible' });
      const ext = path.extname(courrier.nom).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { ...FILE_RESPONSE_HEADERS, 'Content-Type': mime, 'Content-Disposition': fileDisposition(courrier.nom) });
      const { Readable } = await import('node:stream');
      Readable.fromWeb(blob.stream).pipe(res);
      res.on('finish', logView);
      return;
    }
    if (!storedNameOk(courrier.storedAs)) return send(res, 404, { error: 'Fichier non disponible' });
    const filePath = path.join(UPLOAD_DIR, courrier.storedAs);
    if (!fs.existsSync(filePath)) return send(res, 404, { error: 'Fichier non disponible' });
    const ext = path.extname(courrier.storedAs).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { ...FILE_RESPONSE_HEADERS, 'Content-Type': mime, 'Content-Length': data.length, 'Content-Disposition': fileDisposition(courrier.nom) });
    res.end(data);
    logView();
    return;
  }

  // ---- Courrier notifications (rejections) ----
  if (pathname === '/api/courrier-notifications' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const items = (db.notifications || []).filter((n) => n.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return send(res, 200, { items, unread: items.filter((n) => !n.read).length });
  }

  const notifMatch = /^\/api\/courrier-notifications\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (notifMatch && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    const db = getDB();
    const n = db.notifications.find((x) => x.id === notifMatch[1] && x.userId === user.id);
    if (!n) return send(res, 404, { error: 'Notification introuvable' });
    const body = await readBody(req);
    if (body.read !== undefined) n.read = !!body.read;
    await saveDB(db);
    return send(res, 200, { item: n });
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
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType, 'Cache-Control': ext === '.html' || path.basename(filePath) === 'sw.js' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
    return;
  }

  return send(res, 404, { error: 'Not found' });
}

if (!process.env.VERCEL) server.listen(PORT, () => {
  console.log(`Bureau Ordre server listening on http://localhost:${PORT}`);
});


export { route };
