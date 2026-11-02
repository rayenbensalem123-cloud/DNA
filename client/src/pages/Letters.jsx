import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Letters() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    q: '', direction: '', statut: '', type: '', categorie: '', priorite: '', from: '', to: '',
  });

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
          <Link className="btn btn-primary" to="/lettres/nouveau">{t('letters.create')}</Link>
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
          <select value={filters.type} onChange={(e) => set('type', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            <option value="officielle">{t('type.officielle')}</option>
            <option value="arrete">{t('type.arrete')}</option>
            <option value="decret">{t('type.decret')}</option>
            <option value="note">{t('type.note')}</option>
            <option value="courrier">{t('type.courrier')}</option>
            <option value="mandat">{t('type.mandat')}</option>
            <option value="autre">{t('type.autre')}</option>
          </select>
          <select value={filters.categorie} onChange={(e) => set('categorie', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            {Object.keys({ administration: 1, juridique: 1, finances: 1, rh: 1, communication: 1, securite: 1, autre: 1 }).map((c) => (
              <option key={c} value={c}>{t('categorie.' + c)}</option>
            ))}
          </select>
          <select value={filters.priorite} onChange={(e) => set('priorite', e.target.value)}>
            <option value="">{t('filter.all')}</option>
            <option value="normale">{t('priorite.normale')}</option>
            <option value="urgente">{t('priorite.urgente')}</option>
            <option value="confidentielle">{t('priorite.confidentielle')}</option>
          </select>
        </div>

        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('letters.ref')}</th><th>{t('letters.objet')}</th><th>{t('letters.direction')}</th>
                  <th>{t('letters.type')}</th><th>{t('letters.categorie')}</th><th>{t('letters.statut')}</th>
                  <th>{t('letters.priorite')}</th><th>{t('letters.date')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => (window.location.href = '/lettres/' + l.id)}>
                    <td className="mono">{l.ref}</td>
                    <td>{l.objet}</td>
                    <td>{t('direction.' + (l.direction || 'entrant'))}</td>
                    <td>{t('type.' + (l.type || 'autre'))}</td>
                    <td>{t('categorie.' + (l.categorie || 'autre'))}</td>
                    <td><span className={'badge statut-' + l.statut}>{t('status.' + (l.statut || 'recu'))}</span></td>
                    <td>{t('priorite.' + (l.priorite || 'normale'))}</td>
                    <td>{fmtDate(l.dateEmission)}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="empty-cell">{t('letters.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-footer">{t('common.save')} — {total} {t('letters.ref').toLowerCase()}</div>
      </div>
    </div>
  );
}
