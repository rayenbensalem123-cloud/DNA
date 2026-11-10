import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

window.__errs = [];
window.addEventListener('error', (e) => {
  window.__errs.push({ msg: e.message, src: e.filename, line: e.lineno, time: Date.now() });
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errs.push({ msg: 'REJECTION: ' + String(e.reason && e.reason.message ? e.reason.message : e.reason) });
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // updateViaCache:'none' so the browser always rechecks sw.js itself,
    // and every reload fetches the fresh index.html (network-first in sw).
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => reg.update().catch(() => {})).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);

