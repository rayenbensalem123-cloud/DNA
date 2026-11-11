import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize } from '../utils';

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
  // Validation is a bureau decision; a comité granted the "courriers"
  // permission can deposit scans but not validate or reject them.
  const isBureau = user?.role === 'admin' || user?.role === 'supervisor';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.listCourriers('a_valider');
      setItems(d.items || []);
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
      for (const file of files) await api.uploadCourrierFile(file);
      setNotice(files.length + ' courrier(s) téléversé(s).');
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
          <div className="muted">{items.length} courrier{items.length === 1 ? '' : 's'} en attente</div>
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
            <thead><tr><th>Fichier</th><th>Taille</th><th>Téléversé par</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><span className="file-pill">Fichier {c.nom}</span></td>
                  <td>{fmtSize(c.taille)}</td>
                  <td>{c.uploadedByName || '—'}</td>
                  <td className="date-cell">{fmtDate(c.uploadedAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id, c.nom)} onMouseEnter={() => api.warmFile('courrier', c.id)} onTouchStart={() => api.warmFile('courrier', c.id)}>Voir</button>
                      {isBureau && <>
                        <button className="btn btn-primary" onClick={() => validate(c)} disabled={busy}>Valider</button>
                        <button className="btn btn-danger" onClick={() => { setRejecting(c); setReason(''); }} disabled={busy}>Rejeter</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="empty-cell">Aucun courrier à valider</td></tr>}
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
