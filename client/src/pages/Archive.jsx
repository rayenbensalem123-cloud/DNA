import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';
import Select from '../components/Select';

export default function Archive() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // Only the bureau d'ordre (admin + supervisor) may see the tracking history
  // and the "seen by comité" tick.
  const canSeeTracking = user?.role === 'admin' || user?.role === 'supervisor';
  const navigate = useNavigate();
  const location = useLocation();
  const { committeeId } = useParams();
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', direction: '', statut: '', priorite: '', bucket: '', from: '', to: '', expediteur: '', commission: '' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFilters({ q: params.get('q') || '', direction: params.get('direction') || '', statut: params.get('statut') || '', priorite: params.get('priorite') || '', bucket: params.get('bucket') || '', from: params.get('from') || '', to: params.get('to') || '', expediteur: params.get('expediteur') || '', commission: params.get('commission') || '' });
  }, [location.search]);

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => { api.listLetters({ limit: 500, sort: 'date' }).then((d) => setAllItems(d.items || [])).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { bucket, ...apiFilters } = filters;
    const params = { limit: 500, sort: 'date', ...apiFilters };
    if (committeeId === 'non-assigne') params.commission = 'non_assigne';
    else if (committeeId) params.commission = committeeId;
    Object.keys(params).forEach((key) => { if (params[key] === '') delete params[key]; });
    api.listLetters(params)
      .then((d) => {
        if (cancelled) return;
        const matched = bucket === 'pending'
          ? (d.items || []).filter((letter) => (letter.statut || 'recu') !== 'archive')
          : (d.items || []);
        setItems(matched);
        setTotal(bucket ? matched.length : d.total || 0);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [committeeId, filters]);

  const committeeCounts = useMemo(() => {
    const counts = {};
    allItems.forEach((letter) => { const key = letter.commission || 'non_assigne'; counts[key] = (counts[key] || 0) + 1; });
    return counts;
  }, [allItems]);
  const selectedCommittee = committeeId === 'non-assigne'
    ? { id: 'non-assigne', nom: 'Sans comité' }
    : committees.find((committee) => committee.id === committeeId);
  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const hasFilters = Boolean(filters.q || filters.direction || filters.statut || filters.priorite || filters.bucket || filters.from || filters.to || filters.expediteur || filters.commission);
  const [showMore, setShowMore] = useState(false);
  const advancedCount = [filters.from, filters.to, filters.expediteur, filters.commission].filter(Boolean).length;
  const resetFilters = () => setFilters({ q: '', direction: '', statut: '', priorite: '', bucket: '', from: '', to: '', expediteur: '', commission: '' });
  const listTitle = filters.bucket === 'pending' ? 'Courriers à traiter'
    : filters.direction === 'entrant' ? 'Courriers entrants'
      : filters.direction === 'sortant' ? 'Courriers sortants'
        : filters.priorite === 'urgente' ? 'Courriers urgents'
          : filters.statut ? `Courriers — ${t('status.' + filters.statut)}` : 'Tous les courriers';

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-copy">
          <span className="page-title-kicker">{selectedCommittee ? 'Archive · Comité' : hasFilters ? 'Archive · Résultats' : 'Registre officiel'}</span>
          <h1>{selectedCommittee ? selectedCommittee.nom : 'Archive'}</h1>
          <div className="muted">{selectedCommittee ? 'Courriers de ce comité' : hasFilters ? 'Résultats de votre recherche' : 'Tous les courriers classés par comité'}</div>
        </div>
        {(selectedCommittee || hasFilters) && <button className="btn btn-secondary" onClick={() => navigate('/archive')}>← Tous les courriers</button>}
      </div>

      {!committeeId && !hasFilters && (
        <section className="committee-grid" aria-label="Comités">
          {committees.map((committee) => (
            <button type="button" className="card committee-card" key={committee.id} onClick={() => navigate(`/archive/comites/${encodeURIComponent(committee.id)}`)}>
              <span className="committee-card-name">{committee.nom}</span>
              <span className="committee-card-count">{committeeCounts[committee.id] || 0} courrier{committeeCounts[committee.id] === 1 ? '' : 's'}</span>
              <span className="committee-card-open">Ouvrir l’archive →</span>
            </button>
          ))}
          <button type="button" className="card committee-card" onClick={() => navigate('/archive/comites/non-assigne')}>
            <span className="committee-card-name">Sans comité</span>
            <span className="committee-card-count">{committeeCounts.non_assigne || 0} courrier{committeeCounts.non_assigne === 1 ? '' : 's'}</span>
            <span className="committee-card-open">Ouvrir l’archive →</span>
          </button>
        </section>
      )}

      {committeeId && !selectedCommittee ? <div className="card card-pad">Comité introuvable.</div> : (
        <div className="card archive-list-card">
          <div className="archive-list-heading">
            <h2 className="card-title">{selectedCommittee ? `Courriers — ${selectedCommittee.nom}` : listTitle}</h2>
            <span className="muted">{total} au total</span>
          </div>
          <div className="filters">
            <input aria-label="Rechercher dans l’archive" placeholder={t('letters.searchPlaceholder')} value={filters.q} onChange={(event) => set('q', event.target.value)} />
            <Select ariaLabel="Direction" value={filters.direction} onChange={(v) => set('direction', v)} options={[{ value: '', label: 'Toutes les directions' }, { value: 'entrant', label: 'Entrant' }, { value: 'sortant', label: 'Sortant' }]} />
            <Select ariaLabel="Statut" value={filters.statut} onChange={(v) => set('statut', v)} options={[{ value: '', label: 'Tous les statuts' }, ...['recu', 'en_cours', 'archive'].map((status) => ({ value: status, label: t('status.' + status) }))]} />
            <Select ariaLabel="Importance" value={filters.priorite} onChange={(v) => set('priorite', v)} options={[{ value: '', label: 'Toutes les importances' }, { value: 'normale', label: 'Normale' }, { value: 'urgente', label: 'Urgente' }, { value: 'confidentielle', label: 'Confidentielle' }]} />
            <button type="button" className="btn btn-secondary" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>Plus de filtres{advancedCount ? ` (${advancedCount})` : ''}</button>
            {hasFilters && <button type="button" className="btn btn-ghost" onClick={resetFilters}>Réinitialiser</button>}
          </div>
          {(showMore || advancedCount > 0) && <div className="filters filters-more">
            <label className="filter-field"><span>Du</span><input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set('from', event.target.value)} /></label>
            <label className="filter-field"><span>Au</span><input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set('to', event.target.value)} /></label>
            <label className="filter-field"><span>Expéditeur</span><input placeholder="Nom, fonction, service…" value={filters.expediteur} onChange={(event) => set('expediteur', event.target.value)} /></label>
            {!committeeId && <label className="filter-field"><span>Comité</span><Select ariaLabel="Comité" value={filters.commission} onChange={(v) => set('commission', v)} options={[{ value: '', label: 'Tous les comités' }, ...committees.map((committee) => ({ value: committee.id, label: committee.nom })), { value: 'non_assigne', label: 'Sans comité' }]} /></label>}
          </div>}
          {loading ? <div className="card-pad">{t('common.loading')}</div> : (
            <div className="table-wrap"><table className="table archive-table">
              <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th>{!committeeId && <th>Comité</th>}{canSeeTracking && <th>Vu</th>}<th>{t('letters.direction')}</th><th>{t('letters.statut')}</th><th>{t('letters.priorite')}</th><th>{t('letters.date')}</th></tr></thead>
              <tbody>{items.map((letter) => (
                <tr key={letter.id} className={'row-link' + (letter.unread ? ' row-unread' : '')} onClick={() => navigate('/lettres/' + letter.id)}>
                  <td className="mono">{letter.numeroLettre || '—'}</td>
                  <td><div className="letter-subject">{letter.unread && <span className="badge-new">Nouveau</span>}{letter.objet}</div>{letter.personneConcernee && <div className="letter-subline">{letter.personneConcernee}</div>}</td>
                  {!committeeId && <td><span className="committee-pill">{committees.find((committee) => committee.id === letter.commission)?.nom || 'Sans comité'}</span></td>}
                  {canSeeTracking && <td><span className={'seen-tick' + (letter.commission ? (letter.comiteVu ? ' seen' : ' unseen') : ' none')} title={letter.commission ? (letter.comiteVu ? 'Le comité a ouvert ce courrier' : 'Le comité n’a pas encore ouvert ce courrier') : 'Aucun comité assigné'}>{letter.commission ? (letter.comiteVu ? '✓ Vu' : '✓ Pas vu') : '—'}</span></td>}
                  <td><span className={'direction-pill direction-' + (letter.direction || 'entrant')}><i />{t('direction.' + (letter.direction || 'entrant'))}</span></td>
                  <td><span className={'badge statut-' + letter.statut}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }}>{t('badge.transferred')}</span>}</td>
                  <td><span className={'priority-pill priority-' + (letter.priorite || 'normale')}>{t('priorite.' + (letter.priorite || 'normale'))}</span></td>
                  <td className="date-cell">{fmtDate(letter.dateReception || letter.dateEmission)}</td>
                </tr>
              ))}{items.length === 0 && <tr><td colSpan={7 + (canSeeTracking ? 1 : 0)} className="empty-cell">{t('letters.empty')}</td></tr>}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
