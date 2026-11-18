import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, transferChain } from '../utils';
import CountUp from '../components/CountUp';

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

function monthKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export default function Dashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canSeeTracking = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf' || Boolean(user?.permissions?.tracking);
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [letters, setLetters] = useState([]);
  const [recent, setRecent] = useState([]);
  const [openLetters, setOpenLetters] = useState([]);
  const [overdueLetters, setOverdueLetters] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.stats(), api.listLetters({ limit: 500, sort: 'date' }), api.committees()])
      .then(([summary, lettersData, committeesData]) => {
        if (cancelled) return;
        setStats(summary);
        setCommittees(committeesData.items || []);
        const items = lettersData.items || [];
        setLetters(items);
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
        const scanned = items.flatMap((letter) => (letter.pieces || [])
          .filter((piece) => piece.hasFile && piece.uploadedAt && new Date(piece.uploadedAt) >= startOfWeek && new Date(piece.uploadedAt) <= now)
          .map((piece) => ({ ...letter, scannedFile: piece.nom, scannedAt: piece.uploadedAt, scanKey: `${letter.id}-${piece.id}` })))
          .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
        setRecent(scanned);
        const open = items
          .filter((letter) => (letter.statut || 'recu') !== 'archive')
          .sort((a, b) => new Date(b.dateReception || b.dateEmission || b.createdAt) - new Date(a.dateReception || a.dateEmission || a.createdAt));
        setOpenLetters(open);
        const overdue = items
          .filter((letter) => (letter.statut || 'recu') !== 'archive' && new Date(letter.dateReception || letter.dateEmission || letter.createdAt) < startOfWeek)
          .sort((a, b) => new Date(a.dateReception || a.dateEmission || a.createdAt) - new Date(b.dateReception || b.dateEmission || b.createdAt));
        setOverdueLetters(overdue);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ---- Metrics computed from the letters list -------------------------------
  const total = letters.length;
  const entrants = letters.filter((l) => (l.direction || 'entrant') === 'entrant').length;
  const sortants = letters.filter((l) => l.direction === 'sortant').length;
  const enCours = letters.filter((l) => l.statut === 'en_cours').length;
  const aAffecter = letters.filter((l) => !l.commission && (l.statut || 'recu') !== 'archive' && l.direction !== 'sortant').length;
  const urgentsNonClotures = letters.filter((l) => l.priorite === 'urgente' && l.statut !== 'archive').length;
  const fifteenDaysAgo = Date.now() - 15 * 24 * 3600 * 1000;
  const enRetard = letters.filter((l) => l.statut !== 'archive' && new Date(l.dateReception || l.dateEmission || l.createdAt).getTime() < fifteenDaysAgo).length;
  const archives = letters.filter((l) => l.statut === 'archive').length;
  const tauxCloture = total ? Math.round((archives / total) * 100) : 0;
  const traitementDays = (() => {
    const done = letters.filter((l) => l.statut === 'archive');
    if (!done.length) return null;
    const sum = done.reduce((acc, l) => {
      const start = new Date(l.dateEmission || l.createdAt).getTime();
      const end = new Date(l.updatedAt || l.createdAt).getTime();
      return acc + (Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, (end - start) / 86400000));
    }, 0);
    return Math.round((sum / done.length) * 10) / 10;
  })();

  const cards = [
    { label: 'Courriers enregistrés', value: total, href: '/archive', tone: 'blue' },
    { label: 'Arrivée', value: entrants, href: '/archive?direction=entrant', tone: 'green' },
    { label: 'Départ', value: sortants, href: '/archive?direction=sortant', tone: 'purple' },
    { label: 'En traitement', value: enCours, href: '/archive?statut=en_cours', tone: 'amber' },
    { label: 'À affecter', value: aAffecter, href: '/archive?commission=non_assigne', tone: 'cyan' },
    { label: 'Urgents non clôturés', value: urgentsNonClotures, href: '/archive?priorite=urgente', tone: 'red' },
    { label: 'En retard > 15 j', value: enRetard, href: '/archive?bucket=overdue', tone: 'orange' },
    { label: 'Taux de clôture', value: `${loading ? '—' : tauxCloture}%`, href: '/archive?statut=archive', tone: 'teal', raw: true },
    { label: 'Jours de traitement moy.', value: traitementDays === null ? '—' : traitementDays, href: '/archive?statut=archive', tone: 'gray', raw: true },
  ];

  // Répartition par état
  const repartition = [
    { key: 'recu', label: t('status.recu'), count: letters.filter((l) => (l.statut || 'recu') === 'recu').length, color: '#3b82f6' },
    { key: 'en_cours', label: t('status.en_cours'), count: enCours, color: '#f59e0b' },
    { key: 'archive', label: t('status.archive'), count: archives, color: '#10b981' },
  ];
  const repMax = Math.max(1, ...repartition.map((r) => r.count));
  // Par caractère
  const urgents = letters.filter((l) => l.priorite === 'urgente').length;
  const normaux = total - urgents;
  const parCarMax = Math.max(1, urgents, normaux);

  // Courriers par mois (last 12 months): arrivée / départ series
  const monthly = (() => {
    const now = new Date();
    const buckets = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS_FR[d.getMonth()], arrivee: 0, depart: 0 });
    }
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    for (const l of letters) {
      const kArr = monthKey(l.dateReception || l.createdAt);
      if (l.direction !== 'sortant' && byKey[kArr]) byKey[kArr].arrivee += 1;
      const kDep = monthKey(l.dateEmission || l.createdAt);
      if (l.direction === 'sortant' && byKey[kDep]) byKey[kDep].depart += 1;
    }
    return buckets;
  })();
  const monthMax = Math.max(1, ...monthly.map((m) => Math.max(m.arrivee, m.depart)));
  const CHART_W = 720; const CHART_H = 200; const GROUP_W = CHART_W / 12;
  const barW = 11; const barGap = 5;

  return (
    <div className="page dashboard-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Accueil</span><h1>Tableau de bord</h1></div>
        <div className="season-summary">
          <span>{t('dashboard.receivedSeason')}: <strong>{loading ? '—' : (stats?.recusCetteSaison ?? 0)}</strong></span>
          <span>{t('dashboard.archivedSeason')}: <strong>{loading ? '—' : (stats?.archivesCetteSaison ?? 0)}</strong></span>
        </div>
      </header>

      <div className="dash-cards">
        {cards.map((card, i) => (
          <Link key={card.label} to={card.href} className={'dash-card tone-' + card.tone} style={{ '--i': i }}>
            <div className="dash-card-label">{card.label}</div>
            <div className="dash-card-value">{loading ? '—' : (card.raw ? card.value : <CountUp value={card.value} />)}</div>
          </Link>
        ))}
      </div>

      <div className="dash-panels">
        <div className="card dash-panel">
          <h2 className="card-title">Répartition par état</h2>
          <div className="dash-bars">
            {repartition.map((r) => (
              <div key={r.key} className="dash-bar-row">
                <span className="dash-bar-label">{r.label}</span>
                <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${Math.round((r.count / repMax) * 100)}%`, background: r.color }} /></div>
                <span className="dash-bar-count">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card dash-panel">
          <h2 className="card-title">Par caractère</h2>
          <div className="dash-bars">
            <div className="dash-bar-row">
              <span className="dash-bar-label">Urgent</span>
              <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${Math.round((urgents / parCarMax) * 100)}%`, background: '#ef4444' }} /></div>
              <span className="dash-bar-count">{urgents}</span>
            </div>
            <div className="dash-bar-row">
              <span className="dash-bar-label">Normal</span>
              <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${Math.round((normaux / parCarMax) * 100)}%`, background: '#64748b' }} /></div>
              <span className="dash-bar-count">{normaux}</span>
            </div>
          </div>
        </div>
        <div className="card dash-panel dash-panel-wide">
          <h2 className="card-title">Courriers par mois</h2>
          <div className="dash-legend">
            <span className="dash-legend-item"><i style={{ background: '#e6001b' }} /> Arrivée</span>
            <span className="dash-legend-item"><i style={{ background: '#1e293b' }} /> Départ</span>
          </div>
          <svg className="dash-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="Courriers par mois">
            {[0, 1, 2, 3, 4].map((g) => (
              <line key={g} x1={0} x2={CHART_W} y1={20 + g * 40} y2={20 + g * 40} stroke="var(--dash-grid)" strokeWidth="1" />
            ))}
            {monthly.map((m, i) => {
              const x = i * GROUP_W + GROUP_W / 2;
              const ha = Math.round((m.arrivee / monthMax) * 150);
              const hd = Math.round((m.depart / monthMax) * 150);
              return (
                <g key={m.key}>
                  <rect x={x - barW - barGap / 2} y={180 - ha} width={barW} height={ha} rx="3" fill="#e6001b"><title>{`${m.label} — Arrivée: ${m.arrivee}`}</title></rect>
                  <rect x={x + barGap / 2} y={180 - hd} width={barW} height={hd} rx="3" fill="#1e293b"><title>{`${m.label} — Départ: ${m.depart}`}</title></rect>
                  <text x={x} y={196} textAnchor="middle" className="dash-chart-month">{m.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
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
                <td><span className={'badge statut-' + (letter.statut || 'recu')}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }} title={canSeeTracking && transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) ? 'Parcours : ' + transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) : undefined}>{t('badge.transferred')}</span>}{letter.overdue && <span className="badge badge-overdue" style={{ marginLeft: 6 }} title="Non archivé depuis plus de 15 jours">⚠ Retard</span>}</td>
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
                <td><span className={'badge statut-' + (letter.statut || 'recu')}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }} title={canSeeTracking && transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) ? 'Parcours : ' + transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) : undefined}>{t('badge.transferred')}</span>}{letter.overdue && <span className="badge badge-overdue" style={{ marginLeft: 6 }} title="Non archivé depuis plus de 15 jours">⚠ Retard</span>}</td>
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
