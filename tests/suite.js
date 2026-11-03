// End-to-end API checks. `call(path, opts)` talks to the API, `putFile(url, headers, bytes)` sends a file
// to the address the API hands out. This file is environment-agnostic: tests/run-local.mjs runs it against
// the local implementation, and the same file is run inside the deployed function against the real database.
//
// env = {
//   call(path, { method, body, token, raw, headers }) -> { status, data, bytes, type },
//   putFile(url, headers, bytes) -> { status, data },
//   users: { admin: { username, password }, agent: {...}, reader: {...} },
//   log(line)
// }
export async function runSuite(env) {
  const { call, putFile, users, log } = env;
  let pass = 0;
  const failures = [];
  const created = [];
  const check = (name, cond, extra = '') => {
    if (cond) { pass++; log('  ok    ' + name); } else { failures.push(name + (extra ? ' — ' + extra : '')); log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
  };
  const section = (name) => log('\n# ' + name);
  const short = (v) => JSON.stringify(v)?.slice(0, 200);

  const run = Math.random().toString(36).slice(2, 8); // makes search checks independent of other data
  const pdf = (n = 2000) => { const b = new Uint8Array(9 + n).fill(65); b.set(new TextEncoder().encode('%PDF-1.4\n')); return b; };
  const png = () => { const b = new Uint8Array(108).fill(1); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
  const text = (s) => new TextEncoder().encode(s);
  const sameBytes = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  const login = async (u) => (await call('/api/login', { method: 'POST', body: u })).data?.token;

  // Full upload as the browser does it: ask for a place, send the file, confirm.
  async function upload(token, letterId, filename, bytes, { declare = bytes.length } = {}) {
    const init = await call(`/api/letters/${letterId}/pieces/upload-url`, { method: 'POST', token, body: { filename, size: declare } });
    if (init.status !== 200) return { stage: 'init', ...init };
    const sent = await putFile(init.data.uploadUrl, init.data.headers, bytes);
    if (sent.status < 200 || sent.status >= 300) return { stage: 'put', ...sent, init: init.data };
    const done = await call(`/api/letters/${letterId}/pieces/confirm`, { method: 'POST', token, body: { ticket: init.data.ticket } });
    return { stage: 'confirm', ...done, init: init.data };
  }
  const piecesOf = async (token, id) => (await call('/api/letters/' + id, { token })).data?.item?.pieces || [];

  // ---------------------------------------------------------------------------------------------
  section('sign in');
  let r = await call('/api/health');
  check('health check', r.status === 200 && r.data?.ok === true, short(r));
  const admin = await login(users.admin);
  const agent = await login(users.agent);
  const reader = await login(users.reader);
  check('admin, agent and reader can sign in', !!(admin && agent && reader));
  r = await call('/api/login', { method: 'POST', body: { username: users.admin.username, password: 'wrong-password' } });
  check('wrong password -> 401', r.status === 401 && r.data?.error === 'Identifiants invalides', short(r));
  r = await call('/api/letters');
  check('no token -> 401', r.status === 401);
  r = await call('/api/letters', { token: admin + 'x' });
  check('tampered token -> 401', r.status === 401);
  r = await call('/api/me', { token: reader });
  check('/api/me returns the user without password data', r.status === 200 && r.data.user.role === 'lecture' && !JSON.stringify(r.data).includes('assword'), short(r.data));
  r = await call('/api/committees', { token: admin });
  check('committees listed', r.status === 200 && r.data.items.some((c) => c.id === 'cna'));

  // ---------------------------------------------------------------------------------------------
  section('create and edit a letter');
  r = await call('/api/letters', { method: 'POST', token: admin, body: { objet: `Remerciement ${run}`, numeroLettre: 'N° 12', expediteur: { nom: 'EST' } } });
  check('create 201 with an automatic reference', r.status === 201 && /^BO-\d{4}-\d{4}$/.test(r.data?.item?.ref), short(r.data));
  const id = r.data.item.id;
  created.push(id);
  check('defaults applied (entrant, courrier, normale, recu)', r.data.item.direction === 'entrant' && r.data.item.type === 'courrier' && r.data.item.priorite === 'normale' && r.data.item.statut === 'recu');

  r = await call('/api/letters/' + id, {
    method: 'PATCH', token: admin,
    body: {
      objet: `Objet modifié ${run}`, resume: 'Un résumé', priorite: 'urgente', categorie: 'juridique', numeroLettre: 'N° 99',
      expediteur: { nom: 'Espérance', fonction: 'Président', service: 'Club' }, destinataire: { nom: 'DNA' },
      dateEmission: '2026-11-01T09:00:00.000Z', dateReception: '2026-11-02T09:00:00.000Z', commission: 'cna', statut: 'transmis',
    },
  });
  check('admin PATCH 200', r.status === 200, short(r.data));
  const it = r.data.item;
  check('all fields updated', it.objet === `Objet modifié ${run}` && it.priorite === 'urgente' && it.categorie === 'juridique' && it.numeroLettre === 'N° 99' && it.expediteur.nom === 'Espérance' && it.expediteur.fonction === 'Président' && it.destinataire.nom === 'DNA' && it.dateEmission.startsWith('2026-11-01') && it.dateReception.startsWith('2026-11-02'), short(it));
  check('committee assignment is recorded in the history', it.commission === 'cna' && it.commissionHisto.length === 1 && it.commissionHisto[0].type === 'assigne' && it.commissionHisto[0].byName);
  r = await call('/api/letters/' + id, { method: 'PATCH', token: agent, body: { resume: 'edit agent' } });
  check('agent can edit', r.status === 200 && r.data.item.resume === 'edit agent');
  r = await call('/api/letters/' + id, { method: 'PATCH', token: reader, body: { objet: 'nope' } });
  check('reader cannot edit (403)', r.status === 403);
  r = await call('/api/letters/' + id, { method: 'PATCH', body: { objet: 'nope' } });
  check('anonymous cannot edit (401)', r.status === 401);

  section('validation (a rejected edit changes nothing)');
  const bad = async (name, body, expectError) => {
    const res = await call('/api/letters/' + id, { method: 'PATCH', token: admin, body: { ...body, resume: 'SHOULD NOT APPLY' } });
    check(name, res.status === 400 && (!expectError || res.data?.error === expectError), short(res));
  };
  await bad('empty subject -> 400', { objet: '   ' }, "L'objet est obligatoire");
  await bad('unknown type -> 400', { type: 'bogus' });
  await bad('unknown category -> 400', { categorie: 'bogus' });
  await bad('unknown importance -> 400', { priorite: 'bogus' });
  await bad('unknown status -> 400', { statut: 'bogus' });
  await bad('unknown direction -> 400', { direction: 'bogus' });
  await bad('invalid date -> 400', { dateEmission: 'not-a-date' });
  await bad('unknown committee -> 400', { commission: 'unknown' });
  r = await call('/api/letters/' + id, { token: admin });
  check('rejected edits changed nothing', r.data.item.resume === 'edit agent', r.data.item.resume);
  r = await call('/api/letters/' + id, { method: 'PATCH', token: admin, raw: '{not json' });
  check('invalid JSON -> 400 with a message', r.status === 400 && !!r.data?.error, short(r));
  r = await call('/api/letters/doesnotexist', { method: 'PATCH', token: admin, body: { objet: 'x' } });
  check('unknown letter -> 404 JSON', r.status === 404 && !!r.data?.error);
  r = await call('/api/letters', { method: 'POST', token: admin, body: { objet: '' } });
  check('create without a subject -> 400', r.status === 400);
  r = await call('/api/letters', { method: 'POST', token: reader, body: { objet: 'x' } });
  check('reader cannot create (403)', r.status === 403);
  r = await call('/api/letters', { method: 'POST', token: admin, body: { objet: `Ref ${run}`, ref: `T-${run}-1` } });
  const refLetter = r.data?.item;
  if (refLetter) created.push(refLetter.id);
  check('custom reference accepted', r.status === 201 && refLetter.ref === `T-${run}-1`, short(r));
  r = await call('/api/letters', { method: 'POST', token: admin, body: { objet: `Ref2 ${run}`, ref: `T-${run}-1` } });
  if (r.data?.item) created.push(r.data.item.id);
  check('duplicate reference -> 400', r.status === 400 && /déjà utilisée/.test(r.data?.error || ''), short(r));
  r = await call('/api/letters/' + id, { method: 'PATCH', token: admin, body: { ref: `T-${run}-1` } });
  check('editing a reference to an existing one -> 400', r.status === 400, short(r));

  // ---------------------------------------------------------------------------------------------
  section('add files');
  const good = pdf();
  r = await upload(admin, id, 'lettre club.pdf', good);
  check('PDF upload + confirm -> 201', r.stage === 'confirm' && r.status === 201 && r.data.item.hasFile && r.data.item.taille === good.length, `${r.stage} ${r.status} ${short(r.data)}`);
  const pieceId = r.data?.item?.id;
  r = await upload(agent, id, 'scan.png', png());
  check('agent can add a PNG', r.status === 201, `${r.stage} ${r.status} ${short(r.data)}`);
  r = await upload(reader, id, 'x.pdf', good);
  check('reader cannot add files (403)', r.stage === 'init' && r.status === 403, `${r.stage} ${r.status}`);
  r = await upload(admin, id, 'virus.exe', good);
  check('.exe refused (400)', r.stage === 'init' && r.status === 400, `${r.stage} ${r.status} ${short(r.data)}`);
  const before = (await piecesOf(admin, id)).length;
  r = await upload(admin, id, 'fake.pdf', text('MZ this is not a pdf at all, just text'));
  check('a fake PDF is refused after upload (400)', r.stage === 'confirm' && r.status === 400, `${r.stage} ${r.status} ${short(r.data)}`);
  r = await upload(admin, id, 'fake.png', pdf());
  check('a PDF renamed .png is refused (400)', r.stage === 'confirm' && r.status === 400, `${r.stage} ${r.status}`);
  r = await upload(admin, id, 'vide.pdf', new Uint8Array(0), { declare: 100 });
  check('an empty file is not attached', r.status !== 201, `${r.stage} ${r.status}`);
  r = await call(`/api/letters/${id}/pieces/upload-url`, { method: 'POST', token: admin, body: { filename: 'a.pdf', size: 0 } });
  check('declaring size 0 -> 400', r.status === 400);
  check('refused files were not attached', (await piecesOf(admin, id)).length === before);
  r = await upload(admin, id, 'Lettre n°12 – été.pdf', good);
  check('accented file name accepted', r.status === 201 && r.data.item.nom.includes('été'), short(r.data));

  // an upload that is never confirmed must not appear on the letter
  const init = await call(`/api/letters/${id}/pieces/upload-url`, { method: 'POST', token: admin, body: { filename: 'abandonne.pdf', size: good.length } });
  await putFile(init.data.uploadUrl, init.data.headers, good);
  check('an unconfirmed upload is not attached', !(await piecesOf(admin, id)).some((p) => p.nom === 'abandonne.pdf'));
  r = await call(`/api/letters/${id}/pieces/confirm`, { method: 'POST', token: admin, body: { ticket: init.data.ticket } });
  const attached = r.data?.item?.id;
  check('...until it is confirmed', r.status === 201);
  r = await call(`/api/letters/${id}/pieces/confirm`, { method: 'POST', token: admin, body: { ticket: init.data.ticket } });
  check('confirming twice does not duplicate the file', r.status === 200 && (await piecesOf(admin, id)).filter((p) => p.id === attached).length === 1, short(r));
  r = await call(`/api/letters/${refLetter.id}/pieces/confirm`, { method: 'POST', token: admin, body: { ticket: init.data.ticket } });
  check("a ticket cannot be used on another letter", r.status === 400, short(r));
  r = await call(`/api/letters/${id}/pieces/confirm`, { method: 'POST', token: admin, body: { ticket: init.data.ticket.slice(0, -4) + 'AAAA' } });
  check('a forged ticket is refused', r.status === 400);

  section('size limits');
  const big = pdf(Math.floor(9.9 * 1024 * 1024));
  r = await upload(admin, id, 'big.pdf', big);
  check('a 9.9 MB PDF is accepted', r.status === 201 && r.data.item.taille === big.length, `${r.stage} ${r.status} ${short(r.data)}`);
  const bigId = r.data?.item?.id;
  r = await call(`/api/letters/${id}/pieces/upload-url`, { method: 'POST', token: admin, body: { filename: 'toobig.pdf', size: 11 * 1024 * 1024 } });
  check('declaring 11 MB -> clean 413 message', r.status === 413 && /volumineux/.test(r.data?.error || ''), short(r));
  const count = (await piecesOf(admin, id)).length;
  r = await upload(admin, id, 'menteur.pdf', pdf(11 * 1024 * 1024), { declare: 1000 });
  check('sending 11 MB after declaring 1 KB is refused', r.status !== 201, `${r.stage} ${r.status}`);
  check('...and nothing was attached', (await piecesOf(admin, id)).length === count);

  section('editing never touches attachments');
  const beforeEdit = await piecesOf(admin, id);
  r = await call('/api/letters/' + id, { method: 'PATCH', token: admin, body: { resume: 'after uploads', pieces: [] } });
  check('PATCH with pieces:[] does not wipe the files', r.status === 200 && r.data.item.pieces.length === beforeEdit.length && beforeEdit.length >= 5, `${beforeEdit.length} -> ${r.data?.item?.pieces?.length}`);
  r = await call('/api/letters/' + id, { method: 'PATCH', token: admin, body: { pieces: [{ id: 'x', nom: 'forged.pdf', storedAs: '../../etc/passwd' }] } });
  check('a forged piece list is ignored', r.status === 200 && !r.data.item.pieces.some((p) => p.nom === 'forged.pdf'));

  // ---------------------------------------------------------------------------------------------
  section('open and remove files');
  r = await call(`/api/letters/${id}/pieces/${pieceId}`, { token: admin });
  check('download returns exactly what was uploaded', r.status === 200 && r.type === 'application/pdf' && sameBytes(r.bytes, good), `${r.status} ${r.type}`);
  r = await call(`/api/letters/${id}/pieces/${pieceId}`, { token: reader });
  check('a reader can open files', r.status === 200);
  r = await call(`/api/letters/${id}/pieces/${pieceId}`);
  check('opening a file needs a sign-in (401)', r.status === 401);
  r = await call(`/api/letters/${id}/pieces/${pieceId}`, { method: 'DELETE', token: agent });
  check('an agent cannot remove a file (403)', r.status === 403);
  r = await call(`/api/letters/${id}/pieces/${pieceId}`, { method: 'DELETE', token: admin });
  check('admin removes a file (200)', r.status === 200);
  r = await call(`/api/letters/${id}/pieces/${pieceId}`, { token: admin });
  check('a removed file -> 404', r.status === 404);
  r = await call(`/api/letters/${id}/pieces/${bigId}`, { method: 'DELETE', token: admin });
  check('the large file can be removed too', r.status === 200);
  r = await call(`/api/letters/${id}/pieces/nope`, { method: 'DELETE', token: admin });
  check('removing an unknown file -> 404', r.status === 404);

  // ---------------------------------------------------------------------------------------------
  section('committee tracking');
  r = await call(`/api/letters/${id}/commission-events`, { method: 'POST', token: agent, body: { type: 'recu_comite', note: 'bien reçu' } });
  check('committee "received" event moves the letter to in-progress', r.status === 200 && r.data.item.statut === 'en_cours' && r.data.item.commissionHisto.at(-1).note === 'bien reçu', short(r.data));
  r = await call(`/api/letters/${id}/commission-events`, { method: 'POST', token: agent, body: { type: 'traite_comite' } });
  check('committee "processed" event marks it processed', r.status === 200 && r.data.item.statut === 'traite');
  check('history is in chronological order', r.data.item.commissionHisto.map((e) => e.type).join() === 'assigne,recu_comite,traite_comite', r.data.item.commissionHisto.map((e) => e.type).join());
  r = await call(`/api/letters/${id}/commission-events`, { method: 'POST', token: agent, body: { type: 'bogus' } });
  check('unknown event type -> 400', r.status === 400);
  r = await call(`/api/letters/${refLetter.id}/commission-events`, { method: 'POST', token: agent, body: { type: 'recu_comite' } });
  check('"received by committee" without a committee -> 400', r.status === 400);
  r = await call(`/api/letters/${refLetter.id}`, { method: 'PATCH', token: agent, body: { commission: 'appel' } });
  check('assigning a committee moves the status to "transmis"', r.status === 200 && r.data.item.statut === 'transmis' && r.data.item.commissionHisto.length === 1, short(r.data));

  // ---------------------------------------------------------------------------------------------
  section('lists, search and dashboard');
  r = await call(`/api/letters?q=${encodeURIComponent('modifié ' + run)}`, { token: admin });
  check('search finds the letter by its subject (accents ok)', r.status === 200 && r.data.total === 1 && r.data.items[0].id === id, short(r.data));
  r = await call(`/api/letters?q=${encodeURIComponent('espérance')}`, { token: admin });
  check('search also looks at the sender name', r.status === 200 && r.data.items.some((l) => l.id === id), short(r.data?.total));
  r = await call(`/api/letters?q=${encodeURIComponent('"quoted", (weird) \\ chars')}`, { token: admin });
  check('odd characters in a search do not break it', r.status === 200);
  r = await call(`/api/letters?commission=appel&q=${run}`, { token: admin });
  check('filter by committee', r.status === 200 && r.data.items.length === 1 && r.data.items[0].id === refLetter.id, short(r.data?.total));
  r = await call(`/api/letters?statut=traite&q=${run}`, { token: admin });
  check('filter by status', r.status === 200 && r.data.items.length === 1 && r.data.items[0].id === id);
  r = await call(`/api/letters?from=2026-11-01&to=2026-11-01&q=${run}`, { token: admin });
  check('filter by date', r.status === 200 && r.data.items.some((l) => l.id === id), short(r.data?.total));
  r = await call('/api/letters?from=garbage', { token: admin });
  check('a bad date filter -> 400, not a crash', r.status === 400);
  r = await call(`/api/letters?q=${run}&limit=1&page=1`, { token: admin });
  const first = r.data?.items?.[0]?.id;
  r = await call(`/api/letters?q=${run}&limit=1&page=2`, { token: admin });
  check('pagination works and total is the full count', r.status === 200 && r.data.total >= 2 && r.data.items.length === 1 && r.data.items[0].id !== first, short(r.data?.total));
  r = await call(`/api/letters?q=${run}`, { token: admin });
  const times = r.data.items.map((l) => l.createdAt);
  check('newest letters come first', times.every((t, i) => i === 0 || times[i - 1] >= t), times.join());
  r = await call('/api/stats', { token: admin });
  check('dashboard numbers add up', r.status === 200 && r.data.total >= 2 && r.data.entrants + r.data.sortants === r.data.total && Object.values(r.data.parStatut).reduce((a, b) => a + b, 0) === r.data.total, short(r.data));

  // ---------------------------------------------------------------------------------------------
  section('password change');
  const old = users.agent.password;
  r = await call('/api/me/password', { method: 'POST', token: agent, body: { current: 'not-the-password', next: 'a-new-password-1' } });
  check('wrong current password -> 400', r.status === 400);
  r = await call('/api/me/password', { method: 'POST', token: agent, body: { current: old, next: 'short' } });
  check('too short new password -> 400', r.status === 400);
  r = await call('/api/me/password', { method: 'POST', token: agent, body: { current: old, next: 'a-new-password-1' } });
  const fresh = r.data?.token;
  check('password changed, new token returned', r.status === 200 && !!fresh, short(r));
  r = await call('/api/me', { token: agent });
  check('the old session stops working', r.status === 401);
  r = await call('/api/me', { token: fresh });
  check('the new session works', r.status === 200);
  r = await call('/api/login', { method: 'POST', body: { username: users.agent.username, password: old } });
  check('the old password no longer works', r.status === 401);
  r = await call('/api/login', { method: 'POST', body: { username: users.agent.username, password: 'a-new-password-1' } });
  check('the new password works', r.status === 200);
  for (let i = 0; i < 5; i++) await call('/api/login', { method: 'POST', body: { username: users.reader.username, password: 'bad' + i } });
  r = await call('/api/login', { method: 'POST', body: { username: users.reader.username, password: users.reader.password } });
  check('after 5 wrong attempts the account is briefly locked (429)', r.status === 429, short(r));

  // ---------------------------------------------------------------------------------------------
  section('delete');
  r = await call('/api/letters/' + id, { method: 'DELETE', token: fresh }); // the agent's current session (the old one was signed out above)
  check('an agent cannot delete a letter (403)', r.status === 403, short(r));
  const doomedPiece = (await piecesOf(admin, id))[0];
  r = await call('/api/letters/' + id, { method: 'DELETE', token: admin });
  check('admin deletes a letter (200)', r.status === 200);
  r = await call('/api/letters/' + id, { token: admin });
  check('the letter is gone (404)', r.status === 404);
  r = await call(`/api/letters/${id}/pieces/${doomedPiece.id}`, { token: admin });
  check('its files are gone too (404)', r.status === 404);
  r = await call('/api/letters/' + id, { method: 'DELETE', token: admin });
  check('deleting twice -> 404', r.status === 404);
  for (const other of created) if (other !== id) await call('/api/letters/' + other, { method: 'DELETE', token: admin });

  log(`\n${pass} passed, ${failures.length} failed`);
  return { pass, failures };
}
