// Full-screen cover shown while the app starts and right after sign-in.
// A referee pulls the yellow and red cards: they fan out from behind the emblem and sway while loading.
export default function Splash({ title, subtitle, label, leaving }) {
  return (
    <div className={'splash' + (leaving ? ' is-leaving' : '')} role="status" aria-live="polite">
      <div className="splash-bg" aria-hidden="true" />
      <div className="splash-stage">
        <div className="splash-cards" aria-hidden="true">
          <span className="splash-card splash-card-yellow" />
          <span className="splash-card splash-card-red" />
          <img className="splash-emblem" src="/federation-tunisienne-logo.webp" alt="" />
        </div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {label && <span className="splash-label">{label}</span>}
        {label && <div className="splash-bar" aria-hidden="true"><i /></div>}
      </div>
    </div>
  );
}
