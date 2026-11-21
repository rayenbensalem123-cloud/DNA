import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const PAGES = [
  { label: 'Tableau de bord', path: '/', keywords: 'dashboard accueil' },
  { label: 'Courriers à valider', path: '/courrier', keywords: 'courrier valider scan.validation' },
  { label: 'Registres', path: '/registres', keywords: 'registre arrivee depart archive' },
  { label: 'Comptes', path: '/comptes', keywords: 'comptes employes utilisateurs' },
  { label: 'Journal d’activité', path: '/activite', keywords: 'activite journal log' },
  { label: 'Gmail', path: '/gmail', keywords: 'gmail mail boite' },
  { label: 'Modèles', path: '/modeles', keywords: 'modeles templates' },
];

export default function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ courriers: [], comptes: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';

  useEffect(() => {
    if (!open) return;
    setQ(''); setResults({ courriers: [], comptes: [] });
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults({ courriers: [], comptes: [] }); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q).then((d) => { if (!cancelled) setResults(d); }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  if (!open) return null;

  const pages = q.trim().length >= 1
    ? PAGES.filter((p) => (p.label + ' ' + p.keywords).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))
    : PAGES;

  const go = (path) => { onClose(); navigate(path); };

  return (
    <div className="gs-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gs-panel" role="dialog" aria-modal="true" aria-label="Recherche globale">
        <div className="gs-input-row">
          <span className="gs-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder="Rechercher courrier, compte, page…"
            aria-label="Rechercher"
          />
          <button type="button" className="gs-esc" onClick={onClose}>ESC</button>
        </div>
        <div className="gs-results">
          {pages.length > 0 && (
            <div className="gs-group">
              <div className="gs-group-title">Pages</div>
              {pages.map((p) => (
                <button key={p.path} type="button" className="gs-item" onClick={() => go(p.path)}>
                  <span className="gs-item-icon">▦</span>
                  <span className="gs-item-label">{p.label}</span>
                  <span className="gs-item-hint">{p.path}</span>
                </button>
              ))}
            </div>
          )}
          {results.courriers.length > 0 && (
            <div className="gs-group">
              <div className="gs-group-title">Courriers</div>
              {results.courriers.map((c) => (
                <button key={c.id} type="button" className="gs-item" onClick={() => go('/lettres/' + c.id)}>
                  <span className="gs-item-icon">✉️</span>
                  <span className="gs-item-label">{c.ref} — {c.objet}</span>
                  <span className="gs-item-hint">{c.statut}</span>
                </button>
              ))}
            </div>
          )}
          {results.comptes.length > 0 && (
            <div className="gs-group">
              <div className="gs-group-title">Comptes</div>
              {results.comptes.map((c) => (
                <button key={c.id} type="button" className="gs-item" onClick={() => go('/comptes')}>
                  <span className="gs-item-icon">👤</span>
                  <span className="gs-item-label">{c.name} ({c.username})</span>
                  <span className="gs-item-hint">{c.role}</span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !loading && !results.courriers.length && !results.comptes.length && pages.length === 0 && (
            <div className="gs-empty">Aucun résultat pour « {q} ».</div>
          )}
          {loading && <div className="gs-empty">Recherche…</div>}
        </div>
        <div className="gs-foot">Astuce : appuyez sur <kbd>Ctrl</kbd> + <kbd>K</kbd> pour ouvrir la recherche</div>
      </div>
    </div>
  );
}
