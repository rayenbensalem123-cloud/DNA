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
      <div className="login-card">
        <div className="login-brand">
          <img
            className="brand-logo big"
            src="/logo-ftf.webp"
            alt="Fédération Tunisienne de Football"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="brand-title big">{t('app.name')}</div>
          <div className="brand-sub">{t('auth.subtitle')}</div>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            {t('auth.username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            {t('auth.password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('actions.login')}
          </button>
        </form>
      </div>
    </div>
  );
}
