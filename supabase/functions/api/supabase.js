// Production storage: Postgres (through Supabase's REST API) for the data, Supabase Storage for the
// scanned files. Uses the service-role key, which only ever lives inside the Edge Function.

const iso = (v) => (v ? new Date(v).toISOString() : null);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
const q = encodeURIComponent;

function dbError(res, text) {
  let pg = null;
  try { pg = JSON.parse(text); } catch { /* not JSON */ }
  const err = new Error(`Database error ${res.status}: ${String(text).slice(0, 300)}`);
  err.status = res.status;
  if (pg && pg.code === '23505') err.code = 'DUPLICATE_REF'; // unique violation (only `ref` is unique on letters)
  return err;
}

const toEvent = (r) => ({ id: r.id, date: iso(r.date), type: r.type, committee: r.committee, by: r.by_user, byName: r.by_name, note: r.note || '' });
const toPiece = (r) => ({ id: r.id, nom: r.nom, taille: Number(r.taille), storedAs: r.stored_as, createdAt: iso(r.created_at) });
const toLetter = (r) => ({
  id: r.id,
  ref: r.ref,
  numeroLettre: r.numero_lettre || '',
  direction: r.direction,
  type: r.type,
  categorie: r.categorie,
  objet: r.objet,
  resume: r.resume || '',
  priorite: r.priorite,
  statut: r.statut,
  commission: r.commission || null,
  expediteur: r.expediteur || {},
  destinataire: r.destinataire || {},
  dateEmission: iso(r.date_emission),
  dateReception: iso(r.date_reception),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  createdBy: r.created_by,
  commissionHisto: (r.letter_events || []).map(toEvent).sort(byDate),
  pieces: (r.pieces || []).map(toPiece).sort(byCreated),
});

const LETTER_SELECT = '*,pieces(*),letter_events(*)';

function letterRow(l) {
  return {
    id: l.id, ref: l.ref, numero_lettre: l.numeroLettre, direction: l.direction, type: l.type,
    categorie: l.categorie, objet: l.objet, resume: l.resume, priorite: l.priorite, statut: l.statut,
    commission: l.commission, expediteur: l.expediteur, destinataire: l.destinataire,
    date_emission: l.dateEmission, date_reception: l.dateReception,
    created_at: l.createdAt, updated_at: l.updatedAt, created_by: l.createdBy,
  };
}

const eventRow = (letterId, e) => ({
  id: e.id, letter_id: letterId, date: e.date, type: e.type, committee: e.committee || null,
  by_user: e.by || null, by_name: e.byName || null, note: e.note || '',
});

