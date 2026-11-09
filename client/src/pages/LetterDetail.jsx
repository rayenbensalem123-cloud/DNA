import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtDateTime, fmtSize } from '../utils';
import LetterForm from '../components/LetterForm';

export default function LetterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.role === 'admin';
  // The tracking history (entry, transfers, committee events) is private to the bureau d'ordre.
  const canSeeHistory = isAdmin || user?.role === 'supervisor';
  const [letter, setLetter] = useState(null);
  // A comité account can change a letter only while it is in its comité.
  const holdsLetter = (l) => Boolean(l) && (isAdmin || (user?.role === 'agent' && Boolean(user.commission) && l.commission === user.commission));
  const canManage = holdsLetter(letter);
  const canEdit = canManage;
  const readOnlyComite = user?.role === 'agent' && Boolean(letter) && !canManage;
  const canHandleCommittee = canManage;
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [committee, setCommittee] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const timeline = (() => {
    if (!letter) return [];
    const nm = (cid) => committees.find((c) => c.id === cid)?.nom || cid || '—';
    const rows = [{ key: 'created', kind: 'assigne', date: letter.createdAt, label: <>Courrier enregistré</>, by: letter.createdByName || '' }];
    (letter.commissionHisto || []).forEach((h) => {
      let label;
      if (h.type === 'assigne') label = <>Envoyé au comité <strong>{nm(h.committee)}</strong></>;
      else if (h.type === 'transfert') label = <>Transféré <strong>{nm(h.fromCommittee)} → {nm(h.committee)}</strong></>;
      else if (h.type === 'retire') label = <>Retiré du comité <strong>{nm(h.fromCommittee)}</strong></>;
      else if (h.type === 'vu_comite' || h.type === 'recu_comite') label = <>Ouvert par le comité <strong>{nm(h.committee)}</strong></>;
      else if (h.type === 'traite_comite') label = <>Terminé et archivé par <strong>{nm(h.committee)}</strong></>;
      else label = <>Note ({nm(h.committee)})</>;
      rows.push({ key: h.id, kind: h.type, date: h.date, label, note: h.note, by: h.byName });
    });
    (letter.pieces || []).forEach((p) => { if (p.uploadedAt) rows.push({ key: 'p' + p.id, kind: 'note', date: p.uploadedAt, label: <>Fichier ajouté : <strong>{p.nom}</strong></> }); });
    return rows.sort((x, y) => (x.date || '') < (y.date || '') ? -1 : 1);
  })();

  const committeeName = (cid) => (committees.find((c) => c.id === cid)?.nom) || cid || '—';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.committees().then((d) => { if (!cancelled) setCommittees(d.items || []); }).catch(() => {});
    // The list endpoint is the only read endpoint; find by id from a full scan.
    api.listLetters({ limit: 500, sort: 'date' })
      .then((d) => {
        if (cancelled) return;
        const found = d.items.find((l) => l.id === id) || null;
        setLetter(found);
        setCommittee(found ? (found.commission || '') : '');
        setLoading(false);
        const canAutoSee = isAdmin || holdsLetter(found);
        if (found?.commission && found.unread && canAutoSee) {
          api.addCommissionEvent(found.id, { type: 'vu_comite' })
            .then((updated) => { if (!cancelled) setLetter(updated.item); })
            .catch(() => {});
        }
      })
      .catch(() => { if (!cancelled) { setError('Erreur'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id, canHandleCommittee]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) setEditing(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, busy]);

  const saveEdits = async (data) => {
    setBusy(true);
    setError('');
    try {
      const { files = [], ...changes } = data;
      if ((changes.commission || null) !== (letter.commission || null)) {
        changes.statut = changes.commission ? 'en_cours' : 'recu';
      }
      await api.updateLetter(letter.id, changes);
      for (const file of files) {
        await api.uploadPieceDirect(letter.id, file);
      }
      const refreshed = await api.listLetters({ limit: 500, sort: 'date' });
      const updated = refreshed.items.find((item) => item.id === letter.id);
      if (updated) setLetter(updated);
      setCommittee(updated?.commission || changes.commission || '');
      setEditing(false);
    } catch (e) { setError(e.message || 'Erreur'); }
    finally { setBusy(false); }
  };

  const assignCommittee = async () => {
    if (!letter) return;
    setBusy(true);
    setError('');
    try {
      const changed = (committee || null) !== (letter.commission || null);
      const nextStatut = changed ? (committee ? 'en_cours' : 'recu') : letter.statut;
      const d = await api.updateLetter(letter.id, { commission: committee || null, statut: nextStatut });
      setLetter(d.item);
    } catch (e) { setError(e.message || 'Erreur'); }
    setBusy(false);
  };

  const addEvent = async (type) => {
    if (!letter) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.addCommissionEvent(letter.id, { type, note });
      setLetter(d.item);
      setNote('');
    } catch (e) { setError(e.message || 'Erreur'); }
    setBusy(false);
  };

  const remove = async () => {
    if (!letter) return;
    try {
      await api.deleteLetter(letter.id);
      navigate('/archive');
    } catch (e) { setError(e.message || 'Erreur'); }
  };

  const openPiece = async (pieceId) => {
    setError('');
    try { await api.openPiece(letter.id, pieceId); }
    catch (e) { setError(e.message || 'Erreur'); }
  };

  if (loading) return <div className="page"><div className="card">{t('common.loading')}</div></div>;
  if (error && !letter) return <div className="page"><div className="card">{error}</div></div>;
  if (!letter) return <div className="page"><div className="card">Introuvable</div></div>;

  const info = (key, value) => (
    <div key={key} className="detail-row">
      <div className="detail-label">{t(key)}</div>
      <div className="detail-value">{value}</div>
    </div>
  );

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div className="page-title-copy"><span className="page-title-kicker">Correspondance</span><h1>{t('detail.title')}</h1></div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/archive')}>{t('detail.back')}</button>
          {canEdit && <button className="btn btn-primary" onClick={() => { setError(''); setEditing(true); }}>Modifier</button>}
          {isAdmin && <button className="btn btn-danger" onClick={remove}>{t('detail.delete')}</button>}
        </div>
      </div>
      {readOnlyComite && <div className="account-notice" role="status">Cette lettre est maintenant dans le comité « {committeeName(letter.commission)} ». Vous pouvez la consulter, mais plus la modifier.</div>}
      <div className="card">
        {info('detail.numero', letter.numeroLettre || '—')}
        {info('detail.objet', letter.objet)}
        {info('detail.resume', letter.resume)}
        {info('detail.direction', t('direction.' + (letter.direction || 'entrant')))}
        {info('detail.type', t('type.' + (letter.type || 'autre')))}
        {info('detail.categorie', t('categorie.' + (letter.categorie || 'autre')))}
        {info('detail.statut', <>{t('status.' + (letter.statut || 'recu'))}{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 8 }}>{t('badge.transferred')}</span>}</>)}
        {info('detail.priorite', t('priorite.' + (letter.priorite || 'normale')))}
        {info('detail.commission', letter.commission ? committeeName(letter.commission) : '—')}
        {info('detail.expediteur', [letter.expediteur?.nom, letter.expediteur?.fonction, letter.expediteur?.service].filter(Boolean).join(' — ') || '—')}
        {info('detail.destinataire', [letter.destinataire?.nom, letter.destinataire?.fonction, letter.destinataire?.service].filter(Boolean).join(' — ') || '—')}
        {info('detail.dateEmission', fmtDate(letter.dateEmission))}
        {info('detail.dateReception', fmtDate(letter.dateReception))}
        {info('detail.pieces',
          (letter.pieces || []).length === 0 ? '—' : (
            <div className="file-list">
              {letter.pieces.map((p) => (
                <div key={p.id} className="file-row">
                  {p.hasFile
                    ? <button type="button" className="btn-link" onClick={() => openPiece(p.id)}>{p.nom}</button>
                    : <span>{p.nom}</span>}
                  <span className="muted">{p.taille ? fmtSize(p.taille) : ''}{p.hasFile ? '' : ' (' + t('detail.demoFile') + ')'}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {canSeeHistory && <div className="card">
        <h2 className="card-title">Suivi du courrier</h2>
        <div className="histo timeline">
          {timeline.map((h) => (
            <div key={h.key} className="histo-item">
              <span className={'histo-dot dot-' + h.kind} />
              <div>
                <div>{h.label}</div>
                {h.note && <div className="muted">{h.note}</div>}
                <div className="muted small">{fmtDateTime(h.date)}{h.by ? ' — ' + h.by : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {canHandleCommittee && (
        <>
          {(canManage || letter.commission) && <div className="card">
            <h2 className="card-title">{t('detail.committeeActions')}</h2>
            {canManage && <div className="status-actions">
                <select value={committee} onChange={(e) => setCommittee(e.target.value)}>
                  {isAdmin && <option value="">{t('commission.none')}</option>}
                  {committees.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <button className="btn btn-primary" onClick={assignCommittee} disabled={busy}>{t('detail.transmit')}</button>
              </div>}
            {letter.commission && (
              <div className="status-actions">
                {letter.statut !== 'archive' && <button className="btn btn-primary" onClick={() => addEvent('traite_comite')} disabled={busy}>{t('detail.markTreated')}</button>}
              </div>
            )}
            {canManage && <label className="field">
              <span>{t('detail.note')}</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('detail.notePlaceholder')} />
            </label>}
          </div>}

        </>
      )}
      {error && <div className="form-error">{error}</div>}
      {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="letter-edit-title">
          <header className="modal-head"><h2 id="letter-edit-title">Modifier le courrier</h2><button type="button" className="modal-close" onClick={() => setEditing(false)} aria-label="Fermer" disabled={busy}>×</button></header>
          <LetterForm initialLetter={letter} onSubmit={saveEdits} onCancel={() => setEditing(false)} busy={busy} error={error} />
        </section>
      </div>}
    </div>
  );
}

