import { useAuth } from '../auth';

export default function Portal({ onChoose }) {
  const { user, logout } = useAuth();

  const cards = [
    {
      id: 'registre',
      title: 'REGISTRE',
      subtitle: 'GESTION DES COURRIERS',
      icon: '▤',
      badge: 'R',
      image: true,
      accent: 'red',
      description: 'Courriers, arbitres, comptes et suivi de la Direction Nationale de l’Arbitrage',
    },
    {
      id: 'finance',
      title: 'FINANCE',
      subtitle: 'GESTION FINANCIÈRE',
      icon: '◈',
      badge: 'F',
      image: false,
      accent: 'gold',
      description: 'Espace financier — à venir',
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
              className={`portal-card portal-card-${c.accent}${c.image ? ' portal-card-image' : ''}`}
              onClick={() => onChoose(c.id)}
            >
              {c.image && <div className="portal-card-photo" />}
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
                <span className="portal-enter">ENTRER <span aria-hidden="true">›</span></span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <footer className="portal-foot">Fédération Tunisienne de Football — Direction Nationale de l’Arbitrage</footer>
    </div>
  );
}
