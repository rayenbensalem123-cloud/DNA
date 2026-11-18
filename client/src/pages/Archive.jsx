import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, transferChain } from '../utils';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';

export default function Archive() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // Only the bureau d'ordre (admin + supervisor + daf) may see the tracking history
  // and the "seen by comité" tick — unless the admin granted the permission.
  const canSeeTracking = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf' || Boolean(user?.permissions?.tracking);
  const navigate = useNavigate();
  const location = useLocation();
  const { committeeId } = useParams();
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', direction: '', statut: '', priorite: '', bucket: '', from: '', to: '', expediteur: '', commission: '' });
  const [transferQueue, setTransferQueue] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFilters({ q: params.get('q') || '', direction: params.get('direction') || '', statut: params.get('statut') || '', priorite: params.get('priorite') || '', bucket: params.get('bucket') || '', from: params.get('from') || '', to: params.get('to') || '', expediteur: params.get('expediteur') || '', commission: params.get('commission') || '' });
  }, [location.search]);

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => { api.listLetters({ limit: 500, sort: 'date' }).then((d) => setAllItems(d.items || [])).catch(() => {}); }, []);

  // Transfer requests waiting for bureau approval (admin/supervisor only).
  const loadTransferQueue = () => { if (canSeeTracking) api.transferRequests().then((d) => setTransferQueue(d.items || [])).catch(() => {}); };
  useEffect(loadTransferQueue, []);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAction, setBatchAction] = useState('');
  const [batchCommittee, setBatchCommittee] = useState('');

  const toggleSelect = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? new Set(items.map((l) => l.id)) : new Set());
  };
  const isSelected = (id) => selectedIds.has(id);
  const hasSelection = selectedIds.size > 0;
  const selectedItems = items.filter((l) => selectedIds.has(l.id));

  const executeBatchAction = async (action) => {
    try {
      if (action === 'archive') {
        for (const l of selectedItems) {
          if (l.statut === 'archive') continue;
          await api.updateLetter(l.id, { statut: 'archive' });
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' archivé' + (selectedItems.length > 1 ? 's' : ''));
      } else if (action === 'committee') {
        if (!batchCommittee) { setError('Sélectionnez un comité de destination'); return; }
        for (const l of selectedItems) {
          await api.updateLetter(l.id, { commission: batchCommittee });
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' transféré' + (selectedItems.length > 1 ? 's' : '') + ' vers ' + committees.find((c) => c.id === batchCommittee)?.nom);
      } else if (action === 'delete') {
        for (const l of selectedItems) {
          await api.deleteLetter(l.id);
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' supprimé' + (selectedItems.length > 1 ? 's' : ''));
      } else if (action === 'export-csv' || action === 'export-xlsx' || action === 'export-pdf') {
        const rows = selectedItems.map((l) => {
          const row = {
            numeroLettre: l.numeroLettre || l.ref || '',
            objet: l.objet || '',
            direction: l.direction === 'sortant' ? 'Sortant' : 'Entrant',
            statut: t('status.' + (l.statut || 'recu')),
            priorite: l.priorite === 'urgente' ? 'Urgente' : l.priorite === 'confidentielle' ? 'Confidentielle' : 'Normale',
            expediteur: l.expediteur?.nom || '',
            date: fmtDate(l.dateReception || l.dateEmission),
          };
          if (!committeeId) row.commission = committees.find((c) => c.id === l.commission)?.nom || 'Sans comité';
          return row;
        });
        const headers = [
          { key: 'numeroLettre', label: 'N° courrier' },
          { key: 'objet', label: 'Objet' },
          { key: 'direction', label: 'Direction' },
          { key: 'statut', label: 'Statut' },
          { key: 'priorite', label: 'Priorité' },
          { key: 'expediteur', label: 'Expéditeur' },
          { key: 'date', label: 'Date' },
        ];
        if (!committeeId) headers.splice(2, 0, { key: 'commission', label: 'Comit\u00e9' });
        const name = 'archive-selection';
        if (action === 'export-csv') downloadCsv(name, headers, rows);
        else if (action === 'export-xlsx') await downloadXlsx(name, headers, rows);
        else printPdf({ title: 'Archive — Sélection', subtitle: selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : ''), headers, rows, meta: { by: user?.name } });
      }
      setSelectedIds(new Set());
      setBatchOpen(false);
      setBatchAction('');
      setBatchCommittee('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const decideTransfer = async (letterId, action) => {
    try {
      const d = await api.transferApproval(letterId, action);
      setTransferQueue((current) => current.filter((x) => x.letterId !== letterId));
      setAllItems((current) => current.map((l) => (l.id === letterId ? (d.item || l) : l)));
    } catch { /* the queue reloads on the next visit */ }
  };

  const committeeName = (id) => committees.find((c) => c.id === id)?.nom || 'Sans comité';

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
        const fifteenDaysAgo = Date.now() - 15 * 24 * 3600 * 1000;
        const matched = bucket === 'overdue'
          ? (d.items || []).filter((letter) => (letter.statut || 'recu') !== 'archive' && new Date(letter.dateReception || letter.dateEmission || letter.createdAt).getTime() < fifteenDaysAgo)
          : bucket === 'pending'
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
  const listTitle = filters.bucket === 'overdue' ? 'Courriers en retard (> 15 j)'
    : filters.bucket === 'pending' ? 'Courriers à traiter'
      : filters.direction === 'entrant' ? 'Courriers entrants'
        : filters.direction === 'sortant' ? 'Courriers sortants'
          : filters.priorite === 'urgente' ? 'Courriers urgents'
            : filters.statut ? `Courriers — ${t('status.' + filters.statut)}` : 'Tous les courriers';

  const exportHeaders = [
    { key: 'numeroLettre', label: 'N° courrier' },
    { key: 'objet', label: 'Objet' },
    ...(committeeId ? [] : [{ key: 'commission', label: 'Comité' }]),
    { key: 'direction', label: 'Direction' },
    { key: 'statut', label: 'Statut' },
    { key: 'priorite', label: 'Priorité' },
    { key: 'expediteur', label: 'Expéditeur' },
    { key: 'date', label: 'Date' },
  ];
  const exportRows = items.map((l) => ({
    numeroLettre: l.numeroLettre || l.ref || '',
    objet: l.objet || '',
    commission: committeeId ? '' : (committees.find((c) => c.id === l.commission)?.nom || 'Sans comité'),
    direction: l.direction === 'sortant' ? 'Sortant' : 'Entrant',
    statut: t('status.' + (l.statut || 'recu')),
    priorite: l.priorite === 'urgente' ? 'Urgente' : l.priorite === 'confidentielle' ? 'Confidentielle' : 'Normale',
    expediteur: l.expediteur?.nom || '',
    date: fmtDate(l.dateReception || l.dateEmission),
  }));
  const exportName = selectedCommittee ? `archive-${selectedCommittee.nom.replace(/[^\w-]+/g, '_')}` : 'archive-courriers';
  const exportSubtitle = [listTitle, filters.from && `du ${filters.from}`, filters.to && `au ${filters.to}`].filter(Boolean).join(' ');

  const doExport = async (format) => {
    try {
      if (format === 'csv') downloadCsv(exportName, exportHeaders, exportRows);
      else if (format === 'xlsx') await downloadXlsx(exportName, exportHeaders, exportRows);
      else printPdf({ title: selectedCommittee ? `Archive — ${selectedCommittee.nom}` : 'Archive des courriers', subtitle: exportSubtitle, headers: exportHeaders, rows: exportRows, meta: { by: user?.name } });
    } catch { /* export failures are non-critical */ }
  };

  return (
    <div className="page">
      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="page-header">
        <div className="page-title-copy">
          <span className="page-title-kicker">{selectedCommittee ? 'Archive · Comité' : hasFilters ? 'Archive · Résultats' : 'Registre officiel'}</span>
          <h1>{selectedCommittee ? selectedCommittee.nom : 'Archive'}</h1>
          <div className="muted">{selectedCommittee ? 'Courriers de ce comité' : hasFilters ? 'Résultats de votre recherche' : 'Tous les courriers classés par comité'}</div>
        </div>
        {(selectedCommittee || hasFilters) && <button className="btn btn-secondary" onClick={() => navigate('/archive')}>← Tous les courriers</button>}
      </div>

      {canSeeTracking && transferQueue.length > 0 && (
        <div className="card transfer-queue-card">
          <div className="transfer-queue-heading">
            <h2 className="card-title">Demandes de transfert <span className="transfer-queue-count">{transferQueue.length}</span></h2>
            <span className="muted">Un comité a demandé de transférer un courrier — à vous de décider</span>
          </div>
          <div className="transfer-queue-list">
            {transferQueue.map((req) => (
              <div className="transfer-queue-row" key={req.letterId}>
                <div className="transfer-queue-main">
                  <button type="button" className="transfer-queue-ref" onClick={() => navigate('/lettres/' + req.letterId)}>{req.ref}</button>
                  <span className="transfer-queue-objet">{req.objet || '—'}</span>
                </div>
                <div className="transfer-queue-path">
                  <span className="committee-pill">{committeeName(req.from)}</span>
                  <span className="transfer-queue-arrow">→</span>
                  <span className="committee-pill">{committeeName(req.to)}</span>
                </div>
                <div className="transfer-queue-meta">
                  <span>Demandé par <strong>{req.requestedByName || '—'}</strong></span>
                  <span>· {fmtDate(req.requestedAt)}</span>
                </div>
                {req.note && <div className="transfer-queue-note">« {req.note} »</div>}
                <div className="transfer-queue-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => decideTransfer(req.letterId, 'approve')}>Approuver</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decideTransfer(req.letterId, 'reject')}>Refuser</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!committeeId && !hasFilters && (
        <section className="committee-grid" aria-label="Comités">
          {committees.map((committee) => (
            <div className="committee-card-wrap" key={committee.id}>
              <button type="button" className="card committee-card" onClick={() => navigate(`/archive/comites/${encodeURIComponent(committee.id)}`)}>
                <span className="committee-card-name">{committee.nom}</span>
                <span className="committee-card-count">{committeeCounts[committee.id] || 0} courrier{committeeCounts[committee.id] === 1 ? '' : 's'}</span>
                <span className="committee-card-open">Ouvrir l’archive →</span>
              </button>
              {canSeeTracking && <button type="button" className="committee-registre-link" onClick={() => navigate(`/registres/${encodeURIComponent(committee.id)}`)} title="Registre arrivée / départ du comité">▤ Registre du comité</button>}
            </div>
          ))}
          <div className="committee-card-wrap">
            <button type="button" className="card committee-card" onClick={() => navigate('/archive/comites/non-assigne')}>
              <span className="committee-card-name">Sans comité</span>
              <span className="committee-card-count">{committeeCounts.non_assigne || 0} courrier{committeeCounts.non_assigne === 1 ? '' : 's'}</span>
              <span className="committee-card-open">Ouvrir l’archive →</span>
            </button>
          </div>
        </section>
      )}

      {committeeId && !selectedCommittee ? <div className="card card-pad">Comité introuvable.</div> : (
        <div className="card archive-list-card">
          <div className="archive-list-heading">
            <h2 className="card-title">{selectedCommittee ? `Courriers — ${selectedCommittee.nom}` : listTitle}</h2>
            {hasSelection && (
              <div className="batch-bar">
                <span className="muted">{selectedIds.size} courrier{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleSelectAll(false)}>Tout désélectionner</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('archive'); setBatchOpen(true); }}>Archiver la sélection</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('committee'); setBatchOpen(true); }}>Changer de comité</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => { setBatchAction('delete'); setBatchOpen(true); }}>Supprimer la sélection</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-csv'); setBatchOpen(true); }}>Exporter CSV</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-xlsx'); setBatchOpen(true); }}>Exporter Excel</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-pdf'); setBatchOpen(true); }}>Exporter PDF</button>
              </div>
            )}
            {!hasSelection && (
              <div className="archive-heading-right">
                <span className="muted">{total} au total</span>
                <div className="export-group" role="group" aria-label="Exporter">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('csv')} title="Exporter en CSV (Excel)">CSV</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('xlsx')} title="Exporter en Excel (.xlsx)">Excel</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('pdf')} title="Imprimer / PDF">PDF</button>
                </div>
              </div>
            )}
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
            <label className="filter-field"><span>Du</span><DatePicker value={filters.from} max={filters.to || undefined} onChange={(v) => set('from', v)} placeholder="jj/mm/aaaa" /></label>
            <label className="filter-field"><span>Au</span><DatePicker value={filters.to} min={filters.from || undefined} onChange={(v) => set('to', v)} placeholder="jj/mm/aaaa" /></label>
            <label className="filter-field"><span>Expéditeur</span><input placeholder="Nom, fonction, service…" value={filters.expediteur} onChange={(event) => set('expediteur', event.target.value)} /></label>
            {!committeeId && <label className="filter-field"><span>Comité</span><Select ariaLabel="Comité" value={filters.commission} onChange={(v) => set('commission', v)} options={[{ value: '', label: 'Tous les comités' }, ...committees.map((committee) => ({ value: committee.id, label: committee.nom })), { value: 'non_assigne', label: 'Sans comité' }]} /></label>}
          </div>}
          {loading ? <div className="card-pad">{t('common.loading')}</div> : (
            <div className="table-wrap"><table className="table archive-table">
              <thead><tr><th style={{ width: '44px' }}><input type="checkbox" checked={items.length > 0 && selectedIds.size === items.length} onChange={(e) => toggleSelectAll(e.target.checked)} /></th><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th>{!committeeId && <th>Comité</th>}{canSeeTracking && <th>Vu</th>}<th>{t('letters.direction')}</th><th>{t('letters.statut')}</th><th>{t('letters.priorite')}</th><th>{t('letters.date')}</th></tr></thead>
              <tbody>{items.map((letter) => (
                <tr key={letter.id} className={'row-link' + (letter.unread ? ' row-unread' : '') + (isSelected(letter.id) ? ' row-selected' : '')} onClick={() => { if (isSelected(letter.id)) toggleSelect(letter.id, false); else navigate('/lettres/' + letter.id); }}>
                  <td style={{ width: '44px' }}><input type="checkbox" checked={isSelected(letter.id)} onChange={(e) => toggleSelect(letter.id, e.target.checked)} /></td>
                  <td className="mono">{letter.numeroLettre || '—'}</td>
                  <td><div className="letter-subject">{letter.unread && <span className="badge-new">Nouveau</span>}{letter.objet}</div>{letter.personneConcernee && <div className="letter-subline">{letter.personneConcernee}</div>}</td>
                  {!committeeId && <td><span className="committee-pill">{committees.find((committee) => committee.id === letter.commission)?.nom || 'Sans comité'}</span></td>}
                  {canSeeTracking && <td><span className={'seen-tick' + (letter.commission ? (letter.comiteVu ? ' seen' : ' unseen') : ' none')} title={letter.commission ? (letter.comiteVu ? 'Le comité a ouvert ce courrier' : 'Le comité n’a pas encore ouvert ce courrier') : 'Aucun comité assigné'}>{letter.commission ? (letter.comiteVu ? '✓ Vu' : '✓ Pas vu') : '—'}</span></td>}
                  <td><span className={'direction-pill direction-' + (letter.direction || 'entrant')}><i />{t('direction.' + (letter.direction || 'entrant'))}</span></td>
                  <td><span className={'badge statut-' + letter.statut}>{t('status.' + (letter.statut || 'recu'))}</span>{(letter.transferred || (letter.commissionHisto || []).some((h) => h.type === 'transfert')) && <span className="badge badge-transfert" style={{ marginLeft: 6 }} title={canSeeTracking && transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) ? 'Parcours : ' + transferChain(letter, (cid) => committees.find((c) => c.id === cid)?.nom || cid) : t('badge.transferred')}>{t('badge.transferred')}</span>}{letter.overdue && <span className="badge badge-overdue" style={{ marginLeft: 6 }} title="Non archivé depuis plus de 15 jours">⚠ Retard</span>}</td>
                  <td><span className={'priority-pill priority-' + (letter.priorite || 'normale')}>{t('priorite.' + (letter.priorite || 'normale'))}</span></td>
                  <td className="date-cell">{fmtDate(letter.dateReception || letter.dateEmission)}</td>
                </tr>
              ))}{items.length === 0 && <tr><td colSpan={8 + (canSeeTracking ? 1 : 0)} className="empty-cell">{t('letters.empty')}</td></tr>}</tbody>
            </table></div>
          )}
        </div>
      )}
      {batchOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setBatchOpen(false); setBatchCommittee(''); } }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Confirmer l'action en lot</h2><button type="button" className="modal-close" onClick={() => { setBatchOpen(false); setBatchCommittee(''); }}>x</button></header>
            <div className="modal-body">
              <p className="muted">{selectedIds.size} courrier{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}. Choisissez l'action :</p>
              {batchAction === 'committee' && (
                <label className="field">Comité de destination
                  <Select ariaLabel="Comité" value={batchCommittee} onChange={(v) => setBatchCommittee(v)} options={[{ value: '', label: '— choisir un comité —' }, ...committees.map((c) => ({ value: c.id, label: c.nom }))]} />
                </label>
              )}
              {batchAction === 'archive' && <p className="muted">Les courriers sélectionnés passeront en statut archivé.</p>}
              {batchAction === 'delete' && <p className="muted" style={{ color: '#ff7886' }}>Les courriers sélectionnés seront définitivement supprimés.</p>}
              {['export-csv', 'export-xlsx', 'export-pdf'].includes(batchAction) && <p className="muted">Seuls les courriers sélectionnés seront exportés.</p>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => { setBatchOpen(false); setBatchCommittee(''); }}>Annuler</button>
              <button className="btn btn-primary" onClick={() => executeBatchAction(batchAction)} disabled={batchAction === 'committee' && !batchCommittee}>{batchAction === 'delete' ? 'Supprimer' : batchAction === 'archive' ? 'Archiver' : batchAction === 'committee' ? 'Transférer' : 'Exporter'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
