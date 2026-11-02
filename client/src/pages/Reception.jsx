import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';
import LetterForm from '../components/LetterForm';

export default function Reception() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadReceived = async () => {
    setLoading(true);
    try {
      const d = await api.listLetters({ direction: 'entrant', limit: 200, sort: 'date' });
      setItems(d.items);
      setTotal(d.total);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadReceived(); /* eslint-disable-next-line */ }, []);

  const submit = async (data) => {
    const d = await api.createLetter({ ...data, direction: 'entrant' });
    await loadReceived();
    return d.item.id;
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('nav.reception')}</h1>
        <div className="page-actions">
          <span className="muted">{total}</span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">{t('letters.registerReceived')}</h2>
        <LetterForm initial={{ statut: 'recu', direction: 'entrant' }} onSubmit={submit} submitLabel={t('letters.registerReceived')} />
      </div>

      <div className="card">
        <h2 className="card-title">{t('letters.received')}</h2>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <table className="table">
            <thead>
              <tr><th>{t('letters.ref')}</th><th>{t('letters.objet')}</th><th>{t('letters.expediteur')}</th><th>{t('letters.statut')}</th><th>{t('letters.date')}</th></tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.ref}</td>
                  <td>{l.objet}</td>
                  <td>{l.expediteur?.nom || '—'}</td>
                  <td><span className={'badge statut-' + l.statut}>{t('status.' + (l.statut || 'recu'))}</span></td>
                  <td>{fmtDate(l.dateReception || l.createdAt)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="empty-cell">{t('letters.empty')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
