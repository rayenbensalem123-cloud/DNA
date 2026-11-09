import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import LetterCreateModal from './LetterCreateModal';
import ThemeToggle from './ThemeToggle';
import { useState, useEffect } from 'react';
import { api } from '../api';

function NavIcon({ type }) {
  if (type === 'dashboard') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>;
  if (type === 'letters') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M10 12h5M10 15.5h5" /></svg>;
  if (type === 'users') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.3-3.1 2.3-5 5.5-5s5.2 1.9 5.5 5M16 5.3a3.1 3.1 0 0 1 0 5.9M17 14c2.2.6 3.4 2.2 3.6 4.5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v11h-17zM3.5 8.5l2-4h13l2 4" /><path d="M8 12.5h8M12 12.5v4" /></svg>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const showLetterModal = user?.role === 'admin' && new URLSearchParams(location.search).get('newLetter') === '1';
  const isAdminLike = user?.role === 'admin' || user?.role === 'supervisor';
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = () => api.notifications().then((d) => setNotifications(d.items || [])).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [user]);

  const unread = notifications.filter((n) => !n.read).length;

  const markRead = async (n) => {
    try { await api.markNotificationRead(n.id); } catch {}
    setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
    if (n.courrierId) navigate('/courriers-rejetes');
  };

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
          {isAdminLike && <NavLink to="/courrier" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="letters" /><span className="nav-text">Courrier</span>
          </NavLink>}
          {isAdminLike && <NavLink to="/courriers-rejetes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="letters" /><span className="nav-text">Rejetés</span>
          </NavLink>}
          {user?.role === 'admin' && <NavLink to="/comptes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="users" /><span className="nav-text">Comptes</span>
          </NavLink>}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {user?.role === 'admin' && <button className="btn btn-primary btn-add" type="button" onClick={() => navigate('/?newLetter=1')}>
              <span className="plus" aria-hidden="true">+</span> Ajouter un courrier
            </button>}
            {isAdminLike && <button className="btn btn-secondary" type="button" onClick={() => navigate('/courrier')}>
              Courrier
            </button>}
          </div>
          <div className="topbar-right">
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" onClick={() => setShowNotifs((v) => !v)} style={{ position: 'relative' }}>
                🔔
                {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{unread}</span>}
              </button>
              {showNotifs && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, width: 320, maxHeight: 360, overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.3)', zIndex: 50, padding: 8 }}>
                  <div style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)' }}>Notifications</div>
                  {notifications.length === 0 && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>Aucune notification</div>}
                  {notifications.map((n) => (
                    <div key={n.id} onClick={() => markRead(n)} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: n.read ? 'transparent' : 'rgba(230,0,27,.06)', fontSize: 13 }}>
                      <div style={{ fontWeight: n.read ? 400 : 600 }}>{n.message}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

