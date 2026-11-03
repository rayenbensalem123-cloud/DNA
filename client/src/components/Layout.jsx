import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import ChangePassword from './ChangePassword';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [changingPassword, setChangingPassword] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/logo-ftf.webp"
            alt="Fédération Tunisienne de Football"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="brand-title">{t('app.name')}</div>
          <div className="brand-sub">{t('app.tagline')}</div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/lettres" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            {t('nav.lettres')}
          </NavLink>
          <NavLink to="/reception" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            {t('nav.reception')}
          </NavLink>
        </nav>
        <div className="sidebar-footer">{t('app.name')} © 2026</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div />
          <div className="topbar-right">
            <button className="lang-toggle" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} title="Language / Langue">
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{t('auth.role.' + (user?.role || ''))}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => setChangingPassword(true)}>{t('nav.password')}</button>
            <button className="btn btn-ghost" onClick={onLogout}>{t('nav.logout')}</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
