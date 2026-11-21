import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import Select from '../components/Select';

const STATUS_LABELS = { actif: 'Actif', inactif: 'Inactif', suspendu: 'Suspendu' };
const emptyReferee = () => ({
  nom: '', prenom: '', grade: '', categorie: '', region: '', telephone: '',
  email: '', matricule: '', dateNaissance: '', association: '', statut: 'actif', note: '',
});
const FIELDS = [
  ['matricule', 'Matricule'],
  ['grade', 'Grade'],
  ['categorie', 'Catégorie'],
  ['region', 'Région'],
  ['association', 'Association / Ligue'],
  ['telephone', 'Téléphone'],
  ['email', 'Email'],
  ['dateNaissance', 'Date de naissance'],
];

export default function Referees() {
  const { user } = useAuth();
  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await api.referees(); setItems(d.items || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (filterStatut && r.statut !== filterStatut) return false;
      if (!q) return true;
      return [r.nom, r.prenom, r.matricule, r.grade, r.region, r.association].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, query, filterStatut]);

  const openReferee = async (r) => {
    try { const d = await api.referee(r.id); setSelected(d.item); }
    catch { setSelected(r); }
    setForm(null); setConfirmDelete(false);
  };

  const update = (key, value) => setForm((c) => ({ ...c, [key]: value }));
  const edit = (r) => { setError(''); setNotice(''); setForm({ ...r }); setConfirmDelete(false); };
  const add = () => { setError(''); setNotice(''); setForm(emptyReferee()); setSelected(null); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (form.id) {
        const { id, createdAt, createdBy, ...changes } = form;
        const d = await api.updateReferee(id, changes);
        setSelected(d.item);
        setNotice('Arbitre mis à jour.');
      } else {
        const d = await api.createReferee(form);
        setSelected(d.item);
        setNotice('Arbitre ajouté.');
      }
      setForm(null);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.deleteReferee(selected.id);
      setNotice('Arbitre supprimé.');
      setSelected(null); setConfirmDelete(false);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const fullName = (r) => [r.prenom, r.nom].filter(Boolean).join(' ').trim() || '—';
  const initials = (r) => [r.prenom, r.nom].filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="page referees-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Direction Nationale d’Arbitrage</span><h1>Arbitres</h1>
          <div className="muted">{items.length} arbitre{items.length > 1 ? 's' : ''} enregistré{items.length > 1 ? 's' : ''}</div>
        </div>
        {isBureau && <button className="btn btn-primary" onClick={add}>+ Ajouter un arbitre</button>}
      </header>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && !form && <div className="form-error" role="alert">{error}</div>}

      <div className="card referees-card">
        <div className="archive-list-heading">
          <h2 className="card-title">Liste des arbitres</h2>
          <span className="muted">{filtered.length} affiché{filtered.length > 1 ? 's' : ''}</span>
        </div>
        <div className="filters referees-filters">
          <input type="search" aria-label="Rechercher un arbitre" placeholder="Rechercher (nom, matricule, région…)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select ariaLabel="Statut" value={filterStatut} onChange={setFilterStatut} options={[{ value: '', label: 'Tous les statuts' }, ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
        </div>
        {loading ? <div className="card-pad">Chargement…</div> : (
          <div className="table-wrap"><table className="table referees-table">
            <thead><tr><th>Arbitre</th><th>Matricule</th><th>Grade</th><th>Catégorie</th><th>Région</th><th>Statut</th></tr></thead>
            <tbody>{filtered.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => openReferee(r)}>
                <td>
                  <div className="referee-cell">
                    <span className="referee-avatar">{initials(r)}</span>
                    <div><div className="letter-subject">{fullName(r)}</div>{r.email && <div className="letter-subline">{r.email}</div>}</div>
                  </div>
                </td>
                <td className="mono">{r.matricule || '—'}</td>
                <td>{r.grade || '—'}</td>
                <td>{r.categorie || '—'}</td>
                <td>{r.region || '—'}</td>
                <td><span className={'badge referee-status-' + (r.statut || 'actif')}>{STATUS_LABELS[r.statut] || r.statut}</span></td>
              </tr>
            ))}
              {filtered.length === 0 && <tr><td colSpan="6" className="empty-cell">Aucun arbitre trouvé.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Détail de l'arbitre (carte) */}
      {selected && !form && (
        <div className="card referee-detail" style={{ marginTop: 16 }}>
          <div className="referee-detail-head">
            <span className="referee-avatar-lg">{initials(selected)}</span>
            <div className="referee-detail-id">
              <h2>{fullName(selected)}</h2>
              <div className="muted">{selected.grade || 'Arbitre'}{selected.matricule ? ' · ' + selected.matricule : ''}</div>
            </div>
            <span className={'badge referee-status-' + (selected.statut || 'actif')}>{STATUS_LABELS[selected.statut] || selected.statut}</span>
            <div className="referee-detail-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {isBureau && <button className="btn btn-secondary" onClick={() => edit(selected)}>Modifier</button>}
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Fermer</button>
            </div>
          </div>
          <div className="referee-info-grid">
            {FIELDS.map(([key, label]) => (
              <div key={key} className="referee-info-item">
                <span className="referee-info-label">{label}</span>
                <span className="referee-info-value">{selected[key] || '—'}</span>
              </div>
            ))}
          </div>
          {selected.note && <div className="referee-note"><span className="referee-info-label">Note</span><p>{selected.note}</p></div>}
          {isBureau && (
            <div className="referee-danger-zone">
              {confirmDelete ? (
                <span className="account-confirm" role="group" aria-label="Confirmer la suppression">
                  <span>Supprimer cet arbitre ?</span>
                  <button className="btn btn-danger" onClick={remove} disabled={busy}>Oui, supprimer</button>
                  <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Annuler</button>
                </span>
              ) : (
                <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Supprimer l’arbitre</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Formulaire ajout / édition */}
      {form && (
        <section className="card referee-editor" style={{ marginTop: 16 }}>
          <div className="card-head-row"><h2 className="card-title">{form.id ? 'Modifier l’arbitre' : 'Nouvel arbitre'}</h2><button className="btn btn-ghost" type="button" onClick={() => { setForm(null); setError(''); }}>Fermer</button></div>
          <form onSubmit={save}>
            <div className="form-grid">
              <label className="field">Nom<input value={form.nom} onChange={(e) => update('nom', e.target.value)} required placeholder="Nom de famille" /></label>
              <label className="field">Prénom<input value={form.prenom} onChange={(e) => update('prenom', e.target.value)} placeholder="Prénom" /></label>
              <label className="field">Matricule<input value={form.matricule} onChange={(e) => update('matricule', e.target.value)} placeholder="Ex. ARB-2026-001" /></label>
              <label className="field">Grade<input value={form.grade} onChange={(e) => update('grade', e.target.value)} placeholder="Ex. FIFA, continental, national" /></label>
              <label className="field">Catégorie<input value={form.categorie} onChange={(e) => update('categorie', e.target.value)} placeholder="Ex. Élite, A, B" /></label>
              <label className="field">Région<input value={form.region} onChange={(e) => update('region', e.target.value)} placeholder="Région" /></label>
              <label className="field">Association / Ligue<input value={form.association} onChange={(e) => update('association', e.target.value)} placeholder="Ligue régionale" /></label>
              <label className="field">Téléphone<input value={form.telephone} onChange={(e) => update('telephone', e.target.value)} placeholder="+216…" /></label>
              <label className="field">Email<input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="email@exemple.tn" /></label>
              <label className="field">Date de naissance<input type="date" value={form.dateNaissance} onChange={(e) => update('dateNaissance', e.target.value)} /></label>
              <label className="field">Statut<Select ariaLabel="Statut" value={form.statut} onChange={(v) => update('statut', v)} options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} /></label>
            </div>
            <label className="field full"><span>Note</span><textarea rows={3} value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Note interne sur l'arbitre…" /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button className="btn btn-secondary" type="button" onClick={() => { setForm(null); setError(''); }}>Annuler</button></div>
          </form>
        </section>
      )}
    </div>
  );
}
