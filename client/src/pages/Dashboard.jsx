import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';
import CountUp from '../components/CountUp';

export default function Dashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canSeeTracking = user?.role === 'admin' || user?.role === 'supervisor' || Boolean(user?.permissions?.tracking);
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [openLetters, setOpenLetters] = useState([]);
  const [overdueLetters, setOverdueLetters] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.stats(), api.listLetters({ limit: 500, sort: 'date' }), api.committees()])
      .then(([summary, letters, committeesData]) => {
        if (cancelled) return;
        setStats(summary);
        setCommittees(committeesData.items || []);
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
        const scanned = (letters.items || []).flatMap((letter) => (letter.pieces || [])
          .filter((piece) => piece.hasFile && piece.uploadedAt && new Date(piece.uploadedAt) >= startOfWeek && new Date(piece.uploadedAt) <= now)
          .map((piece) => ({ ...letter, scannedFile: piece.nom, scannedAt: piece.uploadedAt, scanKey: `${letter.id}-${piece.id}` })))
          .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
        setRecent(scanned);
        const open = (letters.items || [])
          .filter((letter) => (letter.statut || 'recu') !== 'archive')
          .sort((a, b) => new Date(b.dateReception || b.dateEmission || b.createdAt) - new Date(a.dateReception || a.dateEmission || a.createdAt));
        setOpenLetters(open);
        const overdue = (letters.items || [])
          .filter((letter) => (letter.statut || 'recu') !== 'archive' && new Date(letter.dateReception || letter.dateEmission || letter.createdAt) < startOfWeek)
          .sort((a, b) => new Date(a.dateReception || a.dateEmission || a.createdAt) - new Date(b.dateReception || b.dateEmission || b.createdAt));
        setOverdueLetters(overdue);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const cards = [
    { label: 'Total', value: stats?.total ?? '—', href: '/archive', tone: 'total' },
    { label: 'Entrants', value: stats?.entrants ?? '—', href: '/archive?direction=entrant', tone: 'green' },
    { label: 'Sortants', value: stats?.sortants ?? '—', href: '/archive?direction=sortant', tone: 'purple' },
    { label: 'Archivés', value: loading ? '—' : (stats?.parStatut?.archive ?? 0), href: '/archive?statut=archive', tone: 'amber' },
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
          <div className="stat-value">{loading ? '—' : <CountUp value={card.value} />}</div>
        </Link>)}
      </div>
      <div className="season-summary" style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13, color: 'var(--muted)' }}>
        <span>{t('dashboard.receivedSeason')}: <strong style={{ color: 'var(--text)' }}>{loading ? '—' : (stats?.recusCetteSaison ?? 0)}</strong></span>
        <span>{t('dashboard.archivedSeason')}: <strong style={{ color: 'var(--text)' }}>{loading ? '—' : (stats?.archivesCetteSaison ?? 0)}</strong></span>
      </div>
      <div className="card open-letters-card">
        <div className="card-head-row"><div><h2 className="card-title">Courriers en cours</h2><div className="muted">{openLetters.length} courrier{openLetters.length === 1 ? '' : 's'} non archivé{openLetters.length === 1 ? '' : 's'}</div></div><Link className="btn btn-secondary" to="/archive?bucket=pending">Voir tout <span aria-hidden="true">→</span></Link></div>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap"><table className="table open-letters-table">
            <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>{t('letters.direction')}</th><th>Comité</th><th>Statut</th><th>{t('letters.priorite')}</th><th>{t('letters.date')}</th></tr></thead>
            <tbody>{openLetters.map((letter) => (
              <tr key={letter.id} className={'row-link' + (letter.unread ? ' row-unread' : '')} onClick={() => navigate('/lettres/' + letter.id)}>
                <td className="mono">{letter.numeroLettre || '—'}</td>
                <td><div className="letter-subject">{letter.unread && <span className="badge-new">Nouveau</span>}{letter.objet}</div>{letter.personneConcernee && <div className="letter-subline">{letter.personneConcernee}</div>}</td>
                <td><span className={'direction-pill direction-' + (letter.direction || 'entrant')}><i />{t('direction.' + (letter.direction || 'entrant'))}</span></td>
                <td><span className="committee-pill">{committees.find((c) => c.id === letter.commission)?.nom || 'Sans comité'}</span>{canSeeTracking && letter.commission && <span className={'seen-tick' + (letter.comiteVu ? ' seen' : ' unseen')} title={letter.comiteVu ? 'Le comité a ouvert ce courrier' : 'Le comité n’a pas encore ouvert ce courrier'}>{letter.comiteVu ? '✓' : '○'}</span>}</td>
                <td><span className={'badge statut-' + (letter.statut || 'recu')}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }}>{t('badge.transferred')}</span>}</td>
                <td><span className={'priority-pill priority-' + (letter.priorite || 'normale')}>{t('priorite.' + (letter.priorite || 'normale'))}</span></td>
                <td className="date-cell">{fmtDate(letter.dateReception || letter.dateEmission)}</td>
              </tr>
            ))}{openLetters.length === 0 && <tr><td colSpan={7} className="empty-cell">Aucun courrier en cours</td></tr>}</tbody>
          </table></div>
        )}
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
      <div className="card overdue-card">
        <div className="card-head-row"><div><h2 className="card-title">Courriers en retard (non archivés)</h2><div className="muted">{overdueLetters.length} courrier{overdueLetters.length === 1 ? '' : 's'} des semaines précédentes non clôturé{overdueLetters.length === 1 ? '' : 's'}</div></div><Link className="btn btn-secondary" to="/archive?bucket=pending">Voir tout <span aria-hidden="true">→</span></Link></div>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap"><table className="table overdue-table">
            <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>Comité</th><th>Statut</th><th>{t('letters.priorite')}</th><th>Depuis</th></tr></thead>
            <tbody>{overdueLetters.map((letter) => (
              <tr key={letter.id} className="row-link" onClick={() => navigate('/lettres/' + letter.id)}>
                <td className="mono">{letter.numeroLettre || '—'}</td>
                <td><div className="letter-subject">{letter.objet}</div></td>
                <td><span className="committee-pill">{committees.find((c) => c.id === letter.commission)?.nom || 'Sans comité'}</span></td>
                <td><span className={'badge statut-' + (letter.statut || 'recu')}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }}>{t('badge.transferred')}</span>}</td>
                <td><span className={'priority-pill priority-' + (letter.priorite || 'normale')}>{t('priorite.' + (letter.priorite || 'normale'))}</span></td>
                <td className="date-cell">{fmtDate(letter.dateReception || letter.dateEmission)}</td>
              </tr>
            ))}{overdueLetters.length === 0 && <tr><td colSpan={6} className="empty-cell">Aucun courrier en retard</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
