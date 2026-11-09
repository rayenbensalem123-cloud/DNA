import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtDateTime } from '../utils';

const LABELS = {
  login: 'Connexion à la plateforme',
  'letter.create': 'Courrier créé',
  'letter.update': 'Courrier modifié',
  'letter.transfer': 'Courrier transféré',
  'letter.delete': 'Courrier supprimé',
  'letter.event': 'Suivi du courrier',
  'letter.file.view': 'PDF du courrier ouvert',
  'piece.add': 'Fichier ajouté',
  'piece.delete': 'Fichier supprimé',
  'user.create': 'Compte créé',
  'user.update': 'Compte modifié',
  'user.delete': 'Compte supprimé',
  'courrier.upload': 'Courrier numérisé téléversé',
  'courrier.validate': 'Courrier validé',
  'courrier.reject': 'Courrier rejeté',
  'courrier.delete': 'Courrier rejeté supprimé',
  'courrier.file.view': 'Fichier du courrier ouvert',
};
const FILTERS = [['', 'Tout'], ['letter', 'Courriers'], ['courrier', 'Numérisation'], ['piece', 'Fichiers'], ['user', 'Comptes'], ['login', 'Connexions']];
const EVENT_LABELS = { vu_comite: 'ouvert par le comité', recu_comite: 'reçu par le comité', traite_comite: 'terminé et archivé', note: 'note ajoutée' };

export default function Activity() {
  const [items, setItems] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.activity(filter).then((d) => { if (!cancelled) { setItems(d.items || []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filter]);

  const nameOf = (id) => committees.find((c) => c.id === id)?.nom || id;
  const detail = (a) => {
    const d = a.details || {};
    if (a.action === 'letter.transfer') return `${d.from ? nameOf(d.from) : 'Aucun'} → ${d.to ? nameOf(d.to) : 'Aucun'}`;
    if (a.action === 'letter.create') return d.to ? `Envoyé à ${nameOf(d.to)}` : '';
    if (a.action === 'letter.event') return EVENT_LABELS[d.type] || '';
    if (a.action === 'piece.add') return d.file || '';
    if (a.action === 'letter.delete') return d.objet || '';
    if (a.action === 'user.create') return `${d.role === 'admin' ? 'Administration' : 'Comité'}${d.commission ? ' · ' + nameOf(d.commission) : ''}`;
    if (a.action === 'user.update') return `${d.role === 'admin' ? 'Administration' : 'Comité'}${d.commission ? ' · ' + nameOf(d.commission) : ''}${d.passwordReset ? ' · mot de passe changé' : ''}`;
    if (a.action === 'letter.file.view') return d.file || '';
    if (a.action === 'courrier.validate') return d.letterRef ? `Devenu le courrier ${d.letterRef}` : '';
    if (a.action === 'courrier.reject') return d.reason ? `Motif : ${d.reason}${d.sender ? ' · envoyé par ' + d.sender : ''}` : (d.sender ? 'envoyé par ' + d.sender : '');
    return '';
  };

  return (
    <div className="page activity-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Administration</span><h1>Journal d’activité</h1></div>
      </header>
      <section className="card">
        <div className="activity-filters" role="group" aria-label="Filtrer le journal">
          {FILTERS.map(([value, label]) => <button key={value || 'all'} type="button" className={'btn ' + (filter === value ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {loading ? <div className="card-pad">Chargement…</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Qui</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead>
            <tbody>{items.map((a) => <tr key={a.id}>
              <td className="nowrap">{fmtDateTime(a.date)}</td>
              <td>{a.userName}{a.commission && <div className="letter-subline">{nameOf(a.commission)}</div>}</td>
              <td>{LABELS[a.action] || a.action}</td>
              <td className="mono">{a.target}</td>
              <td>{detail(a)}</td>
            </tr>)}
            {items.length === 0 && <tr><td colSpan="5" className="empty-cell">Aucune activité enregistrée.</td></tr>}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
