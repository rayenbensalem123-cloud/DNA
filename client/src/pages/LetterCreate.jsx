import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import LetterForm from '../components/LetterForm';

export default function LetterCreate() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>Nouvelle correspondance</h1>
      </div>
      <LetterForm onSubmit={submit} submitLabel="Enregistrer" />
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

