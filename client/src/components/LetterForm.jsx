import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { fmtSize, todayInputValue } from '../utils';

const SUBJECTS = [
  "Plainte d'un club",
  "Plainte d'un arbitre",
  'Demande de club',
  "Courrier d'un arbitre",
  "Remerciement d'un club",
  'Convocation',
  'Rapport de match',
  'Ordre de mission',
];

const SUBJECT_CONTACT = {
  "Plainte d'un club": { label: 'Nom du club', placeholder: 'Ex. Club Africain' },
  "Plainte d'un arbitre": { label: "Nom de l'arbitre", placeholder: "Nom et prénom de l'arbitre" },
  'Demande de club': { label: 'Nom du club', placeholder: 'Ex. Étoile du Sahel' },
  "Courrier d'un arbitre": { label: "Nom de l'arbitre", placeholder: "Nom et prénom de l'arbitre" },
  "Remerciement d'un club": { label: 'Nom du club', placeholder: 'Ex. Espérance de Tunis' },
  Convocation: { label: 'Personne ou club convoqué', placeholder: 'Nom' },
  'Rapport de match': { label: "Nom de l'arbitre", placeholder: "Arbitre auteur du rapport" },
  'Ordre de mission': { label: "Nom de l'arbitre", placeholder: 'Arbitre concerné' },
};

function dateValue(value) {
  return value ? String(value).slice(0, 10) : '';
}

function initialForm(letter, initialDirection) {
  if (!letter) return {
    numeroLettre: '', direction: initialDirection, type: 'courrier', priorite: 'normale', commission: '',
    objet: '', objetAutre: '', personneConcernee: '', expediteurNom: '', resume: '',
    dateEmission: todayInputValue(), dateReception: todayInputValue(),
  };
  const knownSubject = SUBJECTS.includes(letter.objet);
  const direction = letter.direction || initialDirection;
  return {
    numeroLettre: letter.numeroLettre || '', direction, type: letter.type || 'courrier', priorite: letter.priorite || 'normale',
    commission: letter.commission || '', objet: knownSubject ? letter.objet : 'autre', objetAutre: knownSubject ? '' : (letter.objet || ''),
    personneConcernee: letter.personneConcernee || '',
    expediteurNom: direction === 'entrant' ? (letter.expediteur?.nom || '') : (letter.destinataire?.nom || ''),
    resume: letter.resume || '', dateEmission: dateValue(letter.dateEmission), dateReception: dateValue(letter.dateReception),
  };
}

