import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDateTime } from '../utils';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import DatePicker from '../components/DatePicker';

const LABELS = {
  login: 'Connexion à la plateforme',
  'letter.create': 'Courrier créé',
  'letter.update': 'Courrier modifié',
  'letter.transfer': 'Courrier transféré',
  'letter.transfer.request': 'Transfert demandé',
  'letter.transfer.approve': 'Transfert approuvé',
  'letter.transfer.reject': 'Transfert refusé',
  'letter.transfer.cancel': 'Transfert annulé',
  'letter.delete': 'Courrier supprimé',
  'letter.event': 'Suivi du courrier',
  'letter.file.view': 'PDF du courrier ouvert',
  'piece.add': 'Fichier ajouté',
  'piece.delete': 'Fichier supprimé',
  'user.create': 'Compte créé',
  'user.update': 'Compte modifié',
  'user.delete': 'Compte supprimé',
  'courrier.upload': 'Courrier numérisé téléversé',
  'courrier.validate_daf': 'Courrier validé (DAF)',
  'courrier.validate': 'Courrier validé (bureau)',
  'courrier.reject': 'Courrier rejeté',
  'courrier.reject_delete': 'Courrier rejeté supprimé',
  'courrier.delete': 'Courrier supprimé',
  'courrier.file.view': 'Fichier du courrier ouvert',
  'committee.create': 'Comité créé',
  'committee.update': 'Comité renommé',
  'settings.update': 'Réglages Gmail modifiés',
  'settings.clear': 'Réglages Gmail effacés',
  'chat.send': 'Message envoyé',
};
const FILTERS = [['', 'Tout'], ['letter', 'Courriers'], ['courrier', 'Numérisation'], ['piece', 'Fichiers'], ['committee', 'Comités'], ['user', 'Comptes'], ['login', 'Connexions'], ['chat', 'Chat']];
const EVENT_LABELS = { vu_comite: 'ouvert par le comité', recu_comite: 'reçu par le comité', traite_comite: 'terminé et archivé', note: 'note ajoutée' };
const ROLE_LABELS = { admin: 'Administration', daf: 'DAF', bureau: 'Bureau d’ordre', comite: 'Comité', agent: 'Agent' };

// Category per action family: icon + colored pill.
const CATEGORY = (action) => {
  if (action === 'login') return { icon: '🔑', cls: 'act-auth' };
  if (action.startsWith('letter')) return { icon: '✉️', cls: 'act-courrier' };
  if (action.startsWith('courrier')) return { icon: '📄', cls: 'act-scan' };
  if (action.startsWith('piece')) return { icon: '📎', cls: 'act-fichier' };
  if (action.startsWith('committee')) return { icon: '🏛️', cls: 'act-comite' };
  if (action.startsWith('user')) return { icon: '👤', cls: 'act-compte' };
  if (action.startsWith('chat')) return { icon: '💬', cls: 'act-chat' };
  return { icon: '⚙️', cls: 'act-settings' };
};

// Friendly labels for the expandable detail panel.
const DETAIL_KEYS = {
  letterId: 'ID courrier', courrierId: 'ID numérisation', committeeId: 'ID comité',
  from: 'De', to: 'Vers', type: 'Type', file: 'Fichier', objet: 'Objet',
  role: 'Rôle', commission: 'Comité lié', passwordReset: 'Mot de passe réinitialisé',
  permissions: 'Permissions modifiées', readOnly: 'Lecture seule', oldName: 'Ancien nom',
  by: 'Opéré par', letterRef: 'Réf. courrier créé', reason: 'Motif du rejet', sender: 'Expéditeur',
};

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

// Relative time: "à l'instant", "il y a 5 min", "il y a 2 h", "hier", "il y a 6 j".
const rel = (iso) => {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'hier';
  return `il y a ${Math.floor(s / 86400)} j`;
};

