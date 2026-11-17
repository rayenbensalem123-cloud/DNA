import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import LetterCreateModal from './LetterCreateModal';
import PdfViewer from './PdfViewer';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';
import InstallButton from './InstallButton';
import ChatDock from './ChatDock';
import { useState, useEffect } from 'react';
import { api } from '../api';

function NavIcon({ type }) {
  if (type === 'dashboard') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>;
  if (type === 'letters') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4.5 4.5v12.5H7z" /><path d="M14 3.5V8h4.5M10 12h5M10 15.5h5" /></svg>;
  if (type === 'send') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4.5 16-3.5-6.5z" /><path d="M12 13.5 20 4" /></svg>;
  if (type === 'inbox') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.5 6.5 5h11l3 8.5v5.5h-17z" /><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" /></svg>;
  if (type === 'reject') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
  if (type === 'activity') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" /></svg>;
  if (type === 'users') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.3-3.1 2.3-5 5.5-5s5.2 1.9 5.5 5M16 5.3a3.1 3.1 0 0 1 0 5.9M17 14c2.2.6 3.4 2.2 3.6 4.5" /></svg>;
  if (type === 'registre') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14v17H5zM5 8h14M9.5 3.5v17" /><path d="M12 12h4.5M12 15.5h4.5" /></svg>;
  if (type === 'mail') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>;
  if (type === 'chat') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10.5H10L6 20v-4H4.5z" /><path d="M8.5 9.5h7M8.5 12.5h4.5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v11h-17zM3.5 8.5l2-4h13l2 4" /><path d="M8 12.5h8M12 12.5v4" /></svg>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const perms = user?.permissions || {};
  const isAdminLike = user?.role === 'admin' || user?.role === 'supervisor';
  const isBureauLike = isAdminLike || user?.role === 'daf';
  const allowed = (perm) => isBureauLike || Boolean(perms[perm]);
  const canAdd = allowed('create');
  const showLetterModal = canAdd && new URLSearchParams(location.search).get('newLetter') === '1';

  const [rejectionUnread, setRejectionUnread] = useState(0);
  const [toSendCount, setToSendCount] = useState(0);
  const [transferCount, setTransferCount] = useState(0);
  const [gmailUnread, setGmailUnread] = useState(0);
  useEffect(() => {
    if (!user) return;
    const load = () => api.courrierNotifications().then((d) => setRejectionUnread((d.items || []).filter((n) => !n.read).length)).catch(() => {});
    const loadToSend = () => { if (isBureauLike) api.toSend().then((d) => setToSendCount((d.waiting || []).length)).catch(() => {}); };
    const loadTransfers = () => { if (isBureauLike) api.transferRequests().then((d) => setTransferCount((d.items || []).length)).catch(() => {}); };
    const loadGmail = () => { if (isBureauLike) api.gmailUnread().then((s) => (s.configured ? api.gmailMessages().then((d) => setGmailUnread(d.unread || 0)) : setGmailUnread(0))).catch(() => {}); };
    load(); loadToSend(); loadTransfers(); loadGmail();
    const timer = setInterval(() => { load(); loadToSend(); loadTransfers(); loadGmail(); }, 30000);
    return () => clearInterval(timer);
  }, [user, location.pathname]);

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
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="dashboard" /><span className="nav-text">{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/archive" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="letters" /><span className="nav-text">Archive{transferCount > 0 && <span className="nav-badge" title={`${transferCount} transfert${transferCount > 1 ? 's' : ''} en attente`}>{transferCount}</span>}</span>
          </NavLink>
          {allowed('courriers') && <NavLink to="/courrier" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="inbox" /><span className="nav-text">Courrier</span>
          </NavLink>}
          {isBureauLike && <NavLink to="/a-envoyer" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="send" /><span className="nav-text">À envoyer{toSendCount > 0 && <span className="nav-badge">{toSendCount}</span>}</span>
          </NavLink>}
          {isBureauLike && <NavLink to="/courriers-rejetes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="reject" /><span className="nav-text">Rejetés</span>
          </NavLink>}
          {(isBureauLike || Boolean(user?.commission)) && <NavLink to={user?.commission && !isBureauLike ? `/registres/${encodeURIComponent(user.commission)}` : '/registres'} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="registre" /><span className="nav-text">{isBureauLike ? 'Registres' : 'Registre'}</span>
          </NavLink>}
          {allowed('users') && <NavLink to="/comptes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="users" /><span className="nav-text">Comptes</span>
          </NavLink>}
          {allowed('journal') && <NavLink to="/activite" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="activity" /><span className="nav-text">Journal d’activité</span>
          </NavLink>}
          {isBureauLike && <NavLink to="/gmail" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <NavIcon type="mail" /><span className="nav-text">Gmail{gmailUnread > 0 && <span className="nav-badge">{gmailUnread}</span>}</span>
          </NavLink>}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-brand"><img src="/federation-tunisienne-logo.webp" alt="" /><span>Bureau d’ordre</span></div>
          <div className="topbar-left">
            {canAdd && <button className="btn btn-primary btn-add" type="button" aria-label="Ajouter un courrier" onClick={() => navigate('/?newLetter=1')}>
              <span className="plus" aria-hidden="true">+</span><span className="btn-label">Ajouter un courrier</span>
            </button>}
            {allowed('courriers') && <button className="btn btn-secondary" type="button" onClick={() => navigate('/courrier')}>
              Courrier {rejectionUnread > 0 && <span className="nav-badge" aria-label={`${rejectionUnread} non lu(s)`}>{rejectionUnread}</span>}
            </button>}
          </div>
          <div className="topbar-right">
            <NotificationBell />
            <InstallButton />
            <ThemeToggle />
            {user && <div className="user-info">
              <span className="user-avatar" aria-hidden="true">{(user.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'}</span>
              <div className="user-meta">
                <div className="user-name">{user.name}</div>
                <span className={'user-role role-' + (user.role || 'agent')}>{t('auth.role.' + (user.role || ''))}</span>
              </div>
            </div>}
            <button className="btn btn-ghost btn-logout" onClick={onLogout} aria-label={t('nav.logout')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.5H5.5v15H10M14 8l4 4-4 4M18 12H9" /></svg><span className="btn-label">{t('nav.logout')}</span></button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {canAdd && <button className="fab" type="button" aria-label="Ajouter un courrier" onClick={() => navigate('/?newLetter=1')}><span aria-hidden="true">+</span></button>}
      {showLetterModal && (
        <LetterCreateModal onClose={() => navigate(location.pathname, { replace: true })} />
      )}
      <PdfViewer />
      <ChatDock />
    </div>
  );
}