export default function LetterForm({ onSubmit, onCancel, busy = false, error = '', initialDirection = 'entrant', initialLetter = null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { t } = useLanguage();
  const [committees, setCommittees] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState(() => initialForm(initialLetter, initialDirection));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    api.committees().then((data) => {
      if (!cancelled) setCommittees(data.items || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const addFiles = (fileList) => {
    setFileError('');
    const accepted = [];
    for (const file of Array.from(fileList || [])) {
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
        setFileError('Format non pris en charge. Ajoutez un PDF, JPG ou PNG.');
      } else if (file.size > 25 * 1024 * 1024) {
        setFileError('Fichier trop volumineux (25 Mo max par fichier).');
      } else {
        accepted.push(file);
      }
    }
    setFiles((current) => [...current, ...accepted]);
  };

  const selectSubject = (value) => {
    setForm((current) => ({ ...current, objet: value, objetAutre: '', personneConcernee: '' }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (fileError) return;
    const objet = form.objet === 'autre' ? form.objetAutre.trim() : form.objet;
    onSubmit({
      numeroLettre: form.numeroLettre,
      direction: form.direction,
      type: form.type,
      categorie: initialLetter?.categorie || (form.objet.toLowerCase().includes('plainte') ? 'juridique' : 'autre'),
      priorite: form.priorite,
      statut: initialLetter?.statut || (form.commission ? 'en_cours' : 'recu'),
      objet,
      personneConcernee: form.personneConcernee.trim(),
      resume: form.resume.trim(),
      expediteur: { nom: form.direction === 'entrant' ? form.expediteurNom : 'Direction Nationale d’Arbitrage', fonction: '', service: '' },
      destinataire: { nom: form.direction === 'sortant' ? form.expediteurNom : 'Direction Nationale d’Arbitrage', fonction: '', service: '' },
      dateEmission: form.dateEmission ? `${form.dateEmission}T09:00:00.000Z` : new Date().toISOString(),
      dateReception: form.dateReception ? `${form.dateReception}T09:00:00.000Z` : null,
      commission: form.commission || null,
      files,
    });
  };

  const contact = SUBJECT_CONTACT[form.objet];

  return (
    <form id="letter-create-form" onSubmit={submit}>
      <div className="modal-body">
        <div>
          <label
            className={`dropzone${dragging ? ' drag' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
            />
            <span className="dz-icon" aria-hidden="true">📄</span>
            <span className="dz-title">Glisse le PDF ici ou <b>parcourir</b></span>
            <span className="muted">PDF, JPG ou PNG — 25 Mo max par fichier</span>
          </label>
          {fileError && <div className="form-error modal-file-error" role="alert">{fileError}</div>}
          {files.length > 0 && (
            <div className="file-list">
              {files.map((file, index) => (
                <div className="file-row" key={`${file.name}-${file.lastModified}-${index}`}>
                  <span className="pdf-tag">{/\.pdf$/i.test(file.name) ? 'PDF' : 'IMG'}</span>
                  <span className="file-name">{file.name}</span>
                  <span className="spacer" />
                  <span className="muted">{fmtSize(file.size)}</span>
                  <button type="button" className="btn btn-ghost" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>Retirer</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-grid">
          <label className="field"><span>N° du courrier</span><input value={form.numeroLettre} onChange={(event) => set('numeroLettre', event.target.value)} placeholder="N° ..." /></label>
          <label className="field"><span>Direction</span>
            <select value={form.direction} onChange={(event) => set('direction', event.target.value)}>
              <option value="entrant">Entrant</option><option value="sortant">Sortant</option>
            </select>
          </label>
          <label className="field"><span>Type</span>
            <select value={form.type} onChange={(event) => set('type', event.target.value)}>
              <option value="courrier">Courrier</option><option value="officielle">Lettre officielle</option><option value="note">Note</option><option value="arrete">Arrêté</option><option value="decret">Décret</option><option value="mandat">Mandat</option><option value="autre">Autre</option>
            </select>
          </label>
          <label className="field"><span>Importance</span>
            <select value={form.priorite} onChange={(event) => set('priorite', event.target.value)}>
              <option value="normale">Normale</option><option value="urgente">Urgente</option><option value="confidentielle">Confidentielle</option>
            </select>
          </label>
          <label className="field"><span>{isAdmin ? 'Comité destinataire' : 'Département (changez-le pour transférer)'}</span>
            <select value={form.commission} onChange={(event) => set('commission', event.target.value)}>
              <option value="">{isAdmin ? '— Aucun —' : (initialLetter ? '— Choisir un département —' : 'Mon département (par défaut)')}</option>
              {committees.map((committee) => <option key={committee.id} value={committee.id}>{committee.nom}</option>)}
            </select>
          </label>
        </div>

        <label className="field full"><span>Objet</span>
          <select value={form.objet} required={!initialLetter} onChange={(event) => selectSubject(event.target.value)}>
            <option value="">— Choisir le sujet —</option>
            {SUBJECTS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
            <option value="autre">Autre</option>
          </select>
        </label>

        {contact && (
          <label className="field full"><span>{contact.label}</span>
            <input required={!initialLetter} value={form.personneConcernee} onChange={(event) => set('personneConcernee', event.target.value)} placeholder={contact.placeholder} />
          </label>
        )}

        {form.objet === 'autre' && (
          <label className="field full"><span>Précisez le sujet</span>
            <input required={!initialLetter} value={form.objetAutre} onChange={(event) => set('objetAutre', event.target.value)} placeholder="Sujet de la lettre" />
          </label>
        )}

        <div className="form-grid">
          <label className="field"><span>{form.direction === 'entrant' ? 'Expéditeur' : 'Destinataire'}</span><input value={form.expediteurNom} onChange={(event) => set('expediteurNom', event.target.value)} /></label>
          <label className="field"><span>Date d'émission</span><input type="date" value={form.dateEmission} onChange={(event) => set('dateEmission', event.target.value)} /></label>
          <label className="field"><span>Date de réception</span><input type="date" value={form.dateReception} onChange={(event) => set('dateReception', event.target.value)} /></label>
        </div>
        <label className="field full"><span>Résumé</span><textarea rows={3} value={form.resume} onChange={(event) => set('resume', event.target.value)} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la lettre'}</button>
      </div>
    </form>
  );
}
