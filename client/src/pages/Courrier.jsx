import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize } from '../utils';
import { extractPdfDetails, DETAIL_LABELS } from '../utils/pdfExtract';

export default function Courrier() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Two-step validation: step 1 by the DAF (or admin), step 2 by the
  // supervisor/admin. A comité granted the "courriers" permission can deposit
  // scans but not validate or reject them.
  const role = user?.role || 'agent';
  const isBureau = role === 'admin' || role === 'supervisor' || role === 'daf';
  const canDafStep = role === 'daf' || role === 'admin';
  const canFinalStep = role === 'supervisor' || role === 'admin';
  // OCR review: files awaiting confirmation before upload.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]); // { file, details, edited }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pending, dafValidated] = await Promise.all([api.listCourriers('a_valider'), api.listCourriers('daf_valide')]);
      const merged = [...(pending.items || []), ...(dafValidated.items || [])]
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      setItems(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.courrierNotifications().then(async (d) => {
      const unread = (d.items || []).filter((n) => !n.read);
      for (const n of unread) {
        if (cancelled) return;
        await api.markCourrierNotificationRead(n.id).catch(() => {});
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const readFileAsBuffer = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });

  const handleFiles = async (files) => {
    setBusy(true);
    setError('');
    setNotice('');
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
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateField = (fileIdx, field, value) => {
    setPendingFiles((prev) => prev.map((p, i) => i === fileIdx ? { ...p, edited: { ...p.edited, [field]: value } } : p));
  };

  const confirmImport = async () => {
    setBusy(true);
    setError('');
    setReviewOpen(false);
    try {
      for (const p of pendingFiles) {
        await api.uploadCourrierFile(p.file, p.edited.sujet, {
          expediteur: p.edited.expediteur,
          dateEmission: p.edited.dateEmission,
          priorite: p.edited.priorite,
          reference: p.edited.reference,
          categorie: p.edited.categorie,
        });
      }
      setNotice(pendingFiles.length + ' courrier(s) importé(s).');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setPendingFiles([]);
    }
  };

  const validateDaf = async (c) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.validateCourrierDaf(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé (étape DAF) — en attente de la validation finale.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const validate = async (c) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.validateCourrier(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé — lettre créée.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.rejectCourrier(rejecting.id, reason);
      setNotice('Courrier ' + rejecting.nom + ' rejeté.');
      setRejecting(null);
      setReason('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente', confidentielle: 'Confidentielle' };
  const CATEGORY_LABELS = { administration: 'Administration', juridique: 'Juridique', finances: 'Finances', rh: 'Ressources humaines', communication: 'Communication', securite: 'Sécurité' };

  return (
    <div className="page">
      <div className="page-header">
          <div className="page-title-copy">
            <span className="page-title-kicker">Validation</span>
            <h1>Courriers à valider</h1>
            <div className="muted">{items.length} courrier{items.length === 1 ? '' : 's'} en attente — validation en deux étapes : DAF puis superviseur</div>
          </div>
        <div className="page-actions">
          <label className="btn btn-primary" style={{ cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Téléversement...' : 'Téléverser des courriers'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files.length) handleFiles(Array.from(e.target.files)); e.target.value = ''; }} disabled={busy} />
          </label>
          {isBureau && <button className="btn btn-secondary" onClick={() => navigate('/courriers-rejetes')}>Courriers rejetés</button>}
        </div>
      </div>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {loading ? <div className="card-pad">{t('common.loading')}</div> : (
        <div className="card">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fichier</th><th>Taille</th><th>Téléversé par</th><th>Date</th><th>Étape</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><span className="file-pill">Fichier {c.nom}</span>{c.sujet && <div className="muted small" style={{ marginTop: 4 }}>Titre lu : {c.sujet}</div>}</td>
                  <td>{fmtSize(c.taille)}</td>
                  <td>{c.uploadedByName || '—'}</td>
                  <td className="date-cell">{fmtDate(c.uploadedAt)}</td>
                  <td>{c.status === 'daf_valide'
                    ? <span className="badge statut-en_cours" title={c.dafValidatedByName ? `Validé par ${c.dafValidatedByName}` : ''}>DAF ✓ · superviseur requis</span>
                    : <span className="badge statut-recu" title={c.dafValidatedByName ? `Validé par ${c.dafValidatedByName}` : ''}>DAF requis</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id, c.nom)} onMouseEnter={() => api.warmFile('courrier', c.id)} onTouchStart={() => api.warmFile('courrier', c.id)}>Voir</button>
                      {isBureau && c.status === 'a_valider' && canDafStep && <button className="btn btn-secondary" onClick={() => validateDaf(c)} disabled={busy} title="Validation DAF (étape 1)">Valider (DAF)</button>}
                      {isBureau && c.status === 'a_valider' && role === 'admin' && <button className="btn btn-primary" onClick={() => validate(c)} disabled={busy} title="Validation directe (les deux étapes)">Valider (2 étapes)</button>}
                      {isBureau && c.status === 'a_valider' && role === 'supervisor' && <span className="muted small">En attente du DAF</span>}
                      {isBureau && c.status === 'daf_valide' && canFinalStep && <button className="btn btn-primary" onClick={() => validate(c)} disabled={busy} title="Validation finale (étape 2)">Valider (final)</button>}
                      {isBureau && c.status === 'daf_valide' && !canFinalStep && <span className="muted small">En attente du superviseur</span>}
                      {isBureau && <button className="btn btn-danger" onClick={() => { setRejecting(c); setReason(''); }} disabled={busy}>Rejeter</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="empty-cell">Aucun courrier à valider</td></tr>}
            </tbody>
          </table></div>
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
    </div>
  );
}
