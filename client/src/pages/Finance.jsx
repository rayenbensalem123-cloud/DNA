import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../utils';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';

const LEAGUES = [
  { id: 'ligue1', nom: 'Ligue 1', group: 'Professionnels', desc: 'Ligue Professionnelle 1', weeks: 30 },
  { id: 'ligue2', nom: 'Ligue 2', group: 'Professionnels', desc: 'Ligue Professionnelle 2', weeks: 30 },
  { id: 'c1', nom: 'Amateurs C1', group: 'Amateurs', desc: 'Championnat amateur · groupe C1', weeks: 30 },
  { id: 'c2', nom: 'Amateurs C2', group: 'Amateurs', desc: 'Championnat amateur · groupe C2', weeks: 30 },
];
const FIELD_ROLES = ['Arbitre central', 'Assistant 1', 'Assistant 2', '4e arbitre'];
const VAR_ROLES = ['VAR', 'AVAR 1', 'AVAR 2', 'AVAR 3'];
const EMPTY_SLOTS = () => [{ nom: '' }, { nom: '' }, { nom: '' }, { nom: '' }];

// URL hash navigation (#/finance/<league>/<gameweek>) so the browser Back button works.
const readRoute = () => {
  const m = /^#\/finance\/([a-z0-9]+)(?:\/(\d+))?/.exec(window.location.hash || '');
  const league = m && LEAGUES.some((l) => l.id === m[1]) ? m[1] : null;
  return { league, gameweek: league && m[2] ? Math.min(60, Math.max(1, parseInt(m[2], 10))) : null };
};
const go = (league, gameweek) => {
  const hash = league ? `#/finance/${league}${gameweek ? '/' + gameweek : ''}` : '#/finance';
  if (window.location.hash !== hash) window.history.pushState(null, '', window.location.pathname + hash);
  window.dispatchEvent(new Event('finance-nav'));
};
const longDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return 'Date à fixer';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const dayLabel = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return 'Date à fixer';
  const t = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const initials = (name) => String(name || '?').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const assigned = (m) => [...(m.field || []), ...(m.var || [])].filter((x) => x?.nom).length;
const fullName = (r) => [r.prenom, r.nom].filter(Boolean).join(' ');

function Crumbs({ items }) {
  return (
    <nav className="fin-crumbs" aria-label="Fil d’Ariane">
      {items.map((c, i) => (
        <span key={i}>{i > 0 && <span className="fin-crumb-sep" aria-hidden="true">›</span>}
          {c.onClick ? <button type="button" className="fin-crumb-link" onClick={c.onClick}>{c.label}</button> : <strong>{c.label}</strong>}</span>
      ))}
    </nav>
  );
}

function MatchModal({ league, gameweek, match, referees, teams, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    home: match?.home || '', away: match?.away || '', date: match?.date || '', time: match?.time || '', venue: match?.venue || '',
    field: (match?.field || EMPTY_SLOTS()).map((x) => x.nom || ''), var: (match?.var || EMPTY_SLOTS()).map((x) => x.nom || ''),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setSlot = (key, i, v) => setF((s) => ({ ...s, [key]: s[key].map((x, j) => (j === i ? v : x)) }));
  const byName = useMemo(() => new Map(referees.map((r) => [fullName(r).toLowerCase(), r.id])), [referees]);
  const toSlots = (names) => names.map((n) => ({ nom: n.trim(), refereeId: byName.get(n.trim().toLowerCase()) || null }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const data = { league: league.id, gameweek, home: f.home, away: f.away, date: f.date, time: f.time, venue: f.venue, field: toSlots(f.field), var: toSlots(f.var) };
    try {
      if (match) await api.updateMatch(match.id, data); else await api.createMatch(data);
      onSaved();
    } catch (err) { setError(err.message || 'Erreur'); setBusy(false); }
  };
  const slotInputs = (key, roles) => roles.map((role, i) => (
    <label key={role} className="field">{role}
      <input className="input" list="fin-referees" value={f[key][i]} onChange={(e) => setSlot(key, i, e.target.value)} placeholder="Nom de l’arbitre" maxLength={120} />
    </label>
  ));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal fin-modal" role="dialog" aria-modal="true" onSubmit={save}>
        <header className="modal-head"><h2>{match ? 'Modifier le match' : 'Nouveau match'} · {league.nom} · Journée {gameweek}</h2><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">×</button></header>
        <div className="modal-body">
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="fin-grid2">
            <label className="field">Équipe à domicile<input className="input" list="fin-teams" value={f.home} onChange={(e) => setF({ ...f, home: e.target.value })} required maxLength={80} autoFocus /></label>
            <label className="field">Équipe à l’extérieur<input className="input" list="fin-teams" value={f.away} onChange={(e) => setF({ ...f, away: e.target.value })} required maxLength={80} /></label>
            <label className="field">Date<DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} placeholder="jj/mm/aaaa" /></label>
            <label className="field">Heure<input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
          </div>
          <label className="field">Stade / lieu<input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} maxLength={120} placeholder="ex. Stade Olympique de Radès" /></label>
          <h3 className="fin-modal-h">Arbitres sur le terrain</h3>
          <div className="fin-grid2">{slotInputs('field', FIELD_ROLES)}</div>
          <h3 className="fin-modal-h">Équipe VAR</h3>
          <div className="fin-grid2">{slotInputs('var', VAR_ROLES)}</div>
          <p className="muted small">Choisissez dans la liste des arbitres enregistrés (page Arbitres) ou saisissez un nom. Un arbitre ne peut être désigné qu’une fois par match.</p>
          <datalist id="fin-referees">{referees.map((r) => <option key={r.id} value={fullName(r)} />)}</datalist>
          <datalist id="fin-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement...' : 'Enregistrer'}</button></div>
      </form>
    </div>
  );
}

