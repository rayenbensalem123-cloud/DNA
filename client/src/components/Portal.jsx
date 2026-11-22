import { useAuth } from '../auth';

export default function Portal({ onChoose, canFinance = false }) {
  const { user, logout } = useAuth();

  const cards = [
    {
      id: 'registre',
      title: 'REGISTRE',
      subtitle: 'GESTION DES COURRIERS',
      icon: '▤',
      badge: 'R',
      motif: 'documents',
      accent: 'red',
      description: 'Courriers, arbitres, comptes et suivi de la Direction Nationale de l’Arbitrage',
    },
    {
      id: 'finance',
      title: 'FINANCE',
      subtitle: 'GESTION FINANCIÈRE',
      icon: '◈',
      badge: 'F',
      motif: 'finance',
      accent: 'gold',
      description: 'Championnats, journées, matchs et désignations arbitrales — réservé à l’admin et au DAF',
    },
  ];

  return (
    <div className="portal">
      <div className="portal-bg" />
      <div className="portal-overlay" />
      <header className="portal-top">
        <div className="portal-top-right">
          <span className="portal-role">{user?.role === 'admin' ? 'ADMIN' : (user?.role || '').toUpperCase()}</span>
          <span className="portal-user">{user?.name || ''}</span>
          <button type="button" className="portal-logout" onClick={logout} title="Déconnexion">⇥</button>
        </div>
      </header>
      <div className="portal-content">
        <img className="portal-emblem" src="/federation-tunisienne-logo.webp" alt="FTF" />
        <h1 className="portal-title">DIRECTION NATIONALE<br/>DE L’ARBITRAGE</h1>
        <div className="portal-kicker">FÉDÉRATION TUNISIENNE DE FOOTBALL</div>
        <div className="portal-subtitle">SÉLECTIONNEZ UN DÉPARTEMENT</div>
        <div className="portal-cards">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`portal-card portal-card-${c.accent} portal-card-${c.motif}`}
              onClick={() => { if (c.id === 'finance' && !canFinance) return; onChoose(c.id); }}
              disabled={c.id === 'finance' && !canFinance}
              title={c.id === 'finance' && !canFinance ? 'Réservé à l’administrateur et au DAF' : undefined}
            >
              <div className="portal-card-motif" aria-hidden="true">
                {c.motif === 'documents' ? (
                  <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2"><path d="M30 18h44l16 16v68H30z" rx="3"/><path d="M74 18v16h16"/><path d="M42 50h36M42 62h36M42 74h24"/><circle cx="84" cy="86" r="12"/><path d="M84 80v12M78 86h12"/></svg>
                ) : (
                  <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="2"><rect x="18" y="30" width="84" height="60" rx="6"/><path d="M34 50h20v20H34zM62 50h24M62 60h24M62 70h16"/><path d="M48 30v-8M72 30v-8"/></svg>
                )}
              </div>
              <div className="portal-card-shade" />
              <div className="portal-card-top">
                <span className="portal-card-badge">{c.badge}</span>
                <span className="portal-card-tag">{c.id === 'registre' ? 'DNA · FTF' : 'DNA · FINANCE'}</span>
              </div>
              <div className="portal-card-bottom">
                <div className="portal-card-icon" aria-hidden="true">{c.icon}</div>
                <div className="portal-card-title">{c.title}</div>
                <div className="portal-card-sub">{c.subtitle}</div>
                <div className="portal-card-desc">{c.description}</div>
                <span className="portal-enter">{c.id === 'finance' && !canFinance ? 'ACCÈS RÉSERVÉ' : 'ENTRER'} <span aria-hidden="true">›</span></span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <footer className="portal-foot">Fédération Tunisienne de Football — Direction Nationale de l’Arbitrage</footer>
    </div>
  );
}
