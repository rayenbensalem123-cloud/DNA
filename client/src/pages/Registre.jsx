import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate } from '../utils';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import PriorityPills from '../components/PriorityPills';

// Per-committee internal registers: "Arrivée" = letters the committee received,
// "Départ" = letters the committee itself emitted (stamped departCommission).
export default function Registre() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { committeeId } = useParams();
  const navigate = useNavigate();
  const [committees, setCommittees] = useState([]);
  const [tab, setTab] = useState('arrivee');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState('');
  const [importance, setImportance] = useState('');
  const [loading, setLoading] = useState(true);
  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);

  useEffect(() => {
    if (!isBureau && user?.commission) {
      if (committeeId !== user.commission) {
        navigate(`/registres/${encodeURIComponent(user.commission)}`, { replace: true });
      }
      return;
    }
    if (!committeeId && committees.length) {
      navigate(`/registres/${encodeURIComponent(committees[0].id)}`, { replace: true });
    }
  }, [committeeId, committees, isBureau, user?.commission, navigate]);

  useEffect(() => {
    if (!committeeId) return;
    let cancelled = false;
    setLoading(true);
    const params = { limit: 500, sort: 'date' };
    if (tab === 'arrivee') {
      params.commission = committeeId;
    } else {
      params.departCommission = committeeId;
      params.direction = 'sortant';
    }
    if (from) params.from = from;
    if (to) params.to = to;
    api.listLetters(params)
      .then((d) => { if (!cancelled) setItems(d.items || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [committeeId, tab, from, to]);

  const selected = committees.find((c) => c.id === committeeId);
  const committeeName = (id) => committees.find((c) => c.id === id)?.nom || 'Sans comité';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((l) => {
      if (statut && (l.statut || 'recu') !== statut) return false;
      if (importance && !(Array.isArray(l.priorite) ? l.priorite : [l.priorite]).includes(importance)) return false;
      if (!needle) return true;
      return [l.numeroLettre, l.ref, l.objet, l.expediteur?.nom, l.destinataire?.nom].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [items, q, statut, importance]);

  const exportHeaders = useMemo(() => ([
    { key: 'numero', label: 'N° courrier' },
    { key: 'objet', label: 'Objet' },
    { key: 'expediteur', label: tab === 'arrivee' ? 'Expéditeur' : 'Destinataire' },
    { key: 'comite', label: tab === 'arrivee' ? 'Comité destinataire' : 'Comité émetteur' },
    { key: 'statut', label: 'Statut' },
    { key: 'priorite', label: 'Priorité' },
    { key: 'date', label: 'Date' },
  ]), [tab]);
  const exportRows = shown.map((l) => ({
    numero: l.numeroLettre || l.ref || '',
    objet: l.objet || '',
    expediteur: tab === 'arrivee' ? (l.expediteur?.nom || '') : (l.destinataire?.nom || ''),
    comite: tab === 'arrivee' ? committeeName(l.commission) : committeeName(l.departCommission || l.createdByCommission),
    statut: t('status.' + (l.statut || 'recu')),
    priorite: l.priorite === 'urgente' ? 'Urgente' : l.priorite === 'confidentielle' ? 'Confidentielle' : 'Normale',
    date: fmtDate(l.dateReception || l.dateEmission),
  }));
  const doExport = async (format) => {
    try {
      const name = `registre-${tab}-${(selected?.nom || 'comite').replace(/[^\w-]+/g, '_')}`;
      if (format === 'csv') downloadCsv(name, exportHeaders, exportRows);
      else if (format === 'xlsx') await downloadXlsx(name, exportHeaders, exportRows);
      else printPdf({ title: `Registre ${tab === 'arrivee' ? 'd’arrivée' : 'de départ'} — ${selected?.nom || ''}`, subtitle: [from && `du ${from}`, to && `au ${to}`].filter(Boolean).join(' '), headers: exportHeaders, rows: exportRows, meta: { by: user?.name } });
    } catch { /* non-critical */ }
  };

  return (
    <div className="page registre-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Registres internes</span><h1>Registre — {selected?.nom || 'Comité'}</h1></div>
        <div className="export-group" role="group" aria-label="Exporter le registre">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('csv')}>CSV</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('xlsx')}>Excel</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('pdf')}>PDF</button>
        </div>
      </header>

      <div className="registre-toolbar">
        {isBureau && <label className="filter-field"><span>Comité</span>
          <Select ariaLabel="Comité" value={committeeId || ''} onChange={(v) => navigate(`/registres/${encodeURIComponent(v)}`)} options={committees.map((c) => ({ value: c.id, label: c.nom }))} />
        </label>}
        <div className="registre-tabs" role="tablist" aria-label="Type de registre">
          <button type="button" role="tab" aria-selected={tab === 'arrivee'} className={'btn ' + (tab === 'arrivee' ? 'btn-primary' : 'btn-secondary')} onClick={() => setTab('arrivee')}>Courriers arrivés{tab === 'arrivee' ? ` (${items.length})` : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'depart'} className={'btn ' + (tab === 'depart' ? 'btn-primary' : 'btn-secondary')} onClick={() => setTab('depart')}>Courriers partis{tab === 'depart' ? ` (${items.length})` : ''}</button>
        </div>
        <div className="activity-dates">
          <label className="filter-field"><span>Du</span><DatePicker value={from} max={to || undefined} onChange={setFrom} placeholder="jj/mm/aaaa" /></label>
          <label className="filter-field"><span>Au</span><DatePicker value={to} min={from || undefined} onChange={setTo} placeholder="jj/mm/aaaa" /></label>
          {(from || to) && <button type="button" className="btn btn-ghost" onClick={() => { setFrom(''); setTo(''); }}>Réinitialiser</button>}
        </div>
        <input className="input" type="search" aria-label="Rechercher" placeholder="Rechercher (N°, objet, expéditeur…)" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <Select ariaLabel="Statut" value={statut} onChange={setStatut} options={[{ value: '', label: 'Tous les statuts' }, ...['recu', 'enregistre', 'en_cours', 'traite', 'transmis', 'vu', 'archive'].map((v) => ({ value: v, label: t('status.' + v) }))]} />
        <Select ariaLabel="Importance" value={importance} onChange={setImportance} options={[{ value: '', label: 'Toutes les importances' }, { value: 'normale', label: 'Normale' }, { value: 'urgente', label: 'Urgente' }, { value: 'confidentielle', label: 'Confidentielle' }]} />
      </div>

      <div className="card">
        <div className="archive-list-heading">
          <h2 className="card-title">{tab === 'arrivee' ? 'Registre d’arrivée' : 'Registre de départ'}</h2>
          <span className="muted">{shown.length} au total</span>
        </div>
        {loading ? <div className="card-pad">{t('common.loading')}</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('letters.numero')}</th><th>{t('letters.objet')}</th><th>{tab === 'arrivee' ? 'Expéditeur' : 'Destinataire'}</th><th>{tab === 'arrivee' ? 'Comité destinataire' : 'Comité émetteur'}</th><th>{t('letters.statut')}</th><th>{t('letters.priorite')}</th><th>{t('letters.date')}</th></tr></thead>
            <tbody>{shown.map((l) => (
              <tr key={l.id} className="row-link" onClick={() => navigate('/lettres/' + l.id)}>
                <td className="mono">{l.numeroLettre || '—'}</td>
                <td><div className="letter-subject">{l.objet}</div></td>
                <td>{tab === 'arrivee' ? (l.expediteur?.nom || '—') : (l.destinataire?.nom || '—')}</td>
                <td><span className="committee-pill">{tab === 'arrivee' ? committeeName(l.commission) : committeeName(l.departCommission || l.createdByCommission)}</span></td>
                <td><span className={'badge statut-' + (l.statut || 'recu')}>{t('status.' + (l.statut || 'recu'))}</span></td>
                <td><PriorityPills value={l.priorite} /></td>
                <td className="date-cell">{fmtDate(l.dateReception || l.dateEmission)}</td>
              </tr>
            ))}{shown.length === 0 && <tr><td colSpan={7} className="empty-cell">{tab === 'arrivee' ? 'Aucun courrier arrivé sur la période.' : 'Aucun courrier parti sur la période.'}</td></tr>}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
