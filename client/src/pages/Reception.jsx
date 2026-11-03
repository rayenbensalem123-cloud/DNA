import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Reception() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [committees, setCommittees] = useState([]);
  const committeeName = (id) => committees.find((c) => c.id === id)?.nom || '—';

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    let cancelled = false;
    api.listLetters({ direction: 'entrant', limit: 200, sort: 'date' })
      .then((d) => { if (!cancelled) { setItems(d.items || []); setTotal(d.total || 0); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Courrier entrant</h1><div className="muted">{total} courrier{total === 1 ? '' : 's'} reçu{total === 1 ? '' : 's'}</div></div>
      </div>
      <div className="card">
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>{t('letters.expediteur')}</th><th>{t('letters.commission')}</th><th>{t('letters.statut')}</th><th>{t('letters.date')}</th></tr></thead>
            <tbody>{items.map((l) => (
              <tr key={l.id} className="row-link" onClick={() => navigate('/lettres/' + l.id)}>
                <td className="mono">{l.numeroLettre || '—'}</td><td>{l.objet}</td>
                <td>{l.expediteur?.nom || '—'}</td><td>{committeeName(l.commission)}</td>
                <td><span className={'badge statut-' + l.statut}>{t('status.' + (l.statut || 'recu'))}</span></td><td>{fmtDate(l.dateReception || l.createdAt)}</td>
              </tr>
            ))}{items.length === 0 && <tr><td colSpan={6} className="empty-cell">{t('letters.empty')}</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