function MatchDrawer({ match, league, onClose, onEdit, onDelete }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const n = assigned(match);
  const person = (role, slot) => (
    <li key={role} className={slot?.nom ? '' : 'is-empty'}>
      <span className="fin-avatar" aria-hidden="true">{slot?.nom ? initials(slot.nom) : '?'}</span>
      <span className="fin-person"><small>{role}</small><strong>{slot?.nom || 'À désigner'}</strong></span>
    </li>
  );
  return (
    <div className="fin-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="fin-drawer" role="dialog" aria-modal="true" aria-label={`${match.home} contre ${match.away}`}>
        <header className="fin-drawer-head">
          <div><span className="fin-kicker">{league.nom} · Journée {match.gameweek}</span><span className="fin-drawer-date">{dayLabel(match.date)}{match.time ? ' · ' + match.time : ''}</span></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">×</button>
        </header>
        <div className="fin-drawer-versus">
          <div className="fin-club"><span className="fin-crest">{initials(match.home)}</span><strong>{match.home}</strong><small>Domicile</small></div>
          <span className="fin-vs">VS</span>
          <div className="fin-club"><span className="fin-crest alt">{initials(match.away)}</span><strong>{match.away}</strong><small>Extérieur</small></div>
        </div>
        <div className="fin-drawer-venue">📍 {match.venue || 'Stade à confirmer'}</div>
        <div className="fin-drawer-body">
          <section><h3>Arbitres terrain</h3><ul className="fin-people">{FIELD_ROLES.map((r, i) => person(r, match.field?.[i]))}</ul></section>
          <section><h3>Équipe VAR</h3><ul className="fin-people">{VAR_ROLES.map((r, i) => person(r, match.var?.[i]))}</ul></section>
        </div>
        <footer className="fin-drawer-foot">
          <span className={'fin-count' + (n === 8 ? ' is-full' : n === 0 ? ' is-none' : '')}>{n}/8 arbitres désignés</span>
          <div><button type="button" className="btn btn-danger" onClick={onDelete}>Supprimer</button><button type="button" className="btn btn-primary" onClick={onEdit}>Modifier</button></div>
        </footer>
      </aside>
    </div>
  );
}

