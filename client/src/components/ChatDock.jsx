import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';

const ROLE_COLORS = { admin: '#7c3aed', supervisor: '#0ea5e9', daf: '#f59e0b', chef: '#10b981', agent: '#64748b' };

// Facebook-style floating chat: channel list + conversation + online presence.
// Poll-based (no websockets on this deployment): 3s while a conversation is
// open, 15s when collapsed (badges only).
export default function ChatDock() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // list | chat | online
  const [channel, setChannel] = useState('general');
  const [channelName, setChannelName] = useState('Général');
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState([]);
  const [text, setText] = useState('');
  const [users, setUsers] = useState([]);
  const listRef = useRef(null);
  const lastAtRef = useRef('');

  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';

  const loadSummary = useCallback(async () => {
    try {
      const d = await api.chatChannels();
      setChannels(d.channels || []);
      setOnline(d.online || []);
      return d;
    } catch { return null; }
  }, []);

  // Collapsed: poll badges slowly. Open: poll the open conversation fast.
  useEffect(() => {
    if (!user) return;
    loadSummary();
    const id = setInterval(loadSummary, open ? 8000 : 15000);
    return () => clearInterval(id);
  }, [user, open, loadSummary]);

  // DM suggestions (who I can talk to) — loaded for any authenticated member.
  useEffect(() => {
    if (!user) return;
    api.chatDirectory().then((d) => setUsers((d.items || []).filter((u) => u.id !== user?.id))).catch(() => {});
  }, [user?.id]);

  // Open conversation polling.
  useEffect(() => {
    if (!open || view !== 'chat' || !user) return;
    let cancelled = false;
    lastAtRef.current = '';
    setMessages([]);
    const pull = async (full) => {
      try {
        const d = await api.chat(channel, full ? '' : lastAtRef.current);
        if (cancelled) return;
        const got = d.messages || [];
        if (got.length) {
          lastAtRef.current = got[got.length - 1].createdAt;
          setMessages((current) => (full ? got : [...current, ...got]).slice(-200));
        }
        setOnline(d.online || []);
        api.markChatRead(channel).catch(() => {});
      } catch { /* transient */ }
    };
    pull(true);
    const id = setInterval(() => pull(false), 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [open, view, channel, user?.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, view]);

  if (!user) return null;

  const send = async (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const d = await api.sendChat(channel, body);
      setMessages((current) => [...current, d.item].slice(-200));
      lastAtRef.current = d.item.createdAt;
    } catch (e) {
      setText(body); // restore so the user can retry
    }
  };

  const openChannel = (c) => {
    setChannel(c.id);
    setChannelName(c.name);
    setView('chat');
    loadSummary();
  };

  const openDm = async (target) => {
    const ids = [user.id, target.id].sort();
    const id = `dm:${ids[0]}:${ids[1]}`;
    setChannel(id);
    setChannelName(target.name);
    setView('chat');
    loadSummary();
  };

  const totalUnread = channels.reduce((acc, c) => acc + (c.unread ? 1 : 0), 0);
  const committee = (id) => channels.find((c) => c.id === id)?.name || '';

  return (
    <div className={'chat-dock' + (open ? ' open' : '')}>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Messagerie">
          <header className="chat-panel-head">
            {view !== 'list' && <button type="button" className="chat-back" onClick={() => setView('list')} aria-label="Retour">‹</button>}
            <div className="chat-panel-title">
              {view === 'chat' ? <><span className="chat-title-name">{channelName}</span><span className="chat-title-sub">{channel.startsWith('dm:') ? 'Message privé' : channel === 'general' ? 'Canal général' : 'Canal comité'}</span></>
                : view === 'online' ? <><span className="chat-title-name">En ligne</span><span className="chat-title-sub">{online.length} connecté{online.length > 1 ? 's' : ''}</span></>
                  : <><span className="chat-title-name">Messages</span><span className="chat-title-sub">Discussions de la plateforme</span></>}
            </div>
            <button type="button" className="chat-minimize" onClick={() => setOpen(false)} aria-label="Réduire">—</button>
          </header>

          {view === 'list' && (
            <div className="chat-body">
              <div className="chat-online-strip" role="list" aria-label="En ligne">
                {online.slice(0, 12).map((p) => (
                  <button type="button" key={p.userId} className="chat-avatar-btn" title={p.name} onClick={() => openDm({ id: p.userId, name: p.name })}>
                    <span className="chat-avatar" style={{ background: ROLE_COLORS[p.role] || '#64748b' }}>{(p.name || '?').slice(0, 1).toUpperCase()}<i className="chat-presence-dot" /></span>
                  </button>
                ))}
                {online.length === 0 && <span className="chat-online-empty">Personne en ligne</span>}
              </div>
              <div className="chat-channel-list">
                {channels.map((c) => (
                  <button type="button" key={c.id} className={'chat-channel' + (c.unread ? ' unread' : '')} onClick={() => openChannel(c)}>
                    <span className="chat-channel-icon">{c.type === 'general' ? '💬' : c.type === 'dm' ? '👤' : '👥'}</span>
                    <span className="chat-channel-name">{c.name}</span>
                    {c.unread > 0 && <span className="chat-unread-badge">{c.unread}</span>}
                  </button>
                ))}
              </div>
              {users.length > 0 && (
                <div className="chat-dm-section">
                  <div className="chat-section-label">Nouvelle discussion</div>
                  <div className="chat-dm-list">
                    {users.map((u) => (
                      <button type="button" key={u.id} className="chat-dm-user" onClick={() => openDm(u)}>
                        <span className="chat-avatar" style={{ background: ROLE_COLORS[u.role] || '#64748b' }}>{(u.name || '?').slice(0, 1).toUpperCase()}</span>
                        <span className="chat-dm-name">{u.name}</span>
                        {online.some((p) => p.userId === u.id) && <i className="chat-presence-dot in-list" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="chat-online-link" onClick={() => setView('online')}>Voir qui est en ligne ({online.length})</button>
            </div>
          )}

          {view === 'chat' && (
            <>
              <div className="chat-messages" ref={listRef}>
                {messages.map((m) => {
                  const mine = m.userId === user.id;
                  return (
                    <div key={m.id} className={'chat-msg' + (mine ? ' mine' : '')}>
                      {!mine && <span className="chat-avatar small" style={{ background: ROLE_COLORS[m.userRole] || '#64748b' }}>{(m.userName || '?').slice(0, 1).toUpperCase()}</span>}
                      <div className="chat-bubble">
                        {!mine && <span className="chat-msg-name" style={{ color: ROLE_COLORS[m.userRole] }}>{m.userName}{m.commission ? ` · ${committee('comite:' + m.commission)}` : ''}</span>}
                        <div className="chat-msg-text">{m.text}</div>
                        <span className="chat-msg-time">{new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <div className="chat-empty">Aucun message — lancez la conversation !</div>}
              </div>
              <form className="chat-input-row" onSubmit={send}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message à ${channelName}…`} aria-label="Votre message" maxLength={2000} />
                <button type="submit" className="chat-send" disabled={!text.trim()} aria-label="Envoyer">➤</button>
              </form>
            </>
          )}

          {view === 'online' && (
            <div className="chat-body">
              <div className="chat-online-list">
                {online.map((p) => (
                  <div key={p.userId} className="chat-online-row">
                    <span className="chat-avatar" style={{ background: ROLE_COLORS[p.role] || '#64748b' }}>{(p.name || '?').slice(0, 1).toUpperCase()}<i className="chat-presence-dot" /></span>
                    <div className="chat-online-meta"><strong>{p.name}</strong><span className="muted">{p.role === 'admin' ? 'Administration' : p.role === 'supervisor' ? 'Superviseur' : p.role === 'daf' ? 'DAF' : p.commission ? committee('comite:' + p.commission) : ''}</span></div>
                    {p.userId !== user.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDm({ id: p.userId, name: p.name })}>Message</button>}
                  </div>
                ))}
                {online.length === 0 && <div className="chat-empty">Personne en ligne pour l’instant.</div>}
              </div>
            </div>
          )}
        </div>
      )}
      <button type="button" className={'chat-bubble-btn' + (totalUnread ? ' has-unread' : '')} onClick={() => { setOpen((v) => !v); setView('list'); }} aria-label="Ouvrir la messagerie">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10.5H10L6 20v-4H4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8.5 9.5h7M8.5 12.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        {totalUnread > 0 && <span className="chat-bubble-badge">{totalUnread}</span>}
      </button>
    </div>
  );
}
