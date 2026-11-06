import { useEffect, useState } from 'react';

// Offers "install as an app" when the browser allows it (Chrome/Edge/Android).
// On iPhone/iPad there is no install prompt, so we show the Safari steps instead.
export default function InstallButton() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (event) => { event.preventDefault(); setPrompt(event); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (standalone || installed || (!prompt && !isIos)) return null;
  const install = async () => {
    if (prompt) { prompt.prompt(); try { await prompt.userChoice; } catch { /* ignore */ } setPrompt(null); }
    else setHelp((v) => !v);
  };
  return (
    <div className="install">
      <button type="button" className="btn btn-secondary install-btn" onClick={install}>Installer l’app</button>
      {help && <div className="install-help" role="status">Dans Safari, touchez <strong>Partager</strong> puis <strong>Sur l’écran d’accueil</strong>.</div>}
    </div>
  );
}
