import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize } from '../utils';
import { extractPdfDetails } from '../utils/pdfExtract';
import Select from '../components/Select';
import LetterCreateModal from '../components/LetterCreateModal';

export default function Courrier() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const role = user?.role || 'agent';
  const isBureau = role === 'admin' || role === 'supervisor' || role === 'daf';
  const canCreate = isBureau || Boolean(user?.permissions?.create);
  const canDafStep = role === 'daf' || role === 'admin';
  const canFinalStep = role === 'supervisor' || role === 'admin';

  const [users, setUsers] = useState([]); // employees for assignment
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingDirection, setPendingDirection] = useState('entrant');
  const [showCreate, setShowCreate] = useState(false);
  const [pending, setPending] = useState([]);
  const [assigningLetter, setAssigningLetter] = useState(null);

  const employeeName = (id) => users.find((u) => u.id === id)?.name || id;

  // Administration employees (only those allowed to be responsible for a courrier)
  const adminEmployees = users.filter((u) => ['admin', 'supervisor', 'daf'].includes(u.role));

  useEffect(() => {
    api.users().then((d) => setUsers(d.items || [])).catch(() => {});
  }, []);

  const loadPending = useCallback(() => Promise.all([api.listCourriers('a_valider'), api.listCourriers('daf_valide')])
    .then(([a, b]) => setPending([...(a.items || []), ...(b.items || [])].sort((x, y) => String(y.uploadedAt).localeCompare(String(x.uploadedAt)))))
    .catch(() => {}), []);

  useEffect(() => {
    let cancelled = false;
    loadPending().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadPending]);

  const validateDaf = async (c) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.validateCourrierDaf(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé (étape DAF) — en attente de la validation finale.');
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const validateFinal = async (c) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.validateCourrier(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé — lettre créée.');
      setAssigningLetter(c);
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.rejectCourrier(rejecting.id, reason);
      setNotice('Courrier ' + rejecting.nom + ' rejeté.');
      setRejecting(null); setReason('');
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const assignTo = async (c, employeeId) => {
    setBusy(true); setError('');
    try {
      await api.assignCourrier(c.id, employeeId);
      setNotice(employeeId ? 'Responsable : ' + employeeName(employeeId) : 'Responsable retiré');
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const assignEmployee = async (employeeId) => {
    if (!assigningLetter) return;
    setBusy(true); setError('');
    try {
      await api.assignCourrier(assigningLetter.id, employeeId);
      setNotice('Responsable : ' + employeeName(employeeId));
      setAssigningLetter(null);
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente', confidentielle: 'Confidentielle' };
  const CATEGORY_LABELS = { administration: 'Administration', juridique: 'Juridique', finances: 'Finances', rh: 'Ressources humaines', communication: 'Communication', securite: 'Sécurité' };

  const handleFiles = async (files, direction = 'entrant') => {
    setPendingDirection(direction);
    setBusy(true); setError(''); setNotice('');
    const extracted = [];
    try {
      let readCount = 0;
      for (const file of files) {
        const details = await extractPdfDetails(file, (phase) => {
          if (phase === 'ocr') setNotice('Lecture de « ' + file.name + ' » (OCR du scan)…');
        });
        if (details.sujet) readCount++;
        extracted.push({ file, details, edited: { ...details } });
      }
      setPendingFiles(extracted);
      setReviewOpen(true);
      setNotice(files.length + ' fichier(s) prêt(s) à importer' + (readCount ? ` — champs lus automatiquement pour ${readCount}.` : '.'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const handleSingleFile = async (file, direction = 'entrant') => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const details = await extractPdfDetails(file, (phase) => {
        if (phase === 'ocr') setNotice('Lecture de « ' + file.name + ' » (OCR du scan)…');
      });
      await api.uploadCourrierFile(file, details.sujet, {
        expediteur: details.expediteur,
        dateEmission: details.dateEmission,
        priorite: details.priorite,
        reference: details.reference,
        categorie: details.categorie,
        direction,
      });
      setNotice('Courrier importé : ' + file.name + (details.sujet ? ' (sujet lu automatiquement)' : ''));
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const updateField = (fileIdx, field, value) => {
    setPendingFiles((prev) => prev.map((p, i) => i === fileIdx ? { ...p, edited: { ...p.edited, [field]: value } } : p));
  };

  const confirmImport = async () => {
    setBusy(true); setError(''); setReviewOpen(false);
    try {
      for (const p of pendingFiles) {
        await api.uploadCourrierFile(p.file, p.edited.sujet, {
          expediteur: p.edited.expediteur,
          dateEmission: p.edited.dateEmission,
          priorite: p.edited.priorite,
          reference: p.edited.reference,
          categorie: p.edited.categorie,
          direction: pendingDirection,
        });
      }
      setNotice(pendingFiles.length + ' courrier(s) importé(s).');
      await loadPending();
    } catch (e) { setError(e.message); } finally { setBusy(false); setPendingFiles([]); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-copy">
          <span className="page-title-kicker">Validation</span>
          <h1>Courriers à valider</h1>
          <div className="muted">{pending.length} scan{pending.length === 1 ? '' : 's'} en attente — validation en deux étapes : DAF puis superviseur</div>
        </div>
        <div className="page-actions">
          {canCreate && <button type="button" className="btn btn-primary btn-add" style={{ gap: 6 }} onClick={() => setShowCreate(true)}>
            <span className="plus" aria-hidden="true">+</span><span className="btn-label">Ajouter un courrier</span>
          </button>}
          <label className="btn btn-secondary" title="Sélectionner un ou plusieurs scans à valider" style={{ cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Téléversement...' : 'Courrier'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length === 1) handleSingleFile(f[0]); else if (f.length > 1) handleFiles(f); }} />
          </label>
          {isBureau && <button className="btn btn-secondary" onClick={() => navigate('/courriers-rejetes')}>Courriers rejetés</button>}
        </div>
      </div>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {loading ? <div className="card-pad">{t('common.loading')}</div> : (
        <div className="card">
          <div className="archive-list-heading">
            <h2 className="card-title">Scans en attente de validation</h2>
            <span className="muted">{pending.length} au total</span>
          </div>
          {pending.length === 0 ? (
            <div className="card-pad empty-cell">Aucun courrier à valider.</div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Fichier</th><th>Type</th><th>Téléversé par</th><th>Date</th><th>Étape</th><th>Responsable</th><th>Actions</th></tr></thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.id}>
                    <td title={c.nom}><span className="file-pill">Fichier {c.nom}</span>{c.sujet && <div className="muted small" style={{ marginTop: 4 }}>Titre lu : {c.sujet}</div>}<div className="muted small">{fmtSize(c.taille)}</div></td>
                    <td><span className={'direction-pill direction-' + (c.direction === 'sortant' ? 'sortant' : 'entrant')}><i />{c.direction === 'sortant' ? 'Départ' : 'Arrivée'}</span></td>
                    <td>{c.uploadedByName || '—'}</td>
                    <td className="date-cell">{fmtDate(c.uploadedAt)}</td>
                    <td>{c.status === 'daf_valide'
                      ? <span className="badge statut-en_cours" title={c.dafValidatedByName ? `Validé par ${c.dafValidatedByName}` : ''}>DAF ✓ · superviseur requis</span>
                      : <span className="badge statut-recu">DAF requis</span>}</td>
                    <td>
                      {isBureau ? (
                        <Select ariaLabel="Responsable" value={c.assignedTo || ''} onChange={(v) => assignTo(c, v)} disabled={busy} options={[{ value: '', label: 'Responsable…' }, ...adminEmployees.map((u) => ({ value: u.id, label: u.name || u.username }))]} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="row-actions" style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
                        <button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id, c.nom).catch((e) => setError(e.message))} onMouseEnter={() => api.warmFile('courrier', c.id)} onTouchStart={() => api.warmFile('courrier', c.id)}>Voir</button>
                        {isBureau && c.status === 'a_valider' && canDafStep && role !== 'admin' && <button className="btn btn-primary" onClick={() => validateDaf(c)} disabled={busy} title="Validation DAF (étape 1)">Valider (DAF)</button>}
                        {isBureau && c.status === 'a_valider' && role === 'admin' && <button className="btn btn-primary" onClick={() => validateFinal(c)} disabled={busy} title="Validation directe (les deux étapes)">Valider (2 étapes)</button>}
                        {isBureau && c.status === 'a_valider' && role === 'supervisor' && <span className="muted small">En attente du DAF</span>}
                        {isBureau && c.status === 'daf_valide' && canFinalStep && <button className="btn btn-primary" onClick={() => validateFinal(c)} disabled={busy} title="Validation finale (étape 2)">Valider (final)</button>}
                        {isBureau && c.status === 'daf_valide' && !canFinalStep && <span className="muted small">En attente du superviseur</span>}
                        {isBureau && <button className="btn btn-danger" onClick={() => { setRejecting(c); setReason(''); }} disabled={busy}>Rejeter</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {rejecting && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setRejecting(null); setReason(''); } }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Rejeter le courrier</h2><button type="button" className="modal-close" onClick={() => { setRejecting(null); setReason(''); }}>x</button></header>
            <div className="modal-body">
              <p className="muted">Fichier : <strong>{rejecting.nom}</strong></p>
              <label className="field">Motif du rejet
                <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: document illisible, mauvais format, etc." />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => { setRejecting(null); setReason(''); }}>Annuler</button>
              <button className="btn btn-danger" onClick={reject} disabled={busy || !reason.trim()}>{busy ? 'Rejet...' : 'Rejeter'}</button>
            </div>
          </section>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setReviewOpen(false); setPendingFiles([]); } }}>
          <section className="modal" style={{ width: 'min(960px, 92vw)' }} role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Confirmer l'import — champs lus par l'OCR</h2><button type="button" className="modal-close" onClick={() => { setReviewOpen(false); setPendingFiles([]); }}>x</button></header>
            <div className="modal-body">
              <p className="muted">Vérifiez et corrigez les champs lus automatiquement sur chaque scan avant l'import.</p>
              <div className="table-wrap" style={{ maxHeight: '64vh', overflow: 'auto', marginTop: 10 }}>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr>
                    <th style={{ width: '26%' }}>Fichier</th>
                    <th>Sujet (objet)</th>
                    <th>Expéditeur</th>
                    <th>Date</th>
                    <th>Priorité</th>
                    <th>Référence</th>
                    <th>Catégorie</th>
                  </tr></thead>
                  <tbody>
                    {pendingFiles.map((p, i) => (
                      <tr key={i}>
                        <td className="mono nowrap" style={{ fontSize: 12 }}>{p.file.name}</td>
                        <td><input className="form-input" value={p.edited.sujet} onChange={(e) => updateField(i, 'sujet', e.target.value)} /></td>
                        <td><input className="form-input" value={p.edited.expediteur} onChange={(e) => updateField(i, 'expediteur', e.target.value)} /></td>
                        <td><input className="form-input" value={p.edited.dateEmission} onChange={(e) => updateField(i, 'dateEmission', e.target.value)} placeholder="jj/mm/aaaa" /></td>
                        <td><select className="form-input" value={p.edited.priorite} onChange={(e) => updateField(i, 'priorite', e.target.value)}>
                          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></td>
                        <td><input className="form-input" value={p.edited.reference} onChange={(e) => updateField(i, 'reference', e.target.value)} /></td>
                        <td><select className="form-input" value={p.edited.categorie} onChange={(e) => updateField(i, 'categorie', e.target.value)}>
                          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></td>
                      </tr>
                    ))}
                    {pendingFiles.length === 0 && <tr><td colSpan={7} className="empty-cell">Aucun fichier.</td></tr>}
                  </tbody>
                </table>
              </div>
              {pendingFiles.some((p) => p.usedOcr) && <p className="muted small" style={{ marginTop: 8 }}>Certains fichiers ont été lus par OCR (scan sans couche texte) — vérifiez particulièrement les noms et dates.</p>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => { setReviewOpen(false); setPendingFiles([]); }}>Annuler</button>
              <button className="btn btn-primary" onClick={confirmImport} disabled={busy}>{busy ? 'Import…' : 'Importer tout'}</button>
            </div>
          </section>
        </div>
      )}

      {assigningLetter && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAssigningLetter(null); }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Responsable du courrier</h2><button type="button" className="modal-close" onClick={() => setAssigningLetter(null)} aria-label="Fermer">×</button></header>
            <div className="modal-body">
              <p className="muted">{assigningLetter.sujet || assigningLetter.nom}</p>
              <label className="field">Responsable
                <Select ariaLabel="Employé" value={assigningLetter.assignedTo || ''} onChange={(v) => assignEmployee(v)} options={[{ value: '', label: '— Choisir un employé —' }, ...adminEmployees.map((u) => ({ value: u.id, label: u.name || u.username }))]} />
              </label>
              <p className="muted small">Employés de l’administration uniquement. Il sera responsable de la lettre une fois le courrier validé.</p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setAssigningLetter(null)}>Plus tard</button>
            </div>
          </section>
        </div>
      )}
      {showCreate && <LetterCreateModal onClose={() => { setShowCreate(false); loadPending(); }} />}
    </div>
  );
}
