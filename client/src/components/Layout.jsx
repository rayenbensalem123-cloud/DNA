import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import LetterCreateModal from './LetterCreateModal';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';

function NavIcon({ type }) {
  if (type === 'dashboard') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>;
  if (type === 'letters') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M10 12h5M10 15.5h5" /></svg>;
  if (type === 'activity') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" /></svg>;
  if (type === 'users') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.3-3.1 2.3-5 5.5-5s5.2 1.9 5.5 5M16 5.3a3.1 3.1 0 0 1 0 5.9M17 14c2.2.6 3.4 2.2 3.6 4.5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v11h-17zM3.5 8.5l2-4h13l2 4" /><path d="M8 12.5h8M12 12.5v4" /></svg>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const canAdd = user?.role === 'admin' || user?.role === 'agent';
  const showLetterModal = canAdd && new URLSearchParams(location.search).get('newLetter') === '1';

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-emblem" src="/federation-tunisienne-logo.webp" alt="" />
          <div className="brand-copy">
            <div className="brand-title">Direction Nationale<br />d’Arbitrage</div>
            <div className="brand-sub">Fédération Tunisienne de Football</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="dashboard" /><span className="nav-text">{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/archive" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="letters" /><span className="nav-text">Archive</span>
          </NavLink>
          {user?.role === 'admin' && <NavLink to="/comptes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="users" /><span className="nav-text">Comptes</span>
          </NavLink>}
          {user?.role === 'admin' && <NavLink to="/activite" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="activity" /><span className="nav-text">Journal d’activité</span>
          </NavLink>}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {canAdd && <button className="btn btn-primary btn-add" type="button" onClick={() => navigate('/?newLetter=1')}>
              <span className="plus" aria-hidden="true">+</span> Ajouter un courrier
            </button>}
          </div>
          <div className="topbar-right">
            {user?.role === 'agent' && <NotificationBell />}
            <ThemeToggle />
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{t('auth.role.' + (user?.role || ''))}</div>
            </div>
            <button className="btn btn-ghost" onClick={onLogout}>{t('nav.logout')}</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {showLetterModal && (
        <LetterCreateModal onClose={() => navigate(location.pathname, { replace: true })} />
      )}
    </div>
  );
}