export function createSupabaseStore(url, serviceKey) {
  const base = `${url}/rest/v1`;
  const baseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const headers = { ...baseHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${base}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw dbError(res, await res.text());
    return res;
  }

  return {
    async getTokenSecret() {
      const rows = await (await rest(`app_config?key=eq.token_secret&select=value`)).json();
      if (!rows.length) throw new Error('token_secret is missing from app_config');
      return rows[0].value;
    },

    // ---- users ----
    async getUserByUsername(username) {
      const rows = await (await rest(`users?username=eq.${q(username)}&select=*&limit=1`)).json();
      return rows[0] ? mapUser(rows[0]) : null;
    },
    async getUserById(id) {
      const rows = await (await rest(`users?id=eq.${q(id)}&select=*&limit=1`)).json();
      return rows[0] ? mapUser(rows[0]) : null;
    },
    async setPasswordHash(id, hash) {
      await rest(`users?id=eq.${q(id)}`, { method: 'PATCH', body: { password_hash: hash }, prefer: 'return=minimal' });
    },

    // ---- committees ----
    async listCommittees() {
      return (await (await rest('committees?select=id,nom&order=nom.asc')).json()).map((c) => ({ id: c.id, nom: c.nom }));
    },
    async committeeExists(id) {
      if (!id) return true;
      return (await (await rest(`committees?id=eq.${q(id)}&select=id&limit=1`)).json()).length > 0;
    },

    // ---- letters ----
    async queryLetters(f) {
      const p = new URLSearchParams();
      p.set('select', LETTER_SELECT);
      if (f.direction) p.set('direction', `eq.${f.direction}`);
      if (f.statut) p.set('statut', `eq.${f.statut}`);
      if (f.type) p.set('type', `eq.${f.type}`);
      if (f.categorie) p.set('categorie', `eq.${f.categorie}`);
      if (f.priorite) p.set('priorite', `eq.${f.priorite}`);
      if (f.commission) p.set('commission', `eq.${f.commission}`);
      const and = [];
      if (f.from) and.push(`date_emission.gte.${f.from}`);
      if (f.to) and.push(`date_emission.lte.${f.to}`);
      if (and.length) p.set('and', `(${and.join(',')})`);
      if (f.q) {
        const pattern = `"*${f.q.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}*"`;
        const cols = ['ref', 'numero_lettre', 'objet', 'resume', 'expediteur->>nom', 'destinataire->>nom', 'expediteur->>fonction', 'destinataire->>fonction'];
        p.set('or', `(${cols.map((c) => `${c}.ilike.${pattern}`).join(',')})`);
      }
      p.set('order', f.sort === 'ref' ? 'ref.desc' : 'created_at.desc,id.desc');
      p.set('limit', String(f.limit));
      p.set('offset', String(f.offset));
      const res = await rest(`letters?${p.toString()}`, { prefer: 'count=exact' });
      const rows = await res.json();
      const total = Number((res.headers.get('content-range') || '').split('/')[1]);
      return { items: rows.map(toLetter), total: Number.isFinite(total) ? total : rows.length };
    },
    async getLetter(id) {
      const rows = await (await rest(`letters?id=eq.${q(id)}&select=${LETTER_SELECT}&limit=1`)).json();
      return rows[0] ? toLetter(rows[0]) : null;
    },
    async statsRows() {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const rows = await (await rest(`letters?select=id,statut,categorie,type,commission,direction,priorite,date_emission,date_reception,created_at&order=id.asc&limit=1000&offset=${offset}`)).json();
        for (const r of rows) {
          out.push({
            statut: r.statut, categorie: r.categorie, type: r.type, commission: r.commission, direction: r.direction,
            priorite: r.priorite, dateEmission: iso(r.date_emission), dateReception: iso(r.date_reception), createdAt: iso(r.created_at),
          });
        }
        if (rows.length < 1000) return out;
      }
    },
    async nextRef() {
      return await (await rest('rpc/next_letter_ref', { method: 'POST', body: {} })).json();
    },
    async insertLetter(letter) {
      await rest('letters', { method: 'POST', body: letterRow(letter), prefer: 'return=minimal' });
      if (letter.commissionHisto.length) {
        await rest('letter_events', { method: 'POST', body: letter.commissionHisto.map((e) => eventRow(letter.id, e)), prefer: 'return=minimal' });
      }
    },
    async updateLetter(id, patch, events) {
      const row = {
        ...(patch.ref !== undefined && { ref: patch.ref }),
        numero_lettre: patch.numeroLettre, direction: patch.direction, type: patch.type, categorie: patch.categorie,
        objet: patch.objet, resume: patch.resume, priorite: patch.priorite, statut: patch.statut,
        commission: patch.commission, expediteur: patch.expediteur, destinataire: patch.destinataire,
        date_emission: patch.dateEmission, date_reception: patch.dateReception,
        updated_at: new Date().toISOString(),
      };
      await rest(`letters?id=eq.${q(id)}`, { method: 'PATCH', body: row, prefer: 'return=minimal' });
      if (events.length) await rest('letter_events', { method: 'POST', body: events.map((e) => eventRow(id, e)), prefer: 'return=minimal' });
    },
    async addEvent(letterId, event, statut) {
      await rest('letter_events', { method: 'POST', body: eventRow(letterId, event), prefer: 'return=minimal' });
      await rest(`letters?id=eq.${q(letterId)}`, {
        method: 'PATCH',
        body: { ...(statut && { statut }), updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });
    },
    /** Returns the storage keys of the deleted letter's files, or null when there is no such letter. */
    async deleteLetter(id) {
      const rows = await (await rest(`letters?id=eq.${q(id)}&select=id,pieces(stored_as)`)).json();
      if (!rows.length) return null;
      await rest(`letters?id=eq.${q(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return rows[0].pieces.map((p) => p.stored_as);
    },

    // ---- attachments ----
    async addPiece(letterId, piece) {
      await rest('pieces', { method: 'POST', body: { id: piece.id, letter_id: letterId, nom: piece.nom, taille: piece.taille, stored_as: piece.storedAs }, prefer: 'return=minimal' });
      await rest(`letters?id=eq.${q(letterId)}`, { method: 'PATCH', body: { updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    },
    async getPiece(letterId, pieceId) {
      const rows = await (await rest(`pieces?id=eq.${q(pieceId)}&letter_id=eq.${q(letterId)}&select=*&limit=1`)).json();
      return rows[0] ? toPiece(rows[0]) : null;
    },
    async removePiece(letterId, pieceId) {
      const rows = await (await rest(`pieces?id=eq.${q(pieceId)}&letter_id=eq.${q(letterId)}`, { method: 'DELETE', prefer: 'return=representation' })).json();
      if (!rows.length) return null;
      await rest(`letters?id=eq.${q(letterId)}`, { method: 'PATCH', body: { updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
      return toPiece(rows[0]);
    },
  };
}

const mapUser = (r) => ({ id: r.id, username: r.username, name: r.name, role: r.role, passwordHash: r.password_hash });

export function createSupabaseStorage(url, serviceKey, bucket = 'letters') {
  const base = `${url}/storage/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const path = (key) => key.split('/').map(q).join('/');

  return {
    /** A one-time URL the browser can PUT the file to directly (the file never goes through our API). */
    async createUpload(key) {
      const res = await fetch(`${base}/object/upload/sign/${bucket}/${path(key)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`Storage error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const rel = data.url || `/object/upload/sign/${bucket}/${path(key)}?token=${q(data.token)}`;
      return { url: rel.startsWith('http') ? rel : `${base}${rel}`, headers: {} };
    },
    /** First `n` bytes of the stored file plus its total size, or null if it does not exist. */
    async head(key, n) {
      const res = await fetch(`${base}/object/${bucket}/${path(key)}`, { headers: { ...headers, Range: `bytes=0-${n - 1}` } });
      if (res.status === 400 || res.status === 404) { await res.body?.cancel(); return null; }
      if (!res.ok) throw new Error(`Storage error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const total = Number((res.headers.get('content-range') || '').split('/')[1]);
      return { size: Number.isFinite(total) ? total : bytes.length, bytes: bytes.subarray(0, n) };
    },
    async get(key) {
      const res = await fetch(`${base}/object/${bucket}/${path(key)}`, { headers });
      if (res.status === 400 || res.status === 404) { await res.body?.cancel(); return null; }
      if (!res.ok) throw new Error(`Storage error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { body: res.body, size: Number(res.headers.get('content-length')) || 0 };
    },
    async remove(key) {
      const res = await fetch(`${base}/object/${bucket}/${path(key)}`, { method: 'DELETE', headers });
      await res.body?.cancel();
    },
  };
}
