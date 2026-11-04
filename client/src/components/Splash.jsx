// Full-screen cover shown while the app starts and right after sign-in.
// The red line is the halfway line of a pitch: it draws out from the centre circle,
// then the screen opens along that line like gates.
export default function Splash({ title, subtitle, label, leaving }) {
  return (
    <div className={'splash' + (leaving ? ' is-leaving' : '')} role="status" aria-live="polite">
      <div className="splash-half splash-top" />
      <div className="splash-half splash-bottom" />
      <div className="splash-line" />
      <div className="splash-center">
        <span className="splash-pulse" />
        <span className="splash-pulse splash-pulse-late" />
        <span className="splash-circle" />
        <img className="splash-emblem" src="/federation-tunisienne-logo.webp" alt="" />
      </div>
      <div className="splash-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {label && <span className="splash-label">{label}</span>}
      </div>
    </div>
  );
}
