import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Dashboard() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.stats(), api.listLetters({ limit: 500, sort: 'date' })])
      .then(([summary, letters]) => {
        if (cancelled) return;
        setStats(summary);
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
        const scanned = (letters.items || []).flatMap((letter) => (letter.pieces || [])
          .filter((piece) => piece.hasFile && piece.uploadedAt && new Date(piece.uploadedAt) >= startOfWeek && new Date(piece.uploadedAt) <= now)
          .map((piece) => ({ ...letter, scannedFile: piece.nom, scannedAt: piece.uploadedAt, scanKey: `${letter.id}-${piece.id}` })))
          .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
        setRecent(scanned);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const pending = Math.max(0, (stats?.total || 0) - (stats?.parStatut?.archive || 0) - (stats?.parStatut?.traite || 0));
  const cards = [
    { label: 'Total', value: stats?.total ?? '—', href: '/archive', tone: 'total' },
    { label: 'Entrants', value: stats?.entrants ?? '—', href: '/archive?direction=entrant', tone: 'green' },
    { label: 'Sortants', value: stats?.sortants ?? '—', href: '/archive?direction=sortant', tone: 'purple' },
    { label: 'À traiter', value: loading ? '—' : pending, href: '/archive?bucket=pending', tone: 'amber' },
    { label: 'Urgents', value: stats?.urgentes ?? '—', href: '/archive?priorite=urgente', tone: 'red' },
  ];

  return (
    <div className="page dashboard-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Accueil</span><h1>Tableau de bord</h1></div>
      </header>
      <div className="stat-grid">
        {cards.map((card) => <Link key={card.label} to={card.href} className={'stat-card tone-' + card.tone} style={{ textDecoration: 'none' }}>
          <div className="stat-card-top"><div className="stat-label">{card.label}</div><span className="stat-arrow" aria-hidden="true">↗</span></div>
          <div className="stat-value">{loading ? '—' : card.value}</div>
        </Link>)}
      </div>
      <div className="card scan-card">
          <div className="card-head-row"><div className="scan-heading"><span className="scan-heading-icon" aria-hidden="true">▤</span><div><h2 className="card-title">Courriers numérisés cette semaine</h2><div className="muted">Les fichiers ajoutés depuis lundi</div></div></div><Link className="btn btn-secondary" to="/archive">Voir l’archive <span aria-hidden="true">→</span></Link></div>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap"><table className="table scan-table">
            <thead><tr><th>{t('letters.objet')}</th><th>Fichier numérisé</th><th>{t('letters.direction')}</th><th>Ajouté le</th></tr></thead>
            <tbody>{recent.map((l) => <tr key={l.scanKey} className="row-link" onClick={() => navigate('/lettres/' + l.id)}>
              <td><div className="letter-subject">{l.objet}</div></td><td><span className="file-pill">▤ {l.scannedFile}</span></td><td><span className={'direction-pill direction-' + (l.direction || 'entrant')}><i />{t('direction.' + (l.direction || 'entrant'))}</span></td><td className="date-cell">{fmtDate(l.scannedAt)}</td>
            </tr>)}{recent.length === 0 && <tr><td colSpan={4} className="empty-cell scan-empty">Aucun fichier numérisé cette semaine</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