export default function Activity() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [committees, setCommittees] = useState([]);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.activity(filter, { from, to }).then((d) => { if (!cancelled) { setItems(d.items || []); setTotal(d.total || 0); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filter, from, to]);

  const nameOf = (id) => (id ? (committees.find((c) => c.id === id)?.nom || 'Comité supprimé') : '');
  const detail = (a) => {
    const d = a.details || {};
    if (a.action === 'letter.transfer') return `${d.from ? nameOf(d.from) : 'Aucun'} → ${d.to ? nameOf(d.to) : 'Aucun'}`;
    if (a.action === 'letter.transfer.request') return `${d.from ? nameOf(d.from) : 'Aucun'} → ${d.to ? nameOf(d.to) : 'Aucun'} · en attente d’approbation`;
    if (a.action === 'letter.transfer.approve' || a.action === 'letter.transfer.reject' || a.action === 'letter.transfer.cancel') return `${d.from ? nameOf(d.from) : 'Aucun'} → ${d.to ? nameOf(d.to) : 'Aucun'}`;
    if (a.action === 'letter.create') return d.to ? `Envoyé à ${nameOf(d.to)}` : '';
    if (a.action === 'letter.event') return EVENT_LABELS[d.type] || '';
    if (a.action === 'piece.add') return d.file || '';
    if (a.action === 'letter.delete') return d.objet || '';
    if (a.action === 'user.create') return `${d.role === 'admin' ? 'Administration' : 'Comité'}${d.commission ? ' · ' + nameOf(d.commission) : ''}`;
    if (a.action === 'user.update') return `${d.role === 'admin' ? 'Administration' : 'Comité'}${d.commission ? ' · ' + nameOf(d.commission) : ''}${d.passwordReset ? ' · mot de passe changé' : ''}${d.readOnly !== undefined ? (d.readOnly ? ' · lecture seule' : ' · accès rétabli') : ''}`;
    if (a.action === 'letter.file.view') return d.file || '';
    if (a.action === 'courrier.validate') return d.letterRef ? `Devenu le courrier ${d.letterRef}` : '';
    if (a.action === 'courrier.reject') return d.reason ? `Motif : ${d.reason}${d.sender ? ' · envoyé par ' + d.sender : ''}` : (d.sender ? 'envoyé par ' + d.sender : '');
    if (a.action === 'courrier.reject_delete' || a.action === 'courrier.delete') return d.by ? `Par ${d.by}` : '';
    if (a.action === 'committee.update') return d.oldName ? `« ${d.oldName} » → « ${a.target} »` : '';
    if (a.action === 'settings.update' || a.action === 'settings.clear' || a.action === 'courrier.validate_daf') return d.by ? `Par ${d.by}` : '';
    return '';
  };
  const detailValue = (k, v) => {
    if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
    if (k === 'role') return ROLE_LABELS[v] || v;
    if (['from', 'to', 'commission', 'committeeId'].includes(k)) return nameOf(v) || '—';
    if (k === 'type') return EVENT_LABELS[v] || v;
    return String(v);
  };
  const detailPairs = (a) => Object.entries(a.details || {})
    .filter(([k, v]) => DETAIL_KEYS[k] && v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => [DETAIL_KEYS[k], detailValue(k, v)]);

  const exportHeaders = [
    { key: 'date', label: 'Date' },
    { key: 'qui', label: 'Qui' },
    { key: 'action', label: 'Action' },
    { key: 'element', label: 'Élément' },
    { key: 'detail', label: 'Détail' },
  ];
  const exportRows = items.map((a) => ({
    date: fmtDateTime(a.date),
    qui: a.userName + (a.commission ? ` (${nameOf(a.commission)})` : ''),
    action: LABELS[a.action] || a.action,
    element: a.target || '',
    detail: detail(a),
  }));
  const doExport = async (format) => {
    try {
      if (format === 'csv') downloadCsv('journal-activite', exportHeaders, exportRows);
      else if (format === 'xlsx') await downloadXlsx('journal-activite', exportHeaders, exportRows);
      else printPdf({ title: 'Journal d’activité', subtitle: [filter ? 'Filtre : ' + (FILTERS.find(([v]) => v === filter)?.[1] || filter) : 'Toutes les actions', from && `du ${from}`, to && `au ${to}`].filter(Boolean).join(' · '), headers: exportHeaders, rows: exportRows, meta: { by: user?.name } });
    } catch { /* export failures are non-critical */ }
  };
  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  return (
    <div className="page activity-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Administration</span><h1>Journal d’activité</h1></div>
        <div className="export-group" role="group" aria-label="Exporter le journal">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('csv')}>CSV</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('xlsx')}>Excel</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('pdf')}>PDF</button>
        </div>
      </header>
      <section className="card">
        <div className="activity-filters" role="group" aria-label="Filtrer le journal">
          {FILTERS.map(([value, label]) => <button key={value || 'all'} type="button" className={'btn ' + (filter === value ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter(value)}>{label}</button>)}
          <div className="activity-dates">
            <label className="filter-field"><span>Du</span><DatePicker value={from} max={to || undefined} onChange={setFrom} placeholder="jj/mm/aaaa" /></label>
            <label className="filter-field"><span>Au</span><DatePicker value={to} min={from || undefined} onChange={setTo} placeholder="jj/mm/aaaa" /></label>
            {(from || to) && <button type="button" className="btn btn-ghost" onClick={() => { setFrom(''); setTo(''); }}>Réinitialiser</button>}
          </div>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {loading ? <div className="card-pad">Chargement…</div> : (
          <div className="table-wrap"><table className="table activity-table">
            <thead><tr><th aria-label="Détails"></th><th>Date</th><th>Qui</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead>
            <tbody>{items.map((a) => {
              const cat = CATEGORY(a.action);
              const open = !!expanded[a.id];
              const pairs = detailPairs(a);
              return (
                <FragmentRow key={a.id} open={open} onToggle={() => toggle(a.id)} pairs={pairs}>
                  <td className="nowrap">
                    <div className="act-when"><span className="act-when-rel">{rel(a.date)}</span><span className="act-when-full">{fmtDateTime(a.date)}</span></div>
                  </td>
                  <td>
                    <div className="act-who">
                      <span className="act-avatar" aria-hidden="true">{initials(a.userName)}</span>
                      <div className="act-who-copy">
                        <span className="act-who-name">{a.userName}</span>
                        <span className="act-who-meta">{ROLE_LABELS[a.userRole] || a.userRole || ''}{a.commission ? ' · ' + nameOf(a.commission) : ''}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className={'act-pill ' + cat.cls}><span className="act-pill-icon" aria-hidden="true">{cat.icon}</span>{LABELS[a.action] || a.action}</span></td>
                  <td className="mono act-target" title={a.target}>{a.target}</td>
                  <td className="act-detail-cell">{detail(a)}</td>
                </FragmentRow>
              );
            })}
            {items.length === 0 && <tr><td colSpan="6" className="empty-cell">Aucune activité enregistrée.</td></tr>}</tbody>
          </table></div>
        )}
        {!loading && items.length > 0 && (
          <div className="card-pad card-footer activity-count"><b>{items.length}</b> entrée{items.length > 1 ? 's' : ''} affichée{items.length > 1 ? 's' : ''}{total > items.length ? <> sur <b>{total}</b> au total</> : ''} · cliquez sur <span className="act-expand" style={{ display: 'inline-grid', width: 22, height: 22, verticalAlign: 'middle' }}>›</span> pour tous les détails</div>
        )}
      </section>
    </div>
  );
}

// Row + its expandable detail panel (two <tr>, one keyed fragment).
function FragmentRow({ open, onToggle, pairs, children }) {
  return (
    <>
      <tr className={open ? 'act-open' : ''}>
        <td className="act-expander"><button type="button" className={'act-expand' + (open ? ' open' : '')} aria-expanded={open} aria-label="Afficher les détails" onClick={onToggle}>›</button></td>
        {children}
      </tr>
      {open && (
        <tr className="act-detail-row">
          <td colSpan="6">
            {pairs.length
              ? <div className="act-detail-grid">{pairs.map(([k, v]) => <div key={k} className="act-detail-item"><span className="act-detail-k">{k}</span><span className="act-detail-v">{v}</span></div>)}</div>
              : <span className="act-detail-none">Aucun détail supplémentaire pour cette entrée.</span>}
          </td>
        </tr>
      )}
    </>
  );
}
