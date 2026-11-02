import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Dashboard() {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.stats()
      .then((d) => { if (!cancelled) { setStats(d); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    api.listLetters({ limit: 6, sort: 'date' })
      .then((d) => { if (!cancelled) { setRecent(d.items); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const cards = stats ? [
    { label: t('dashboard.total'), value: stats.total, tone: 'blue' },
    { label: t('dashboard.entrants'), value: stats.entrants, tone: 'green' },
    { label: t('dashboard.sortants'), value: stats.sortants, tone: 'purple' },
    { label: t('dashboard.enAttente'), value: (stats?.total || 0) - (stats?.parStatut?.archive || 0), tone: 'amber' },
    { label: t('dashboard.archive'), value: stats.archivesCeMois, tone: 'gray' },
    { label: t('dashboard.urgent'), value: stats.urgentes, tone: 'red' },
  ] : [];

  const maxCat = Math.max(1, ...Object.entries(stats?.parCategorie || {}).map(([, v]) => v));
  const maxStat = Math.max(1, ...Object.values(stats?.parStatut || {}));

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('dashboard.title')}</h1>
        <div className="page-actions">
          <Link className="btn btn-secondary" to="/lettres/nouveau">{t('letters.create')}</Link>
          <Link className="btn btn-primary" to="/reception">{t('letters.registerReceived')}</Link>
        </div>
      </div>

      {loading ? <div className="card">{t('common.loading')}</div> : (
        <>
          <div className="stat-grid">
            {cards.map((c) => (
              <div key={c.label} className={'stat-card tone-' + c.tone}>
                <div className="stat-value">{c.value}</div>
                <div className="stat-label">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="dash-columns">
            <div className="card">
              <h2 className="card-title">{t('dashboard.total')} — {t('dashboard.receivedMonth')}</h2>
              <div className="bar-row">
                <div className="bar-label">{t('dashboard.entrants')}</div>
                <div className="bar-track"><div className="bar-fill green" style={{ width: (stats?.entrants || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.entrants || 0}</div>
              </div>
              <div className="bar-row">
                <div className="bar-label">{t('dashboard.sortants')}</div>
                <div className="bar-track"><div className="bar-fill purple" style={{ width: (stats?.sortants || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.sortants || 0}</div>
              </div>
              <div className="bar-row">
                <div className="bar-label">{t('dashboard.receivedMonth')}</div>
                <div className="bar-track"><div className="bar-fill blue" style={{ width: ((stats?.recusCeMois || 0) / Math.max(1, stats?.total || 1)) * 100 + '%' }} /></div>
                <div className="bar-value">{stats?.recusCeMois || 0}</div>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">{t('dashboard.enAttente')}</h2>
              <div className="bar-row">
                <div className="bar-label">{t('status.recu')}</div>
                <div className="bar-track"><div className="bar-fill slate" style={{ width: (stats?.parStatut?.recu || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.parStatut?.recu || 0}</div>
              </div>
              <div className="bar-row">
                <div className="bar-label">{t('status.enregistre')}</div>
                <div className="bar-track"><div className="bar-fill blue" style={{ width: (stats?.parStatut?.enregistre || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.parStatut?.enregistre || 0}</div>
              </div>
              <div className="bar-row">
                <div className="bar-label">{t('status.en_cours')}</div>
                <div className="bar-track"><div className="bar-fill amber" style={{ width: (stats?.parStatut?.en_cours || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.parStatut?.en_cours || 0}</div>
              </div>
              <div className="bar-row">
                <div className="bar-label">{t('status.traite')}</div>
                <div className="bar-track"><div className="bar-fill green" style={{ width: (stats?.parStatut?.traite || 0) + '%' }} /></div>
                <div className="bar-value">{stats?.parStatut?.traite || 0}</div>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">{t('dashboard.total')} — {t('categorie.administration')}</h2>
              {Object.entries(stats?.parCategorie || {}).slice(0, 6).map(([cat, count]) => (
                <div key={cat} className="bar-row">
                  <div className="bar-label">{t('categorie.' + cat)}</div>
                  <div className="bar-track"><div className="bar-fill blue" style={{ width: (count / maxCat) * 100 + '%' }} /></div>
                  <div className="bar-value">{count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">{t('letters.title')}</h2>
            <table className="table">
              <thead>
                <tr><th>{t('letters.ref')}</th><th>{t('letters.objet')}</th><th>{t('letters.statut')}</th><th>{t('letters.date')}</th></tr>
              </thead>
              <tbody>
                {recent.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => (window.location.href = '/lettres/' + l.id)}>
                    <td>{l.ref}</td><td>{l.objet}</td><td><span className={'badge statut-' + l.statut}>{t('status.' + l.statut)}</span></td><td>{fmtDate(l.dateEmission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
