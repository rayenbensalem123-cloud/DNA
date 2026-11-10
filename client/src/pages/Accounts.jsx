import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setToken } from '../api';
import { useAuth } from '../auth';
import Select from '../components/Select';

const emptyAccount = () => ({ name: '', username: '', password: '', commission: '', role: 'agent' });
const ROLE_HINTS = {
  agent: 'Peut envoyer du courrier à n’importe quel comité, mais ne lit que le courrier reçu par son propre comité.',
  supervisor: 'Équivalent à l’administrateur : voit tout et valide les courriers.',
  admin: 'Voit tout : courrier de tous les comités, comptes et suppressions.',
};
const ROLE_LABELS = { admin: 'Administration', supervisor: 'Superviseur', agent: 'Comité', lecture: 'Comité' };

export default function Accounts() {
  const { user: me } = useAuth();
  const [confirmId, setConfirmId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [form, setForm] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // --- Comité management (admin) ---
  const [newCommittee, setNewCommittee] = useState('');
  const [editingCommittee, setEditingCommittee] = useState(null); // { id, nom }
  const [comBusy, setComBusy] = useState(false);

  const load = useCallback(async () => {
    const [usersData, committeesData] = await Promise.all([api.users(), api.committees()]);
    setAccounts(usersData.items || []);
    setCommittees(committeesData.items || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => !q || `${account.name} ${account.username}`.toLowerCase().includes(q));
  }, [accounts, query]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const edit = (account) => {
    setError(''); setNotice('');
    setForm({ id: account.id, name: account.name, username: account.username, password: '', commission: account.commission || '', role: ['admin', 'supervisor'].includes(account.role) ? account.role : 'agent' });
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...form, commission: form.commission || null };
      if (form.id) {
        const { id, username, ...changes } = payload;
        const updated = await api.updateUser(id, changes);
        if (updated?.token) setToken(updated.token);
        setNotice('Compte mis à jour.');
      } else {
        await api.createUser(payload);
        setNotice('Compte créé.');
      }
      setForm(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (account) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.deleteUser(account.id);
      setConfirmId(null);
      setNotice(`Compte « ${account.name} » supprimé.`);
      await load();
    } catch (e) { setError(e.message); setConfirmId(null); }
    finally { setBusy(false); }
  };

  const addCommittee = async (event) => {
    event.preventDefault();
    setComBusy(true); setError(''); setNotice('');
    try {
      const d = await api.createCommittee(newCommittee);
      setNotice(`Comité « ${d.item.nom} » créé.`);
      setNewCommittee('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setComBusy(false); }
  };

  const renameCommittee = async (event) => {
    event.preventDefault();
    setComBusy(true); setError(''); setNotice('');
    try {
      await api.updateCommittee(editingCommittee.id, editingCommittee.nom);
      setNotice(`Comité renommé en « ${editingCommittee.nom.trim().replace(/\s+/g, ' ')} ».`);
      setEditingCommittee(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setComBusy(false); }
  };

  return (
    <div className="page accounts-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Administration</span><h1>Comptes</h1></div>
        {!form && <button className="btn btn-primary" onClick={() => { setError(''); setNotice(''); setForm(emptyAccount()); }}>+ Ajouter un compte</button>}
      </header>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && !form && <div className="form-error" role="alert">{error}</div>}

      {form && <section className="card account-editor">
        <div className="card-head-row"><h2 className="card-title">{form.id ? 'Modifier le compte' : 'Nouveau compte'}</h2><button className="btn btn-ghost" type="button" onClick={() => { setForm(null); setError(''); }}>Fermer</button></div>
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="field">Nom complet<input autoComplete="name" value={form.name} onChange={(e) => update('name', e.target.value)} required /></label>
            <label className="field">Identifiant<input autoComplete="username" value={form.username} onChange={(e) => update('username', e.target.value)} required minLength={3} disabled={Boolean(form.id)} /></label>
            <label className="field">{form.id ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe'}<input type="password" autoComplete="new-password" value={form.password} onChange={(e) => update('password', e.target.value)} minLength={form.password ? 8 : undefined} required={!form.id} placeholder={form.id ? 'Laisser vide pour conserver' : '8 caractères minimum'} /></label>
            <label className="field">Type de compte<Select ariaLabel="Type de compte" value={form.role} onChange={(v) => update('role', v)} disabled={form.id === me?.id} options={[{ value: 'agent', label: 'Comité' }, { value: 'supervisor', label: 'Superviseur' }, { value: 'admin', label: 'Administration' }]} /><span className="muted">{ROLE_HINTS[form.role]}</span></label>
            <label className="field">{form.role === 'admin' ? 'Comité (facultatif)' : 'Comité'}<Select ariaLabel="Comité" value={form.commission} onChange={(v) => update('commission', v)} placeholder={form.role === 'admin' ? 'Aucun comité' : '— Choisir un comité —'} options={[{ value: '', label: form.role === 'admin' ? 'Aucun comité' : '— Choisir un comité —' }, ...committees.map((committee) => ({ value: committee.id, label: committee.nom }))]} /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button className="btn btn-secondary" type="button" onClick={() => { setForm(null); setError(''); }}>Annuler</button></div>
        </form>
      </section>}

      <section className="card committee-manager">
        <div className="account-list-heading"><div><h2 className="card-title">Comités</h2><div className="muted">{committees.length} comité{committees.length === 1 ? '' : 's'} — utilisés par les comptes et les courriers</div></div></div>
        <form className="committee-add" onSubmit={addCommittee}>
          <input aria-label="Nom du nouveau comité" placeholder="Nom du nouveau comité…" value={newCommittee} onChange={(e) => setNewCommittee(e.target.value)} required minLength={2} maxLength={80} />
          <button className="btn btn-primary" type="submit" disabled={comBusy || !newCommittee.trim()}>+ Ajouter le comité</button>
        </form>
        <ul className="committee-list">
          {committees.map((committee) => (
            <li key={committee.id} className="committee-row">
              {editingCommittee?.id === committee.id ? (
                <form className="committee-rename" onSubmit={renameCommittee}>
                  <input aria-label="Nouveau nom du comité" value={editingCommittee.nom} onChange={(e) => setEditingCommittee({ ...editingCommittee, nom: e.target.value })} required minLength={2} maxLength={80} autoFocus />
                  <button className="btn btn-primary" type="submit" disabled={comBusy}>{comBusy ? '…' : 'Enregistrer'}</button>
                  <button className="btn btn-secondary" type="button" onClick={() => setEditingCommittee(null)} disabled={comBusy}>Annuler</button>
                </form>
              ) : (
                <>
                  <span className="committee-row-name">{committee.nom}</span>
                  <span className="muted">{accounts.filter((a) => a.commission === committee.id).length} compte{accounts.filter((a) => a.commission === committee.id).length === 1 ? '' : 's'}</span>
                  <button className="btn btn-secondary" type="button" onClick={() => { setEditingCommittee({ id: committee.id, nom: committee.nom }); setError(''); }}>Renommer</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card account-list-card">
        <div className="account-list-heading"><div><h2 className="card-title">Tous les comptes</h2><div className="muted">{accounts.length} compte{accounts.length === 1 ? '' : 's'}</div></div><input className="account-search" type="search" placeholder="Rechercher un compte…" aria-label="Rechercher un compte" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="table-wrap"><table className="table account-table">
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Type</th><th>Comité</th><th></th></tr></thead>
          <tbody>{filtered.map((account) => <tr key={account.id}>
            <td className="account-name-cell">{account.name}</td><td className="mono">{account.username}</td><td>{ROLE_LABELS[account.role] || account.role}</td>
            <td>{committees.find((committee) => committee.id === account.commission)?.nom || <span className="muted">Aucun</span>}</td>
            <td className="account-actions">{confirmId === account.id
              ? <span className="account-confirm" role="group" aria-label={`Confirmer la suppression de ${account.name}`}>
                  <span>Supprimer ce compte ?</span>
                  <button className="btn btn-danger" type="button" onClick={() => remove(account)} disabled={busy}>Oui, supprimer</button>
                  <button className="btn btn-secondary" type="button" onClick={() => setConfirmId(null)} disabled={busy}>Annuler</button>
                </span>
              : <>
                  <button className="btn btn-secondary account-edit" onClick={() => edit(account)}>Modifier</button>
                  {account.id !== me?.id && account.role !== 'admin' && <button className="btn btn-danger account-delete" type="button" onClick={() => { setError(''); setNotice(''); setConfirmId(account.id); }}>Supprimer</button>}
                </>}</td>
          </tr>)}
          {filtered.length === 0 && <tr><td colSpan="5" className="empty-cell">Aucun compte trouvé.</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
