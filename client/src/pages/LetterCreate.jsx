import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import LetterForm from '../components/LetterForm';
import Select from '../components/Select';

export default function LetterCreate() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const submit = async (data) => {
    setBusy(true);
    setError('');
    try {
      const d = await api.createLetterWithFiles(data, data.files || []);
      navigate('/lettres/' + d.item.id, { replace: true });
    } catch (e) {
      setError(e.message || 'Erreur');
      setBusy(false);
    }
  };

  useEffect(() => {
    api.templates().then((d) => setTemplates(d.items || [])).catch(() => {});
  }, []);

  const applyTemplate = (templateId) => {
    const t = templates.find((tmpl) => tmpl.id === templateId);
    if (!t) return;
    setSelectedTemplate(templateId);
    // Pre-fill via the form is handled by initialLetter on the form component;
    // here we notify through a custom event on the form element.
    const evt = new CustomEvent('apply-template', { detail: t });
    document.dispatchEvent(evt);
  };

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>Nouvelle correspondance</h1>
      </div>
      {templates.length > 0 && (
        <div className="card-pad" style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#b2a4a8' }}>
            Modèle :{' '}
            <Select
              ariaLabel="Modèle de courrier"
              value={selectedTemplate}
              onChange={(v) => (v ? applyTemplate(v) : setSelectedTemplate(''))}
              options={[{ value: '', label: '— Aucun —' }, ...templates.map((t) => ({ value: t.id, label: t.nom }))]}
            />
            <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
              {templates.length} modèle{templates.length > 1 ? 's' : ''} disponible{templates.length > 1 ? 's' : ''}
            </span>
          </label>
        </div>
      )}
      <LetterForm onSubmit={submit} submitLabel="Enregistrer" />
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
