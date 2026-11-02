import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';

const DEMO = [
  { username: 'admin', password: 'admin123', role: 'admin', label: 'Administrateur' },
  { username: 'agent', password: 'agent123', role: 'agent', label: 'Agent' },
  { username: 'lecture', password: 'lecture123', role: 'lecture', label: 'Lecteur' },
];

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

  const fill = (u, p) => { setUsername(u); setPassword(p); setError(''); };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-title big">Bureau Ordre</div>
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
        <div className="demo-accounts">
          <div className="demo-title">{t('auth.demo')}</div>
          <div className="demo-list">
            {DEMO.map((d) => (
              <button key={d.username} type="button" className="demo-account" onClick={() => fill(d.username, d.password)}>
                <span className="demo-user">{d.username}</span>
                <span className="demo-role">{d.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
