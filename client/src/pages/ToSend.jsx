import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../utils';

// Scans the supervisor validated: the admin chooses the comité that must receive each one.
export default function ToSend() {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState([]);
  const [sent, setSent] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, c] = await Promise.all([api.toSend(), api.committees()]);
      setWaiting(d.waiting || []);
      setSent(d.sent || []);
      setCommittees(c.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const draft = (item) => ({ objet: item.objet, priorite: item.priorite || 'normale', commission: '', ...(drafts[item.id] || {}) });
  const setField = (item, key, value) => setDrafts((all) => ({ ...all, [item.id]: { ...draft(item), [key]: value } }));
  const nameOf = (id) => committees.find((c) => c.id === id)?.nom || id;

  const send = async (item) => {
    const d = draft(item);
    if (!d.commission) { setError('Choisissez le comité destinataire.'); return; }
    setBusyId(item.id); setError(''); setNotice('');
    try {
      await api.updateLetter(item.id, { commission: d.commission, objet: d.objet.trim() || item.objet, priorite: d.priorite });
      setNotice(`« ${d.objet || item.objet} » envoyé au comité ${nameOf(d.commission)}.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  };

  const open = async (item) => {
    try { await api.openPiece(item.id, item.pieceId, item.fileName || item.ref || item.objet || 'Pièce jointe'); } catch (e) { setError(e.message); }
  };

  return (
    <div className="page tosend-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy">
          <span className="page-title-kicker">Courrier validé</span>
          <h1>À envoyer</h1>
          <p className="muted">Choisissez le comité qui doit recevoir chaque courrier validé par le superviseur.</p>
        </div>
      </header>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {loading ? <div className="card card-pad">Chargement…</div> : (
        <>
          {waiting.length === 0 ? (
            <div className="card card-pad empty-state">Aucun courrier en attente d’envoi. Les courriers validés par le superviseur apparaissent ici.</div>
          ) : waiting.map((item) => {
            const d = draft(item);
            return (
              <section className="card send-card" key={item.id}>
                <div className="send-card-head">
                  <div>
                    <div className="send-file">{item.fileName || item.ref}</div>
                    <div className="muted small">{item.ref} · validé{item.validatedBy ? ` par ${item.validatedBy}` : ''} le {fmtDate(item.validatedAt)}{item.uploadedByName ? ` · ajouté par ${item.uploadedByName}` : ''}</div>
                  </div>
                  {item.pieceId && <button type="button" className="btn btn-secondary" onClick={() => open(item)}>Ouvrir le fichier</button>}
                </div>
                <div className="send-form">
                  <label className="filter-field send-wide"><span>Objet</span><input value={d.objet} maxLength={300} onChange={(event) => setField(item, 'objet', event.target.value)} /></label>
                  <label className="filter-field"><span>Comité destinataire</span>
                    <select value={d.commission} onChange={(event) => setField(item, 'commission', event.target.value)}>
                      <option value="">— Choisir un comité —</option>
                      {committees.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </label>
                  <label className="filter-field"><span>Importance</span>
                    <select value={d.priorite} onChange={(event) => setField(item, 'priorite', event.target.value)}>
                      <option value="normale">Normale</option><option value="urgente">Urgente</option><option value="confidentielle">Confidentielle</option>
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary" disabled={busyId === item.id || !d.commission} onClick={() => send(item)}>{busyId === item.id ? 'Envoi…' : 'Envoyer'}</button>
                </div>
              </section>
            );
          })}

          {sent.length > 0 && (
            <section className="card card-pad">
              <h2 className="card-title">Envoyés récemment</h2>
              <ul className="sent-list">
                {sent.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="link-button" onClick={() => navigate('/lettres/' + item.id)}>{item.objet || item.ref}</button>
                    <span className="muted small">→ {nameOf(item.commission)}{item.sentAt ? ` · ${fmtDate(item.sentAt)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