function LeaguePage({ league, gameweek, onNav }) {
  const [matches, setMatches] = useState([]);
  const [referees, setReferees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | {} (new) | match
  const [confirm, setConfirm] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listMatches(league.id, '').then((d) => setMatches(d.items || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [league.id]);
  useEffect(load, [load]);
  useEffect(() => { api.referees().then((d) => setReferees(d.items || [])).catch(() => {}); }, []);

  const lastPlayed = matches.reduce((m, x) => Math.max(m, x.gameweek), 0);
  const gw = gameweek || lastPlayed || 1;
  useEffect(() => { if (!gameweek && !loading) onNav(league.id, gw); }, [gameweek, loading]);
  const maxWeek = Math.max(league.weeks, lastPlayed);
  const counts = useMemo(() => { const c = {}; matches.forEach((m) => { c[m.gameweek] = (c[m.gameweek] || 0) + 1; }); return c; }, [matches]);
  const list = matches.filter((m) => m.gameweek === gw).sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.time).localeCompare(String(b.time)));
  const days = useMemo(() => { const g = []; list.forEach((m) => { const k = m.date || ''; const last = g[g.length - 1]; if (last && last.k === k) last.items.push(m); else g.push({ k, items: [m] }); }); return g; }, [list]);
  const opened = list.find((m) => m.id === openId) || null;
  const teams = useMemo(() => [...new Set(matches.flatMap((m) => [m.home, m.away]))].sort(), [matches]);

  const remove = async (m) => {
    try { await api.deleteMatch(m.id); setConfirm(null); setOpenId(null); load(); } catch (e) { setError(e.message); setConfirm(null); }
  };

  const headers = [{ key: 'date', label: 'Date' }, { key: 'time', label: 'Heure' }, { key: 'match', label: 'Match' }, { key: 'venue', label: 'Stade' },
    ...FIELD_ROLES.map((r, i) => ({ key: 'f' + i, label: r })), ...VAR_ROLES.map((r, i) => ({ key: 'v' + i, label: r }))];
  const rows = list.map((m) => {
    const o = { date: m.date ? fmtDate(m.date) : '', time: m.time || '', match: `${m.home} - ${m.away}`, venue: m.venue || '' };
    FIELD_ROLES.forEach((_, i) => { o['f' + i] = m.field?.[i]?.nom || ''; }); VAR_ROLES.forEach((_, i) => { o['v' + i] = m.var?.[i]?.nom || ''; });
    return o;
  });
  const doExport = async (kind) => {
    const name = `${league.id}-journee-${gw}`;
    try {
      if (kind === 'csv') downloadCsv(name, headers, rows);
      else if (kind === 'xlsx') await downloadXlsx(name, headers, rows);
      else printPdf({ title: `${league.nom} — Journée ${gw}`, subtitle: 'Désignations arbitrales', headers, rows });
    } catch { /* ignore */ }
  };

  return (
    <>
      <div className="fin-head">
        <div><span className="fin-kicker">{league.group}</span><h1>{league.nom} — Journée {gw}</h1></div>
        <div className="fin-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><span aria-hidden="true">+</span> Ajouter un match</button>
          <div className="export-group" role="group" aria-label="Exporter la journée">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('csv')} disabled={!list.length}>CSV</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('xlsx')} disabled={!list.length}>Excel</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => doExport('pdf')} disabled={!list.length}>PDF</button>
          </div>
        </div>
      </div>

      <div className="fin-gw" role="group" aria-label="Choisir la journée">
        <button type="button" className="btn btn-secondary" onClick={() => onNav(league.id, gw - 1)} disabled={gw <= 1}>‹ Précédente</button>
        <div className="fin-gw-select"><Select ariaLabel="Journée" value={String(gw)} onChange={(v) => onNav(league.id, parseInt(v, 10))}
          options={Array.from({ length: maxWeek }, (_, i) => ({ value: String(i + 1), label: `Journée ${i + 1}` + (counts[i + 1] ? ` · ${counts[i + 1]} match${counts[i + 1] > 1 ? 's' : ''}` : '') }))} /></div>
        <button type="button" className="btn btn-secondary" onClick={() => onNav(league.id, gw + 1)} disabled={gw >= 60}>Suivante ›</button>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loading ? <div className="card card-pad">Chargement...</div> : list.length === 0 ? (
        <div className="card fin-empty-state">
          <div aria-hidden="true" className="fin-empty-ball">⚽</div>
          <h2>Aucun match pour la journée {gw}</h2>
          <p className="muted">Ajoutez les matchs de cette journée avec leurs arbitres.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>+ Ajouter un match</button>
        </div>
      ) : (
        <div className="fin-days">
          <p className="muted small fin-hint">Cliquez sur un match pour voir les arbitres désignés.</p>
          {days.map((d) => (
            <section key={d.k || 'none'} className="fin-day">
              <h3 className="fin-day-title">{dayLabel(d.k)}<span>{d.items.length} match{d.items.length > 1 ? 's' : ''}</span></h3>
              <ul className="fin-rows">{d.items.map((m) => {
                const n = assigned(m);
                return (
                  <li key={m.id}>
                    <button type="button" className="fin-row" onClick={() => setOpenId(m.id)} aria-label={`${m.home} contre ${m.away} — voir les arbitres`}>
                      <span className="fin-time">{m.time || '—'}</span>
                      <span className="fin-row-teams">
                        <span className="fin-row-team"><span className="fin-crest sm">{initials(m.home)}</span>{m.home}</span>
                        <span className="fin-row-vs">vs</span>
                        <span className="fin-row-team"><span className="fin-crest sm alt">{initials(m.away)}</span>{m.away}</span>
                      </span>
                      <span className="fin-row-venue">📍 {m.venue || 'Stade à confirmer'}</span>
                      <span className={'fin-count' + (n === 8 ? ' is-full' : n === 0 ? ' is-none' : '')} title={`${n} arbitres sur 8 désignés`} aria-label={`${n} arbitres sur 8 désignés`}>{n}/8<span className="fin-count-word"> arbitres</span></span>
                      <span className="fin-chevron" aria-hidden="true">›</span>
                    </button>
                  </li>
                );
              })}</ul>
            </section>
          ))}
        </div>
      )}

      {opened && <MatchDrawer match={opened} league={league} onClose={() => setOpenId(null)} onEdit={() => { setEditing(opened); setOpenId(null); }} onDelete={() => { setConfirm(opened); setOpenId(null); }} />}
      {editing && <MatchModal league={league} gameweek={gw} match={editing.id ? editing : null} referees={referees} teams={teams} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {confirm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Supprimer ce match ?</h2><button type="button" className="modal-close" onClick={() => setConfirm(null)} aria-label="Fermer">×</button></header>
            <div className="modal-body"><p>{confirm.home} — {confirm.away} (journée {confirm.gameweek})</p></div>
            <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>Annuler</button><button type="button" className="btn btn-danger" onClick={() => remove(confirm)}>Supprimer</button></div>
          </section>
        </div>
      )}
    </>
  );
}

