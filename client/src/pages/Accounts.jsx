import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const emptyAccount = () => ({ name: '', username: '', password: '', commission: '' });

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [form, setForm] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
    setForm({ id: account.id, name: account.name, username: account.username, password: '', commission: account.commission || '' });
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...form, commission: form.commission || null };
      if (form.id) {
        const { id, username, ...changes } = payload;
        await api.updateUser(id, changes);
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
            <label className="field">Comité<select value={form.commission} onChange={(e) => update('commission', e.target.value)}><option value="">Aucun comité</option>{committees.map((committee) => <option key={committee.id} value={committee.id}>{committee.nom}</option>)}</select></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button className="btn btn-secondary" type="button" onClick={() => { setForm(null); setError(''); }}>Annuler</button></div>
        </form>
      </section>}

      <section className="card account-list-card">
        <div className="account-list-heading"><div><h2 className="card-title">Tous les comptes</h2><div className="muted">{accounts.length} compte{accounts.length === 1 ? '' : 's'}</div></div><input className="account-search" type="search" placeholder="Rechercher un compte…" aria-label="Rechercher un compte" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="table-wrap"><table className="table account-table">
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Comité</th><th></th></tr></thead>
          <tbody>{filtered.map((account) => <tr key={account.id}>
            <td className="account-name-cell">{account.name}</td><td className="mono">{account.username}</td>
            <td>{committees.find((committee) => committee.id === account.commission)?.nom || <span className="muted">Aucun</span>}</td>
            <td><button className="btn btn-secondary account-edit" onClick={() => edit(account)}>Modifier</button></td>
          </tr>)}
          {filtered.length === 0 && <tr><td colSpan="4" className="empty-cell">Aucun compte trouvé.</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
