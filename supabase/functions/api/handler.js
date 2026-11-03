// Bureau d'Ordre API. Pure Web-standard code: (Request) => Response.
// It runs unchanged on Supabase Edge Functions (production) and on Node (local `node server/index.js`).
// All persistence goes through `store` (data) and `storage` (scanned files), so the same logic is
// used with Postgres + Supabase Storage in production and with a JSON file + a folder locally.
import { hashPassword, verifyPassword, needsRehash, signToken, verifyToken, sha256Hex } from './auth.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIECES_PER_LETTER = 20;
const MAX_JSON_BYTES = 1024 * 1024;
const FILE_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const STATUTS = ['recu', 'enregistre', 'en_cours', 'traite', 'transmis', 'archive'];
const TYPES = ['officielle', 'arrete', 'decret', 'note', 'courrier', 'mandat', 'autre'];
const CATEGORIES = ['administration', 'juridique', 'finances', 'rh', 'communication', 'securite', 'autre'];
const PRIORITES = ['normale', 'urgente', 'confidentielle'];
const DIRECTIONS = ['entrant', 'sortant'];
const COMMISSION_EVENTS = ['recu_comite', 'traite_comite', 'note'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (status, data, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function extname(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

function sanitizeFilename(name) {
  const base = String(name || 'document.pdf').split(/[\\/]/).pop();
  return base.replace(/[^\w., ()\-À-ſ]/g, '_').slice(0, 120) || 'document.pdf';
}

// The real content of the file must match its extension (a renamed .exe is not a PDF).
function matchesFileType(ext, bytes) {
  if (ext === '.pdf') {
    const n = Math.min(bytes.length, 1024) - 3;
    for (let i = 0; i < n; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) return true; // %PDF
    }
    return false;
  }
  if (ext === '.png') return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (ext === '.jpg' || ext === '.jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

function validDate(v) {
  return v === undefined || v === null || v === '' || !Number.isNaN(new Date(v).getTime());
}

function cleanParty(p, fallback) {
  if (p === undefined) return fallback;
  if (typeof p === 'string') return { nom: p, fonction: '', service: '' };
  if (!p || typeof p !== 'object') return { nom: '', fonction: '', service: '' };
  return { nom: String(p.nom || ''), fonction: String(p.fonction || ''), service: String(p.service || '') };
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

function publicLetter(l) {
  return {
    ...l,
    numeroLettre: l.numeroLettre || '',
    commission: l.commission || null,
    commissionHisto: Array.isArray(l.commissionHisto) ? l.commissionHisto : [],
    pieces: (l.pieces || []).map((p) => ({ id: p.id, nom: p.nom, taille: p.taille, hasFile: !!p.storedAs })),
  };
}

async function readJson(req, limitBytes = MAX_JSON_BYTES) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > limitBytes) throw new HttpError(413, 'Requête trop volumineuse');
  const text = await req.text();
  if (text.length > limitBytes) throw new HttpError(413, 'Requête trop volumineuse');
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new HttpError(400, 'Requête invalide');
  }
}

export function createHandler({ store, storage, now = () => Date.now() }) {
  let secretPromise = null;
  const getSecret = () => {
    secretPromise ??= store.getTokenSecret().catch((e) => { secretPromise = null; throw e; });
    return secretPromise;
  };

  // Best-effort brake on password guessing (per server instance).
  const failures = new Map();
  const LOCK_AFTER = 5;
  const LOCK_MS = 10 * 60 * 1000;
  const loginKey = (req, username) => `${username}|${(req.headers.get('x-forwarded-for') || '').split(',')[0].trim()}`;
  const isLocked = (key) => {
    const f = failures.get(key);
    if (!f) return false;
    if (f.until && f.until > now()) return true;
    if (f.until && f.until <= now()) failures.delete(key);
    return false;
  };
  const noteFailure = (key) => {
    if (failures.size > 5000) failures.clear();
    const f = failures.get(key) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= LOCK_AFTER) { f.until = now() + LOCK_MS; f.n = 0; }
    failures.set(key, f);
  };

  const fingerprint = async (passwordHash) => (await sha256Hex(passwordHash)).slice(0, 16);
  const issueSession = async (user) =>
    signToken({ t: 's', uid: user.id, v: await fingerprint(user.passwordHash), exp: now() + SESSION_TTL_MS }, await getSecret());

  async function requireAuth(req) {
    const h = req.headers.get('authorization') || '';
    const p = h.startsWith('Bearer ') ? await verifyToken(h.slice(7), await getSecret(), now()) : null;
    const user = p && p.t === 's' ? await store.getUserById(p.uid) : null;
    // The fingerprint changes with the password, so changing it signs out every other session.
    if (!user || p.v !== (await fingerprint(user.passwordHash))) throw new HttpError(401, 'Unauthenticated');
    return user;
  }
  const requireWriter = async (req) => {
    const user = await requireAuth(req);
    if (!['admin', 'agent'].includes(user.role)) throw new HttpError(403, 'Droits insuffisants');
    return user;
  };
  const requireAdmin = async (req) => {
    const user = await requireAuth(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Droits insuffisants');
    return user;
  };

  async function mustGetLetter(id) {
    const letter = await store.getLetter(id);
    if (!letter) throw new HttpError(404, 'Lettre introuvable');
    return letter;
  }

  async function route(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    const apiAt = pathname.indexOf('/api/');
    if (apiAt > 0) pathname = pathname.slice(apiAt); // e.g. /functions/v1/api/letters -> /api/letters
    pathname = pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    if (pathname === '/api/health' && method === 'GET') return json(200, { ok: true });

    // ----- session -----
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJson(req);
      const username = String(body.username || '').trim().toLowerCase().slice(0, 100);
      const password = String(body.password || '').slice(0, 200);
      const key = loginKey(req, username);
      if (isLocked(key)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
      const user = username ? await store.getUserByUsername(username) : null;
      let ok = false;
      if (user) ok = await verifyPassword(password, user.passwordHash);
      else await hashPassword(password); // same cost whether or not the user exists
      if (!ok) { noteFailure(key); throw new HttpError(401, 'Identifiants invalides'); }
      failures.delete(key);
      if (needsRehash(user.passwordHash)) {
        user.passwordHash = await hashPassword(password);
        await store.setPasswordHash(user.id, user.passwordHash);
      }
      return json(200, { token: await issueSession(user), user: publicUser(user) });
    }

    if (pathname === '/api/logout' && method === 'POST') return json(200, { ok: true });

    if (pathname === '/api/me' && method === 'GET') {
      return json(200, { user: publicUser(await requireAuth(req)) });
    }

    if (pathname === '/api/me/password' && method === 'POST') {
      const user = await requireAuth(req);
      const body = await readJson(req);
      const current = String(body.current || '').slice(0, 200);
      const next = String(body.next || '');
      if (!(await verifyPassword(current, user.passwordHash))) throw new HttpError(400, 'Mot de passe actuel incorrect');
      if (next.length < 8) throw new HttpError(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères');
      if (next.length > 200) throw new HttpError(400, 'Le nouveau mot de passe est trop long');
      user.passwordHash = await hashPassword(next);
      await store.setPasswordHash(user.id, user.passwordHash);
      return json(200, { ok: true, token: await issueSession(user) });
    }

    // ----- reference data and dashboard -----
    if (pathname === '/api/committees' && method === 'GET') {
      await requireAuth(req);
      return json(200, { items: await store.listCommittees() });
    }

    if (pathname === '/api/stats' && method === 'GET') {
      await requireAuth(req);
      const rows = await store.statsRows();
      const parStatut = {}, parCategorie = {}, parType = {}, parCommission = {};
      let recusCeMois = 0, archivesCeMois = 0, traiteCeMois = 0, urgentes = 0, entrants = 0, sortants = 0;
      const d = new Date(now());
      const debutMois = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      for (const l of rows) {
        const k = l.statut || 'recu';
        parStatut[k] = (parStatut[k] || 0) + 1;
        const ck = l.categorie || 'autre';
        parCategorie[ck] = (parCategorie[ck] || 0) + 1;
        const tk = l.type || 'autre';
        parType[tk] = (parType[tk] || 0) + 1;
        const mk = l.commission || 'non_assigne';
        parCommission[mk] = (parCommission[mk] || 0) + 1;
        const dir = l.direction || 'entrant';
        if (dir === 'entrant') entrants++; else if (dir === 'sortant') sortants++;
        if (dir === 'entrant' && (l.dateReception || l.createdAt) >= debutMois) recusCeMois++;
        if (l.statut === 'archive' && (l.dateEmission || l.createdAt) >= debutMois) archivesCeMois++;
        if (l.statut === 'traite' && (l.dateEmission || l.createdAt) >= debutMois) traiteCeMois++;
        if (l.priorite === 'urgente') urgentes++;
      }
      return json(200, { total: rows.length, entrants, sortants, recusCeMois, archivesCeMois, traiteCeMois, urgentes, parStatut, parCategorie, parType, parCommission });
    }

    // ----- letters: list / create -----
    if (pathname === '/api/letters' && method === 'GET') {
      await requireAuth(req);
      const sp = url.searchParams;
      const dateParam = (name, endOfDay) => {
        const v = sp.get(name);
        if (!v) return null;
        const d = new Date(endOfDay ? v + 'T23:59:59.999Z' : v);
        if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date invalide');
        return d.toISOString();
      };
      const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 500);
      const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1);
      const { items, total } = await store.queryLetters({
        q: (sp.get('q') || '').trim().slice(0, 200),
        direction: sp.get('direction') || '',
        statut: sp.get('statut') || '',
        type: sp.get('type') || '',
        categorie: sp.get('categorie') || '',
        priorite: sp.get('priorite') || '',
        commission: sp.get('commission') || '',
        from: dateParam('from', false),
        to: dateParam('to', true),
        sort: sp.get('sort') === 'ref' ? 'ref' : 'date', // newest first
        limit,
        offset: (page - 1) * limit,
      });
      return json(200, { items: items.map(publicLetter), total, page, limit });
    }

    if (pathname === '/api/letters' && method === 'POST') {
      const user = await requireWriter(req);
      const body = await readJson(req);
      const commission = body.commission || null;
      if (!(await store.committeeExists(commission))) throw new HttpError(400, 'Comité invalide');
      const statut = body.statut || (commission ? 'transmis' : 'recu');
      if (!STATUTS.includes(statut)) throw new HttpError(400, 'Statut invalide');
      const direction = body.direction === undefined ? 'entrant' : body.direction;
      if (!DIRECTIONS.includes(direction)) throw new HttpError(400, 'Direction invalide');
      const type = body.type === undefined ? 'courrier' : body.type;
      if (!TYPES.includes(type)) throw new HttpError(400, 'Type invalide');
      const categorie = body.categorie === undefined ? 'autre' : body.categorie;
      if (!CATEGORIES.includes(categorie)) throw new HttpError(400, 'Catégorie invalide');
      const priorite = body.priorite === undefined ? 'normale' : body.priorite;
      if (!PRIORITES.includes(priorite)) throw new HttpError(400, 'Importance invalide');
      const objet = String(body.objet || '').trim();
      if (!objet) throw new HttpError(400, "L'objet est obligatoire");
      if (!validDate(body.dateEmission) || !validDate(body.dateReception)) throw new HttpError(400, 'Date invalide');
      const customRef = body.ref ? String(body.ref).trim().slice(0, 40) : '';
      const stamp = new Date(now()).toISOString();
      const letter = {
        id: newId('l'),
        ref: customRef,
        numeroLettre: String(body.numeroLettre || ''),
        direction, type, categorie,
        objet,
        resume: String(body.resume || ''),
        priorite, statut, commission,
        commissionHisto: commission
          ? [{ id: newId('h'), date: stamp, type: 'assigne', committee: commission, by: user.id, byName: user.name, note: '' }]
          : [],
        expediteur: cleanParty(body.expediteur, { nom: '', fonction: '', service: '' }),
        destinataire: cleanParty(body.destinataire, { nom: '', fonction: '', service: '' }),
        dateEmission: body.dateEmission || stamp,
        dateReception: direction === 'entrant' ? (body.dateReception || stamp) : (body.dateReception || null),
        pieces: [],
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: user.id,
      };
      if (customRef) {
        try { await store.insertLetter(letter); }
        catch (e) { throw e.code === 'DUPLICATE_REF' ? new HttpError(400, 'Cette référence est déjà utilisée') : e; }
      } else {
        for (let attempt = 0; ; attempt++) {
          letter.ref = await store.nextRef();
          try { await store.insertLetter(letter); break; }
          catch (e) { if (e.code !== 'DUPLICATE_REF' || attempt >= 5) throw e; }
        }
      }
      return json(201, { item: publicLetter(await mustGetLetter(letter.id)) });
    }

    // ----- upload target used when files are kept on the server's own disk (local mode) -----
    const putMatch = /^\/api\/upload\/([A-Za-z0-9_.-]+)$/.exec(pathname);
    if (putMatch && method === 'PUT') {
      const t = await verifyToken(putMatch[1], await getSecret(), now());
      if (!t || t.t !== 'p') throw new HttpError(401, 'Lien de dépôt invalide ou expiré');
      if (Number(req.headers.get('content-length') || 0) > MAX_FILE_BYTES) throw new HttpError(413, 'Fichier trop volumineux (max 10 Mo)');
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) throw new HttpError(400, 'Fichier vide');
      if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'Fichier trop volumineux (max 10 Mo)');
      await storage.put(t.key, bytes, t.mime);
      return json(200, { ok: true });
    }

    // ----- one letter -----
    const letterMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (letterMatch) {
      const id = letterMatch[1];

      if (method === 'GET') {
        await requireAuth(req);
        return json(200, { item: publicLetter(await mustGetLetter(id)) });
      }

      if (method === 'PATCH') {
        const user = await requireWriter(req);
        const letter = await mustGetLetter(id);
        const body = await readJson(req);

        // Validate everything first so a rejected edit never leaves a half-applied change.
        // A value is only checked when it actually changes, so older records stay editable.
        const changed = (key) => body[key] !== undefined && body[key] !== letter[key];
        if (changed('direction') && !DIRECTIONS.includes(body.direction)) throw new HttpError(400, 'Direction invalide');
        if (changed('type') && !TYPES.includes(body.type)) throw new HttpError(400, 'Type invalide');
        if (changed('categorie') && !CATEGORIES.includes(body.categorie)) throw new HttpError(400, 'Catégorie invalide');
        if (changed('priorite') && !PRIORITES.includes(body.priorite)) throw new HttpError(400, 'Importance invalide');
        if (body.objet !== undefined && !String(body.objet).trim()) throw new HttpError(400, "L'objet est obligatoire");
        if (!validDate(body.dateEmission) || !validDate(body.dateReception)) throw new HttpError(400, 'Date invalide');
        const nextStatut = body.statut !== undefined ? body.statut : letter.statut;
        if (!STATUTS.includes(nextStatut)) throw new HttpError(400, 'Statut invalide');
        const prevCommission = letter.commission || null;
        const nextCommission = body.commission !== undefined ? (body.commission || null) : prevCommission;
        if (!(await store.committeeExists(nextCommission))) throw new HttpError(400, 'Comité invalide');
        const nextRef = body.ref !== undefined ? String(body.ref).trim().slice(0, 40) : '';

        // Attachments are NOT editable here: they only change through the /pieces endpoints,
        // so an edit can never wipe or forge the list of stored files.
        const patch = {
          direction: body.direction !== undefined ? body.direction : letter.direction,
          type: body.type !== undefined ? body.type : letter.type,
          categorie: body.categorie !== undefined ? body.categorie : letter.categorie,
          objet: body.objet !== undefined ? String(body.objet).trim() : letter.objet,
          resume: body.resume !== undefined ? String(body.resume || '') : letter.resume,
          priorite: body.priorite !== undefined ? body.priorite : letter.priorite,
          statut: nextStatut,
          numeroLettre: body.numeroLettre !== undefined ? String(body.numeroLettre || '') : letter.numeroLettre,
          expediteur: cleanParty(body.expediteur, letter.expediteur),
          destinataire: cleanParty(body.destinataire, letter.destinataire),
          dateEmission: body.dateEmission !== undefined ? (body.dateEmission || letter.dateEmission) : letter.dateEmission,
          dateReception: body.dateReception !== undefined ? (body.dateReception || null) : letter.dateReception,
          commission: nextCommission,
        };
        if (nextRef && nextRef !== letter.ref) patch.ref = nextRef;
        const events = [];
        if (nextCommission && nextCommission !== prevCommission) {
          events.push({
            id: newId('h'), date: new Date(now()).toISOString(), type: 'assigne', committee: nextCommission,
            by: user.id, byName: user.name, note: String(body.commissionNote || ''),
          });
          if (body.statut === undefined) patch.statut = 'transmis';
        }
        try { await store.updateLetter(id, patch, events); }
        catch (e) { throw e.code === 'DUPLICATE_REF' ? new HttpError(400, 'Cette référence est déjà utilisée') : e; }
        return json(200, { item: publicLetter(await mustGetLetter(id)) });
      }

      if (method === 'DELETE') {
        await requireAdmin(req);
        const keys = await store.deleteLetter(id);
        if (keys === null) throw new HttpError(404, 'Lettre introuvable');
        await Promise.allSettled(keys.map((k) => storage.remove(k)));
        return json(200, { ok: true });
      }
    }

    // ----- committee tracking -----
    const eventsMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/commission-events$/.exec(pathname);
    if (eventsMatch && method === 'POST') {
      const user = await requireWriter(req);
      const letter = await mustGetLetter(eventsMatch[1]);
      const body = await readJson(req);
      const type = String(body.type || '');
      if (!COMMISSION_EVENTS.includes(type)) throw new HttpError(400, "Type d'événement invalide");
      if (type !== 'note' && !letter.commission) throw new HttpError(400, 'Aucun comité assigné');
      const event = {
        id: newId('h'), date: new Date(now()).toISOString(), type, committee: letter.commission,
        by: user.id, byName: user.name, note: String(body.note || ''),
      };
      const statut = type === 'recu_comite' ? 'en_cours' : type === 'traite_comite' ? 'traite' : null;
      await store.addEvent(letter.id, event, statut);
      return json(200, { item: publicLetter(await mustGetLetter(letter.id)) });
    }

    // ----- attachments (scanned letters) -----
    const piecesMatch = /^\/api\/letters\/([A-Za-z0-9_-]+)\/pieces(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
    if (piecesMatch) {
      const letterId = piecesMatch[1];
      const sub = piecesMatch[2];

      // Step 1 of an upload: the browser asks where to send the file.
      if (sub === 'upload-url' && method === 'POST') {
        await requireWriter(req);
        const letter = await mustGetLetter(letterId);
        const body = await readJson(req);
        const filename = sanitizeFilename(body.filename);
        const mime = FILE_TYPES[extname(filename)];
        if (!mime) throw new HttpError(400, 'Type de fichier non autorisé (PDF, JPG ou PNG uniquement)');
        const size = Number(body.size);
        if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Fichier vide');
        if (size > MAX_FILE_BYTES) throw new HttpError(413, 'Fichier trop volumineux (max 10 Mo)');
        if (letter.pieces.length >= MAX_PIECES_PER_LETTER) throw new HttpError(400, `Nombre maximal de pièces jointes atteint (${MAX_PIECES_PER_LETTER})`);
        const pieceId = newId('p');
        const key = `${letterId}-${pieceId}-${filename.replace(/[^.\w]/g, '_')}`;
        const exp = now() + UPLOAD_TTL_MS;
        const secret = await getSecret();
        const ticket = await signToken({ t: 'u', lid: letterId, pid: pieceId, nom: filename, key, size, exp }, secret);
        const target = storage.createUpload
          ? await storage.createUpload(key, mime)
          : { url: `/api/upload/${await signToken({ t: 'p', key, mime, exp }, secret)}`, headers: {} };
        return json(200, { uploadUrl: target.url, method: 'PUT', headers: { 'Content-Type': mime, ...(target.headers || {}) }, ticket, pieceId });
      }

      // Step 3: the file has been sent; check it really is what it claims to be, then attach it.
      if (sub === 'confirm' && method === 'POST') {
        await requireWriter(req);
        const letter = await mustGetLetter(letterId);
        const body = await readJson(req);
        const t = await verifyToken(String(body.ticket || ''), await getSecret(), now());
        if (!t || t.t !== 'u' || t.lid !== letterId) throw new HttpError(400, 'Dépôt invalide ou expiré, veuillez réessayer');
        const already = letter.pieces.find((p) => p.id === t.pid);
        if (already) return json(200, { item: { id: already.id, nom: already.nom, taille: already.taille, hasFile: true } });
        const reject = async (status, message) => { await storage.remove(t.key).catch(() => {}); throw new HttpError(status, message); };
        const head = await storage.head(t.key, 1024);
        if (!head) throw new HttpError(400, "Le fichier n'a pas été reçu par le serveur, veuillez réessayer");
        if (!head.size) return reject(400, 'Fichier vide');
        if (head.size > MAX_FILE_BYTES) return reject(413, 'Fichier trop volumineux (max 10 Mo)');
        const ext = extname(t.nom);
        if (!matchesFileType(ext, head.bytes)) return reject(400, `Le contenu du fichier ne correspond pas à son type (${ext})`);
        if (letter.pieces.length >= MAX_PIECES_PER_LETTER) return reject(400, `Nombre maximal de pièces jointes atteint (${MAX_PIECES_PER_LETTER})`);
        const piece = { id: t.pid, nom: t.nom, taille: head.size, storedAs: t.key };
        await store.addPiece(letterId, piece);
        return json(201, { item: { id: piece.id, nom: piece.nom, taille: piece.taille, hasFile: true } });
      }

      if (!sub && method === 'GET') {
        await requireAuth(req);
        const letter = await mustGetLetter(letterId);
        return json(200, { items: publicLetter(letter).pieces });
      }

      if (sub && method === 'GET') {
        await requireAuth(req);
        const piece = await store.getPiece(letterId, sub);
        const file = piece && piece.storedAs ? await storage.get(piece.storedAs) : null;
        if (!file) throw new HttpError(404, 'Fichier non disponible');
        const headers = {
          'Content-Type': FILE_TYPES[extname(piece.storedAs)] || 'application/octet-stream',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(piece.nom)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        };
        if (file.size) headers['Content-Length'] = String(file.size);
        return new Response(file.body, { status: 200, headers });
      }

      if (sub && method === 'DELETE') {
        await requireAdmin(req);
        const removed = await store.removePiece(letterId, sub);
        if (!removed) throw new HttpError(404, 'Fichier introuvable');
        if (removed.storedAs) await storage.remove(removed.storedAs).catch(() => {});
        return json(200, { ok: true });
      }
    }

    throw new HttpError(404, 'Not found');
  }

  return async function handle(req) {
    try {
      return await route(req);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error('Request error', req.method, req.url, e);
      return json(500, { error: 'Erreur serveur' });
    }
  };
}
