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
  const canManage = user?.role === 'admin' || user?.role === 'agent';
  const canEdit = user?.role === 'admin';
  const canHandleCommittee = canManage || user?.role === 'lecture';
  const [letter, setLetter] = useState(null);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [committee, setCommittee] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

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
        if (found?.commission && found.statut === 'transmis' && canHandleCommittee) {
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
        changes.statut = changes.commission ? 'transmis' : 'recu';
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
      const nextStatut = changed ? (committee ? 'transmis' : 'recu') : letter.statut;
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
          {canManage && <button className="btn btn-danger" onClick={remove}>{t('detail.delete')}</button>}
        </div>
      </div>
      <div className="card">
        {info('detail.numero', letter.numeroLettre || '—')}
        {info('detail.objet', letter.objet)}
        {info('detail.resume', letter.resume)}
        {info('detail.direction', t('direction.' + (letter.direction || 'entrant')))}
        {info('detail.type', t('type.' + (letter.type || 'autre')))}
        {info('detail.categorie', t('categorie.' + (letter.categorie || 'autre')))}
        {info('detail.statut', t('status.' + (letter.statut || 'recu')))}
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

      <div className="card">
        <h2 className="card-title">{t('detail.commissionHisto')}</h2>
        {(letter.commissionHisto || []).length === 0 ? (
          <div className="muted">{t('detail.noHisto')}</div>
        ) : (
          <div className="histo">
            {[...letter.commissionHisto].reverse().map((h) => (
              <div key={h.id} className="histo-item">
                <span className={'histo-dot dot-' + h.type} />
                <div>
                  <div>{t('event.' + h.type)} <strong>— {committeeName(h.committee)}</strong></div>
                  {h.note && <div className="muted">{h.note}</div>}
                  <div className="muted small">{fmtDateTime(h.date)} — {h.byName || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canHandleCommittee && (
        <>
          {(canManage || letter.commission) && <div className="card">
            <h2 className="card-title">{t('detail.committeeActions')}</h2>
            {canManage && <div className="status-actions">
                <select value={committee} onChange={(e) => setCommittee(e.target.value)}>
                  <option value="">{t('commission.none')}</option>
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

