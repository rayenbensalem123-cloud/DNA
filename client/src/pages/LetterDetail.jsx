import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtDateTime, fmtSize } from '../utils';
import Modal from '../components/Modal';
import LetterForm from '../components/LetterForm';

export default function LetterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [letter, setLetter] = useState(null);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statut, setStatut] = useState('');
  const [committee, setCommittee] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'warn', text }

  const committeeName = (cid) => (committees.find((c) => c.id === cid)?.nom) || cid || '—';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.committees().then((d) => { if (!cancelled) setCommittees(d.items || []); }).catch(() => {});
    api.getLetter(id)
      .then((d) => {
        if (cancelled) return;
        const found = d.item || null;
        setLetter(found);
        setStatut(found ? found.statut : '');
        setCommittee(found ? (found.commission || '') : '');
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setLetter(null); setError(e.message || 'Erreur'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const applyLetter = (item) => {
    setLetter(item);
    setStatut(item.statut);
    setCommittee(item.commission || '');
  };

  const openEdit = () => { setEditError(''); setNotice(null); setEditing(true); };

  // Saves the edited fields and uploads the newly added files.
  // If saving the fields fails, the error is thrown so the pop-up shows it and stays open.
  // If only some files fail, the edit is kept, the pop-up closes and the message names those files.
  const saveEdit = async (data) => {
    const { files, ...fields } = data;
    const { item, failed } = await api.updateLetterWithFiles(letter.id, fields, files || []);
    applyLetter(item);
    setError('');
    setEditing(false);
    if (failed.length) {
      setNotice({ kind: 'warn', text: t('edit.partialFail', { files: failed.map((x) => `${x.name} (${x.message})`).join(', ') }) });
    } else {
      setNotice({ kind: 'ok', text: t('edit.saved') });
    }
  };

  const removePiece = async (piece) => {
    setEditError('');
    try {
      await api.deletePiece(letter.id, piece.id);
      const d = await api.getLetter(letter.id);
      applyLetter(d.item);
    } catch (e) { setEditError(e.message || 'Erreur'); }
  };

  const saveStatus = async () => {
    if (!letter) return;
    try {
      const d = await api.updateLetter(letter.id, { statut, commission: committee || null });
      setLetter(d.item);
      setStatut(d.item.statut);
      setCommittee(d.item.commission || '');
    } catch (e) { setError(e.message || 'Erreur'); }
  };

  const assignCommittee = async () => {
    if (!letter) return;
    setBusy(true);
    setError('');
    try {
      const changed = (committee || null) !== (letter.commission || null);
      const nextStatut = changed ? (committee ? 'transmis' : 'recu') : statut;
      const d = await api.updateLetter(letter.id, { commission: committee || null, statut: nextStatut });
      setLetter(d.item);
      setStatut(d.item.statut);
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
      setStatut(d.item.statut);
      setNote('');
    } catch (e) { setError(e.message || 'Erreur'); }
    setBusy(false);
  };

  const remove = async () => {
    if (!letter) return;
    try {
      await api.deleteLetter(letter.id);
      navigate('/lettres');
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

  const canManage = user?.role === 'admin' || user?.role === 'agent';

  const info = (key, value) => (
    <div key={key} className="detail-row">
      <div className="detail-label">{t(key)}</div>
      <div className="detail-value">{value}</div>
    </div>
  );

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>{t('detail.title')} — {letter.ref}</h1>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/lettres')}>{t('detail.back')}</button>
          {canManage && <button className="btn btn-primary" onClick={openEdit}>{t('detail.edit')}</button>}
          {canManage && <button className="btn btn-danger" onClick={remove}>{t('detail.delete')}</button>}
        </div>
      </div>
      {notice && <div className={'form-notice' + (notice.kind === 'warn' ? ' warn' : '')}>{notice.text}</div>}
      <div className="card">
        {info('detail.ref', letter.ref)}
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

      {canManage && (
        <>
          <div className="card">
            <h2 className="card-title">{t('detail.committeeActions')}</h2>
            <div className="status-actions">
              <select value={committee} onChange={(e) => setCommittee(e.target.value)}>
                <option value="">{t('commission.none')}</option>
                {committees.map((c) => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={assignCommittee} disabled={busy}>{t('detail.transmit')}</button>
            </div>
            {letter.commission && (
              <div className="status-actions">
                <button className="btn btn-secondary" onClick={() => addEvent('recu_comite')} disabled={busy}>{t('detail.markReceived')}</button>
                <button className="btn btn-secondary" onClick={() => addEvent('traite_comite')} disabled={busy}>{t('detail.markTreated')}</button>
              </div>
            )}
            <label className="field">
              <span>{t('detail.note')}</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('detail.notePlaceholder')} />
            </label>
          </div>

          <div className="card">
            <h2 className="card-title">{t('detail.actions')}</h2>
            <div className="status-actions">
              <select value={statut} onChange={(e) => setStatut(e.target.value)}>
                {['recu', 'enregistre', 'en_cours', 'traite', 'transmis', 'archive'].map((s) => (
                  <option key={s} value={s}>{t('status.' + s)}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={saveStatus}>{t('common.save')}</button>
            </div>
            <div className="muted">{fmtDateTime(letter.createdAt)}</div>
          </div>
        </>
      )}
      {error && <div className="form-error">{error}</div>}

      {editing && (
        <Modal title={t('edit.title')} onClose={() => setEditing(false)} closeLabel={t('common.close')}>
          <LetterForm
            mode="modal"
            initial={letter}
            submitLabel={t('edit.save')}
            onSubmit={saveEdit}
            onCancel={() => setEditing(false)}
            existingPieces={letter.pieces || []}
            onOpenPiece={async (p) => {
              setEditError('');
              try { await api.openPiece(letter.id, p.id); } catch (e) { setEditError(e.message || 'Erreur'); }
            }}
            onDeletePiece={removePiece}
            canDeletePieces={user?.role === 'admin'}
            error={editError}
          />
        </Modal>
      )}
    </div>
  );
}
