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
                    <td><button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id)}>Voir</button></td>
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
    </div>
  );
}
