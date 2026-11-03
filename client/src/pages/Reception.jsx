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
  const [committees, setCommittees] = useState([]);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'warn', text }

  const committeeName = (id) => (committees.find((c) => c.id === id)?.nom) || '—';

  useEffect(() => {
    api.committees().then((d) => setCommittees(d.items || [])).catch(() => {});
  }, []);

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
    const { files, ...fields } = data;
    const { item, failed } = await api.createLetterWithFiles({ ...fields, direction: 'entrant' }, files || []);
    await loadReceived();
    setFormKey((k) => k + 1); // a fresh, empty form, so the same letter is not registered twice by accident
    setNotice(failed.length
      ? { kind: 'warn', text: t('create.partialFail', { ref: item.ref, files: failed.map((x) => `${x.name} (${x.message})`).join(', ') }) }
      : { kind: 'ok', text: t('create.saved', { ref: item.ref }) });
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
        {notice && <div className={'form-notice' + (notice.kind === 'warn' ? ' warn' : '')}>{notice.text}</div>}
        <LetterForm key={formKey} initial={{ statut: 'recu', direction: 'entrant' }} onSubmit={submit} submitLabel={t('letters.registerReceived')} />
      </div>

      <div className="card">
        <h2 className="card-title">{t('letters.received')}</h2>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <table className="table">
            <thead>
              <tr><th>{t('letters.ref')}</th><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>{t('letters.expediteur')}</th><th>{t('letters.commission')}</th><th>{t('letters.statut')}</th><th>{t('letters.date')}</th></tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.ref}</td>
                  <td className="mono">{l.numeroLettre || '—'}</td>
                  <td>{l.objet}</td>
                  <td>{l.expediteur?.nom || '—'}</td>
                  <td>{committeeName(l.commission)}</td>
                  <td><span className={'badge statut-' + l.statut}>{t('status.' + (l.statut || 'recu'))}</span></td>
                  <td>{fmtDate(l.dateReception || l.createdAt)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="empty-cell">{t('letters.empty')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
