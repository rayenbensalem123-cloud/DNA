import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';

export default function Archive() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { committeeId } = useParams();
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', direction: '', statut: '', priorite: '', bucket: '' });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFilters({ q: params.get('q') || '', direction: params.get('direction') || '', statut: params.get('statut') || '', priorite: params.get('priorite') || '', bucket: params.get('bucket') || '' });
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
  const hasFilters = Boolean(filters.q || filters.direction || filters.statut || filters.priorite || filters.bucket);
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
          <div className="muted">{selectedCommittee ? 'Courriers de ce comité' : hasFilters ? 'Résultats filtrés depuis le tableau de bord' : 'Tous les courriers classés par comité'}</div>
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
            <select aria-label="Direction" value={filters.direction} onChange={(event) => set('direction', event.target.value)}>
              <option value="">Toutes les directions</option><option value="entrant">Entrant</option><option value="sortant">Sortant</option>
            </select>
            <select aria-label="Statut" value={filters.statut} onChange={(event) => set('statut', event.target.value)}>
              <option value="">Tous les statuts</option>
              {['recu', 'en_cours', 'archive'].map((status) => <option key={status} value={status}>{t('status.' + status)}</option>)}
            </select>
            <select aria-label="Importance" value={filters.priorite} onChange={(event) => set('priorite', event.target.value)}>
              <option value="">Toutes les importances</option><option value="normale">Normale</option><option value="urgente">Urgente</option><option value="confidentielle">Confidentielle</option>
            </select>
          </div>
          {loading ? <div className="card-pad">{t('common.loading')}</div> : (
            <div className="table-wrap"><table className="table archive-table">
              <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th>{!committeeId && <th>Comité</th>}<th>{t('letters.direction')}</th><th>{t('letters.statut')}</th><th>{t('letters.priorite')}</th><th>{t('letters.date')}</th></tr></thead>
              <tbody>{items.map((letter) => (
                <tr key={letter.id} className={'row-link' + (letter.unread ? ' row-unread' : '')} onClick={() => navigate('/lettres/' + letter.id)}>
                  <td className="mono">{letter.numeroLettre || '—'}</td>
                  <td><div className="letter-subject">{letter.unread && <span className="badge-new">Nouveau</span>}{letter.objet}</div>{letter.personneConcernee && <div className="letter-subline">{letter.personneConcernee}</div>}</td>
                  {!committeeId && <td><span className="committee-pill">{committees.find((committee) => committee.id === letter.commission)?.nom || 'Sans comité'}</span></td>}
                  <td><span className={'direction-pill direction-' + (letter.direction || 'entrant')}><i />{t('direction.' + (letter.direction || 'entrant'))}</span></td>
                  <td><span className={'badge statut-' + letter.statut}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.commissionHisto || []).some((h) => h.type === 'transfert') && <span className="badge badge-transfert" style={{ marginLeft: 6 }}>{t('badge.transferred')}</span>}</td>
                  <td><span className={'priority-pill priority-' + (letter.priorite || 'normale')}>{t('priorite.' + (letter.priorite || 'normale'))}</span></td>
                  <td className="date-cell">{fmtDate(letter.dateReception || letter.dateEmission)}</td>
                </tr>
              ))}{items.length === 0 && <tr><td colSpan={committeeId ? 6 : 7} className="empty-cell">{t('letters.empty')}</td></tr>}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
