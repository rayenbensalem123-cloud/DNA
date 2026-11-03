import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Letters() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [committees, setCommittees] = useState([]);
  const [filters, setFilters] = useState({
    q: '', direction: '', statut: '', priorite: '', commission: '',
  });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFilters((current) => ({ ...current, direction: params.get('direction') || '', statut: params.get('statut') || '', priorite: params.get('priorite') || '' }));
  }, [location.search]);

  const committeeName = (id) => (committees.find((c) => c.id === id)?.nom) || '—';

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);

  const fetchData = async (f) => {
    setLoading(true);
    const params = { limit: 200, sort: 'date', ...f };
    Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
    try {
      const d = await api.listLetters(params);
      setItems(d.items);
      setTotal(d.total);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(filters); /* eslint-disable-next-line */ }, [JSON.stringify(filters)]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('nav.lettres')}</h1>
        <div className="page-actions">
          {user?.role === 'admin' && <button className="btn btn-primary" onClick={() => navigate('/?newLetter=1')}>{t('letters.create')}</button>}
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <input placeholder={t('letters.searchPlaceholder')} value={filters.q} onChange={(e) => set('q', e.target.value)} />
          <select value={filters.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            <option value="entrant">{t('direction.entrant')}</option>
            <option value="sortant">{t('direction.sortant')}</option>
          </select>
          <select value={filters.statut} onChange={(e) => set('statut', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            <option value="recu">{t('status.recu')}</option>
            <option value="enregistre">{t('status.enregistre')}</option>
            <option value="en_cours">{t('status.en_cours')}</option>
            <option value="traite">{t('status.traite')}</option>
            <option value="transmis">{t('status.transmis')}</option>
            <option value="archive">{t('status.archive')}</option>
          </select>
          <select value={filters.priorite} onChange={(e) => set('priorite', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            <option value="normale">{t('priorite.normale')}</option>
            <option value="urgente">{t('priorite.urgente')}</option>
            <option value="confidentielle">{t('priorite.confidentielle')}</option>
          </select>
          <select value={filters.commission} onChange={(e) => set('commission', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>

        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>{t('letters.direction')}</th>
                  <th>{t('letters.commission')}</th><th>{t('letters.statut')}</th>
                  <th>{t('letters.priorite')}</th><th>{t('letters.date')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => navigate('/lettres/' + l.id)}>
                    <td className="mono">{l.numeroLettre || '—'}</td>
                    <td>{l.objet}</td>
                    <td>{t('direction.' + (l.direction || 'entrant'))}</td>
                    <td>{committeeName(l.commission)}</td>
                    <td><span className={'badge statut-' + l.statut}>{t('status.' + (l.statut || 'recu'))}</span></td>
                    <td>{t('priorite.' + (l.priorite || 'normale'))}</td>
                    <td>{fmtDate(l.dateEmission)}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="empty-cell">{t('letters.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer">{total} courrier{total === 1 ? '' : 's'}</div>
      </div>
    </div>
  );
}

