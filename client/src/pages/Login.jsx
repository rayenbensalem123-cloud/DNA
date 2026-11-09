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
    <main className="sign">
      <section className="sign-stage" aria-label="Direction Nationale d’Arbitrage">
        <img className="sign-photo" src="/fond.jpg" alt="" />
        <div className="sign-shade" />
        <div className="sign-identity">
          <img className="sign-emblem" src="/federation-tunisienne-logo.webp" alt="Fédération Tunisienne de Football" />
          <h1>Direction Nationale<br />d’Arbitrage</h1>
          <p>Fédération Tunisienne de Football</p>
        </div>
      </section>

      <section className="sign-panel">
        <form onSubmit={submit} className="sign-form">
          <header>
            <h2>Connexion</h2>
            <p>{t('auth.title')} : accédez au registre du courrier.</p>
          </header>

          <label className="sign-field">
            <span>{t('auth.username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>

          <label className="sign-field">
            <span>{t('auth.password')}</span>
            <div className="sign-password">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" className="sign-reveal" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
                {showPassword ? 'Masquer' : 'Afficher'}
              </button>
            </div>
          </label>

          {error && <div className="sign-error" role="alert">{error}</div>}

          <button className="sign-submit" disabled={busy}>{busy ? t('common.loading') : t('actions.login')}</button>
        </form>
      </section>
    </main>
  );
}
