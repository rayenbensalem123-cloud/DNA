import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { fmtDateTime } from '../utils';

// Shows how many letters reached the user's comité and have not been opened yet.
export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [committees, setCommittees] = useState([]);
  const box = useRef(null);

  const load = useCallback(() => { api.notifications().then(setData).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load, location.pathname]);
  useEffect(() => { const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { api.committees().then((d) => setCommittees(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false); };
    const esc = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const nameOf = (id) => committees.find((c) => c.id === id)?.nom;
  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-btn" onClick={() => { setOpen((v) => !v); load(); }} aria-label={`Notifications : ${data.unread} nouveau${data.unread > 1 ? 'x' : ''} courrier${data.unread > 1 ? 's' : ''}`} aria-expanded={open}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" /></svg>
        {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Nouveaux courriers">
          <div className="bell-head">Nouveaux courriers</div>
          {data.items.length === 0 ? <div className="bell-empty">Aucun nouveau courrier.</div> : (
            <ul>{data.items.map((item) => (
              <li key={item.id}><button type="button" onClick={() => { setOpen(false); navigate('/lettres/' + item.id); }}>
                <span className="bell-subject">{item.objet || item.ref}</span>
                <span className="bell-meta">{item.fromCommittee ? `De ${nameOf(item.fromCommittee) || item.fromCommittee}` : (item.byName ? `De ${item.byName}` : 'Reçu')} · {fmtDateTime(item.date)}{item.priorite === 'urgente' ? ' · Urgent' : ''}</span>
              </button></li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}
