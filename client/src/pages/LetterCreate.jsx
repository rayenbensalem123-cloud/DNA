import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import LetterForm from '../components/LetterForm';

export default function LetterCreate() {
  const navigate = useNavigate();

  // Errors thrown here are shown inside the form (which stays filled in so nothing has to be retyped).
  const submit = async (data) => {
    const { files, ...fields } = data;
    const { item, failed } = await api.createLetterWithFiles(fields, files || []);
    // The letter exists now, even if some file could not be attached: open it, and say which ones failed.
    navigate('/lettres/' + item.id, { replace: true, state: { failed } });
  };

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>Nouvelle correspondance</h1>
      </div>
      <LetterForm onSubmit={submit} submitLabel="Enregistrer" />
    </div>
  );
}
