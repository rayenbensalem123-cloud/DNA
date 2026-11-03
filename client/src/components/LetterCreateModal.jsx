import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import LetterForm from './LetterForm';

export default function LetterCreateModal({ onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDirection = new URLSearchParams(location.search).get('direction') === 'sortant' ? 'sortant' : 'entrant';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      navigate('/lettres/' + result.item.id, { replace: true });
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
        <LetterForm initialDirection={initialDirection} onSubmit={submit} onCancel={close} busy={busy} error={error} />
      </section>
    </div>
  );
}
