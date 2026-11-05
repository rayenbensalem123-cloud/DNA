import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import LetterForm from './LetterForm';

export default function LetterCreateModal({ onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDirection = new URLSearchParams(location.search).get('direction') === 'sortant' ? 'sortant' : 'entrant';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (data) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.createLetterWithFiles(data, data.files || []);
      if (user?.role === 'admin') { navigate('/lettres/' + result.item.id, { replace: true }); return; }
      // A comité account cannot open a letter it sent to another comité: confirm instead.
      let name = result.item.commission;
      try { name = ((await api.committees()).items || []).find((c) => c.id === result.item.commission)?.nom || name; } catch { /* keep id */ }
      setSent(name);
      setBusy(false);
    } catch (submitError) {
      setError(submitError.message || 'Erreur');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="letter-modal-title">
        <header className="modal-head">
          <h2 id="letter-modal-title">Nouveau courrier</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Fermer" disabled={busy}>×</button>
        </header>
        {sent ? (
          <div className="sent-panel" role="status">
            <h3>Lettre envoyée</h3>
            <p>Le courrier a été envoyé au comité « {sent} ».</p>
            <div className="page-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button></div>
          </div>
        ) : <LetterForm initialDirection={initialDirection} onSubmit={submit} onCancel={close} busy={busy} error={error} />}
      </section>
    </div>
  );
}
