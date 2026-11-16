import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize } from '../utils';
import { extractPdfSubject } from '../utils/pdfSubject';

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

  // Opening the validation page clears the red badge on the "Courrier" button:
  // its count is the number of unread rejection notifications for this user.
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


  const handleFiles = async (files) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Read each PDF: the extracted subject becomes the letter's title when
      // the bureau validates the scan (instead of the file name). Scans go
      // through OCR — a few seconds each, so show what is happening.
      let readCount = 0;
      for (const file of files) {
        const sujet = await extractPdfSubject(file, (phase) => {
          if (phase === 'ocr') setNotice('Lecture du PDF « ' + file.name + ' » (OCR du scan)… ça peut prendre quelques secondes.');
        });
        if (sujet) readCount++;
        await api.uploadCourrierFile(file, sujet);
      }
      setNotice(files.length + ' courrier(s) téléversé(s)' + (readCount ? ` — sujet lu automatiquement pour ${readCount}.` : '.'));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
    </div>
  );
}
