import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize } from '../utils';

export default function CourriersRejetes() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  // Only the bureau d'ordre (admin + supervisor) may delete rejected courriers.
  const canDelete = user?.role === 'admin' || user?.role === 'supervisor';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.listCourriers('rejete');
      setItems(d.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Same as the validation page: reviewing the rejected list clears the red
  // badge on the "Courrier" button.
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

  const remove = async (courrier) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.deleteCourrier(courrier.id);
      setNotice(`Courrier "${courrier.nom}" supprimé.`);
      setConfirmId(null);
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
          <h1>Courriers rejetés</h1>
          <div className="muted">{items.length} courrier{items.length === 1 ? '' : 's'} rejeté{items.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/courrier')}>Retour à la validation</button>
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="account-notice" role="status">{notice}</div>}

      {loading ? <div className="card-pad">{t('common.loading')}</div> : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fichier</th>
                  <th>Taille</th>
                  <th>Televerse par</th>
                  <th>Rejete par</th>
                  <th>Motif</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td><span className="file-pill">Fichier {c.nom}</span></td>
                    <td>{fmtSize(c.taille)}</td>
                    <td>{c.uploadedByName || '—'}</td>
                    <td>{c.validatedBy ? 'Superviseur' : '—'}</td>
                    <td>{c.rejectionReason || '—'}</td>
                    <td className="date-cell">{fmtDate(c.validatedAt || c.uploadedAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id, c.nom)} onMouseEnter={() => api.warmFile('courrier', c.id)} onTouchStart={() => api.warmFile('courrier', c.id)}>Voir</button>
                        {canDelete && <button className="btn btn-danger" onClick={() => setConfirmId(c.id)}>Supprimer</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="empty-cell">Aucun courrier rejeté</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmId && (() => {
        const courrier = items.find((c) => c.id === confirmId);
        if (!courrier) return null;
        return (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}>
            <section className="modal" role="dialog" aria-modal="true">
              <header className="modal-head"><h2>Supprimer le courrier</h2><button type="button" className="modal-close" onClick={() => setConfirmId(null)} aria-label="Fermer">×</button></header>
              <div className="modal-body">
                <p>Supprimer définitivement <strong>{courrier.nom}</strong> (rejeté le {fmtDate(courrier.validatedAt || courrier.uploadedAt)}) ?</p>
                <p className="muted">Cette action est irréversible. L'expéditeur ({courrier.uploadedByName || '—'}) ne verra plus ce courrier.</p>
              </div>
              <div className="modal-foot">
                <button className="btn btn-secondary" onClick={() => setConfirmId(null)}>Annuler</button>
                <button className="btn btn-danger" onClick={() => remove(courrier)} disabled={busy}>{busy ? 'Suppression…' : 'Supprimer'}</button>
              </div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}
