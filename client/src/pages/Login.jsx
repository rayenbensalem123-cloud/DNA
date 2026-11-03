import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || t('auth.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-card">
        <section className="login-identity" aria-label="Fédération Tunisienne de Football">
          <div className="identity-brand">
            <img className="login-emblem" src="/federation-tunisienne-logo.webp" alt="Emblème de la Fédération Tunisienne de Football" />
          </div>
          <div className="identity-copy">
            <h1>Direction Nationale<br />d’Arbitrage</h1>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-welcome">
            <h2>Bienvenue</h2>
          </div>
          <form onSubmit={submit} className="login-form">
            <label>
              <span>{t('auth.username')}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              <span>{t('auth.password')}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block login-submit" disabled={busy}>
              <span>{busy ? t('common.loading') : t('actions.login')}</span>
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

