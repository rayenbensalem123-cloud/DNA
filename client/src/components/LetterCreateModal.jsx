import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import LetterForm from './LetterForm';
import Select from './Select';

export default function LetterCreateModal({ onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialDirection = new URLSearchParams(location.search).get('direction') === 'sortant' ? 'sortant' : 'entrant';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
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

  useEffect(() => {
    api.templates().then((d) => setTemplates(d.items || [])).catch(() => {});
  }, []);

  const applyTemplate = (templateId) => {
    const t = templates.find((tmpl) => tmpl.id === templateId);
    if (!t) return;
    setSelectedTemplate(templateId);
    const evt = new CustomEvent('apply-template', { detail: t });
    document.dispatchEvent(evt);
  };

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (data) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.createLetterWithFiles(data, data.files || []);
      if (user?.role === 'admin') { navigate('/lettres/' + result.item.id, { replace: true }); return; }
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
        {templates.length > 0 && (
          <div style={{ padding: '0 18px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 13, color: '#b2a4a8', margin: 0 }}>Modèle :</label>
            <Select
              ariaLabel="Modèle de courrier"
              value={selectedTemplate}
              onChange={(v) => (v ? applyTemplate(v) : setSelectedTemplate(''))}
              options={[{ value: '', label: '— Aucun —' }, ...templates.map((t) => ({ value: t.id, label: t.nom }))]}
            />
          </div>
        )}
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
