import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDateTime } from '../utils';

// Gmail inside the platform: inbox over IMAP (app password), reading pane,
// new-mail badge. Credentials are configured by the admin in the settings
// panel below — until then the page shows a clear "not configured" state.
export default function Gmail() {
  const { user } = useAuth();
  const isAdminLike = user?.role === 'admin' || user?.role === 'supervisor';
  const [settings, setSettings] = useState(null);
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState(null);
  const [body, setBody] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);

  const loadSettings = useCallback(() => {
    api.getSettings().then((d) => {
      setSettings(d.gmail || {});
      setEmail(d.gmail?.email || '');
      setConfigured(Boolean(d.gmail?.configured));
      setAppPassword('');
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const loadInbox = useCallback(async () => {
    try {
      const d = await api.gmailMessages();
      setMessages(d.items || []);
      setUnread(d.unread || 0);
      setConfigured(true);
      setError('');
    } catch (e) {
      if (String(e.message).includes('non configuré')) { setConfigured(false); setError(''); }
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only poll the inbox once settings are known (avoids useless 400s).
    if (settings === null) return;
    loadInbox();
    const id = setInterval(loadInbox, 60000);
    return () => clearInterval(id);
  }, [settings, loadInbox]);

  const openMessage = async (m) => {
    setSelected(m);
    setBody(null);
    try {
      const d = await api.gmailMessage(m.uid);
      setBody(d);
      api.gmailAck(m.uid).catch(() => {});
      if (!m.seen) setUnread((u) => Math.max(0, u - 1));
      setMessages((current) => current.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)));
    } catch (e) {
      setBody({ error: e.message });
    }
  };

  const saveCredentials = async (event) => {
    event.preventDefault();
    setSaving(true); setSettingsMsg('');
    try {
      const d = await api.saveSettings({ gmail: { email, appPassword } });
      setSettings(d.gmail || {});
      setConfigured(Boolean(d.gmail?.configured));
      setAppPassword('');
      setSettingsMsg('Réglages enregistrés.');
      setLoading(true);
      loadInbox();
    } catch (e) {
      setSettingsMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const clearCredentials = async () => {
    setSaving(true); setSettingsMsg('');
    try {
      await api.saveSettings({ gmail: { email: '', appPassword: '' } });
      setSettings({ configured: false });
      setEmail(''); setAppPassword('');
      setConfigured(false);
      setMessages([]); setUnread(0);
      setSettingsMsg('Compte Gmail déconnecté.');
    } catch (e) {
      setSettingsMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page gmail-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Messagerie</span><h1>Gmail — DNA</h1></div>
        {configured && <button className="btn btn-secondary" onClick={loadInbox}>Actualiser{unread > 0 ? ` (${unread} non lu${unread > 1 ? 's' : ''})` : ''}</button>}
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      {isAdminLike && settings !== null && (
        <section className="card gmail-settings">
          <div className="card-head-row">
            <div><h2 className="card-title">Compte Gmail lié</h2><div className="muted">Connectez la boîte DNA via un mot de passe d’application Google (compte avec validation en deux étapes activée)</div></div>
            {configured && <span className="gmail-connected-pill">Connecté · {settings.email || email}</span>}
          </div>
          <form className="gmail-settings-form" onSubmit={saveCredentials}>
            <label className="field">Adresse Gmail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dna.***@gmail.com" autoComplete="off" /></label>
            <label className="field">Mot de passe d’application<input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder={settings.appPassword ? '•••••••••••• (inchangé)' : '16 caractères (xxxx xxxx xxxx xxxx)'} autoComplete="new-password" /></label>
            <div className="page-actions">
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              {configured && <button type="button" className="btn btn-secondary" onClick={clearCredentials} disabled={saving}>Déconnecter</button>}
            </div>
          </form>
          {settingsMsg && <div className="account-notice" role="status">{settingsMsg}</div>}
          <div className="muted small gmail-help">
            Comment faire : myaccount.google.com → Sécurité → Validation en deux étapes (activer) → Mots de passe d’application → générer un mot de passe pour « Courrier ». Aucun e-mail n’est envoyé par la plateforme ; la boîte est lue en lecture seule.
          </div>
        </section>
      )}

      {!configured ? (
        <div className="card card-pad gmail-not-configured">
          <h2 className="card-title">Boîte Gmail non connectée</h2>
          <p className="muted">
            {isAdminLike
              ? 'Ajoutez l’adresse Gmail et un mot de passe d’application dans le panneau ci-dessus pour activer la boîte de réception ici.'
              : 'Un administrateur doit d’abord connecter le compte Gmail de la DNA (réglages dans cette page).'}
          </p>
        </div>
      ) : (
        <div className="gmail-layout">
          <section className="card gmail-list-card">
            <div className="gmail-list-head"><h2 className="card-title">Boîte de réception</h2><span className="muted">{messages.length} messages</span></div>
            {loading ? <div className="card-pad">Chargement…</div> : (
              <ul className="gmail-list">
                {messages.map((m) => (
                  <li key={m.uid}>
                    <button type="button" className={'gmail-row' + (!m.seen ? ' unread' : '') + (selected?.uid === m.uid ? ' active' : '')} onClick={() => openMessage(m)}>
                      <span className="gmail-dot" aria-hidden="true" />
                      <span className="gmail-row-main"><span className="gmail-subject">{m.subject}</span><span className="gmail-from">{m.from}</span></span>
                      <span className="gmail-date">{m.date ? fmtDateTime(m.date) : ''}</span>
                    </button>
                  </li>
                ))}
                {messages.length === 0 && <li className="empty-cell">Boîte vide.</li>}
              </ul>
            )}
          </section>
          <section className="card gmail-read-card">
            {!selected ? <div className="card-pad muted">Sélectionnez un message pour le lire ici.</div> : (
              <>
                <div className="gmail-read-head">
                  <h2 className="card-title">{selected.subject}</h2>
                  <div className="muted">{selected.from} · {selected.date ? fmtDateTime(selected.date) : ''}</div>
                </div>
                <div className="gmail-read-body">
                  {body === null && <div className="card-pad">Chargement…</div>}
                  {body?.error && <div className="form-error" role="alert">{body.error}</div>}
                  {body?.html
                    ? <iframe title="Corps du message" sandbox="" srcDoc={body.html} className="gmail-html-frame" />
                    : body?.text != null && <pre className="gmail-text">{body.text}</pre>}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
