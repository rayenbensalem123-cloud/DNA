// Login page (redesigned)
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="login-bg-orb login-bg-orb-1" aria-hidden="true" />
      <div className="login-bg-orb login-bg-orb-2" aria-hidden="true" />
      <main className="login-card">
        <section className="login-identity">
          <div className="login-emblem-wrap">
            <div className="login-emblem-glow" aria-hidden="true" />
            <img className="login-emblem" src="/federation-tunisienne-logo.webp" alt="Emblème de la Fédération Tunisienne de Football" />
          </div>
          <div className="identity-copy">
            <span className="identity-overline"><span />Fédération Tunisienne de Football</span>
            <h1>Direction Nationale<br />d’Arbitrage</h1>
            <p>Bureau d’ordre — Registre officiel de correspondance</p>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-welcome">
            <h2>Bienvenue</h2>
            <p>Connectez-vous pour accéder au registre</p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label>
              <span>{t('auth.username')}</span>
              <div className="input-wrap">
                <span className="input-icon" aria-hidden="true">👤</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required placeholder="Identifiant" />
              </div>
            </label>
            <label>
              <span>{t('auth.password')}</span>
              <div className="input-wrap">
                <span className="input-icon" aria-hidden="true">🔒</span>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="Mot de passe" />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Masquer' : 'Afficher'}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block login-submit" disabled={busy}>
              {busy ? <span className="btn-spinner" aria-hidden="true" /> : null}
              <span>{busy ? t('common.loading') : t('actions.login')}</span>
            </button>
          </form>
          <div className="login-panel-footer">
            <span className="login-lock" aria-hidden="true">🔐</span>
            <span>Accès sécurisé — sessions chiffrées</span>
          </div>
        </section>
      </main>
    </div>
  );
}