function Home({ onNav }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.matchSummary().then((d) => setSummary(d.leagues || [])).catch((e) => setError(e.message)); }, []);
  const info = (id) => summary?.find((l) => l.id === id);
  return (
    <>
      <div className="fin-head"><div><span className="fin-kicker">Finance</span><h1>Championnats et journées</h1></div></div>
      <p className="muted fin-intro">Choisissez un championnat pour consulter ou saisir les matchs de chaque journée, avec le lieu, la date et les arbitres (terrain et VAR).</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {['Professionnels', 'Amateurs'].map((group) => (
        <section key={group} className="fin-group">
          <h2 className="fin-group-title">{group}</h2>
          <div className="fin-leagues">{LEAGUES.filter((l) => l.group === group).map((l) => {
            const i = info(l.id); const last = i?.gameweeks?.length ? Math.max(...i.gameweeks) : 0;
            return (
              <button key={l.id} type="button" className={'fin-league fin-league-' + l.id} onClick={() => onNav(l.id, last || 1)}>
                <span className="fin-league-name">{l.nom}</span>
                <span className="fin-league-desc">{l.desc}</span>
                <span className="fin-league-stats">{i ? `${i.matches} match${i.matches > 1 ? 's' : ''} · ${last ? 'dernière journée ' + last : 'aucune journée'}` : '…'}</span>
                <span className="fin-league-go">Ouvrir ›</span>
              </button>
            );
          })}</div>
        </section>
      ))}
    </>
  );
}

export default function Finance({ onBack }) {
  const { user, logout } = useAuth();
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('popstate', sync); window.addEventListener('finance-nav', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('finance-nav', sync); };
  }, []);
  const allowed = user?.role === 'admin' || user?.role === 'daf';
  const league = LEAGUES.find((l) => l.id === route.league) || null;
  const leave = () => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); onBack(); };

  if (!allowed) {
    return <div className="finance-page"><div className="card fin-empty-state"><h2>Accès réservé</h2><p className="muted">Le département Finance est réservé à l’administrateur et au DAF.</p><button type="button" className="btn btn-primary" onClick={leave}>← Retour aux départements</button></div></div>;
  }
  const back = league ? () => window.history.length > 1 ? window.history.back() : go(null) : leave;
  return (
    <div className="finance-page">
      <header className="fin-bar">
        <div className="fin-bar-left">
          <button type="button" className="btn btn-secondary" onClick={back}>← {league ? 'Retour' : 'Départements'}</button>
          <img className="fin-bar-logo" src="/federation-tunisienne-logo.webp" alt="" />
          <div className="fin-bar-title"><strong>Finance</strong><span>Direction Nationale de l’Arbitrage</span></div>
        </div>
        <div className="fin-bar-right">
          <button type="button" className="btn btn-ghost" onClick={leave} title="Changer de département">Départements</button>
          <span className="fin-bar-user">{user?.name}<small>{user?.role === 'daf' ? 'DAF' : 'Administrateur'}</small></span>
          <button type="button" className="btn btn-ghost" onClick={logout}>Déconnexion</button>
        </div>
      </header>
      <main className="fin-main">
        <Crumbs items={[
          { label: 'Départements', onClick: leave },
          { label: 'Finance', onClick: league ? () => go(null) : undefined },
          ...(league ? [{ label: league.nom + (route.gameweek ? ` · Journée ${route.gameweek}` : '') }] : []),
        ]} />
        {league ? <LeaguePage key={league.id} league={league} gameweek={route.gameweek} onNav={go} /> : <Home onNav={go} />}
      </main>
    </div>
  );
}
