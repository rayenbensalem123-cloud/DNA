import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { fmtSize, todayInputValue } from '../utils';
import { extractPdfDetails } from '../utils/pdfExtract';
import Select from './Select';
import DatePicker from './DatePicker';

const OCR_LANGS_LABEL = 'FR + EN + AR';

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
  const [formError, setFormError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pdfFields, setPdfFields] = useState(null);
  const [pdfReading, setPdfReading] = useState(false);
  const [pdfOcr, setPdfOcr] = useState(false);
  const [showPdfDetails, setShowPdfDetails] = useState(false);
  const [form, setForm] = useState(() => initialForm(initialLetter, initialDirection));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // Normalize priorite to an array when the edited letter changes
  useEffect(() => {
    setForm((current) => {
      const incoming = initialLetter?.priorite;
      if (!incoming) return current;
      const prios = Array.isArray(incoming) ? [...incoming] : incoming ? [incoming] : [];
      if (prios.length === 0) prios.push('normale');
      // Only update if different
      const currentPrios = Array.isArray(current.priorite) ? [...current.priorite] : current.priorite ? [current.priorite] : [];
      const same = prios.length === currentPrios.length && prios.every((p) => currentPrios.includes(p));
      if (!same) return { ...current, priorite: prios };
      return current;
    });
  }, [initialLetter]);

  const togglePriority = useCallback((p) => {
    setForm((current) => {
      const prios = Array.isArray(current.priorite) ? [...current.priorite] : current.priorite ? [current.priorite] : [];
      const i = prios.indexOf(p);
      if (i >= 0) prios.splice(i, 1);
      else prios.push(p);
      if (prios.length === 0) prios.push('normale'); // always keep at least one
      return { ...current, priorite: prios };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.committees().then((data) => {
      if (!cancelled) setCommittees(data.items || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onApply = (e) => {
      const t = e.detail;
      setForm((current) => ({
        ...current,
        objet: 'autre',
        objetAutre: t.objet || '',
        type: t.type || current.type,
        categorie: t.categorie || current.categorie,
        priorite: t.priorite || current.priorite,
        expediteurNom: t.expediteurNom || current.expediteurNom,
        resume: t.resume || current.resume,
      }));
    };
    document.addEventListener('apply-template', onApply);
    return () => { document.removeEventListener('apply-template', onApply); };
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
    // OCR multi-langue (FR/EN/AR) sur le premier fichier: remplir TOUS les champs
    const firstFile = accepted.find((f) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name));
    if (firstFile) {
      setPdfReading(true);
      extractPdfDetails(firstFile, (phase) => { if (phase === 'ocr') setPdfOcr(true); }).then((d) => {
        setPdfReading(false);
        setPdfOcr(false);
        setPdfFields(d);
        if (!d.sujet && !d.expediteur && !d.dateEmission) return;
        setForm((current) => {
          const updates = {};
          if (d.sujet && !current.objet) { updates.objet = 'autre'; updates.objetAutre = d.sujet; }
          if (d.expediteur && !current.expediteurNom) updates.expediteurNom = d.expediteur;
          if (d.dateEmission && !current.dateEmission) updates.dateEmission = d.dateEmission;
          if (d.reference && !current.numeroLettre) updates.numeroLettre = d.reference;
          if (d.categorie && !current.categorie) updates.categorie = d.categorie;
          if (d.priorite && d.priorite !== 'normale') updates.priorite = [d.priorite];
          return Object.keys(updates).length ? { ...current, ...updates } : current;
        });
      }).catch(() => { setPdfReading(false); setPdfOcr(false); });
    }
  };

  const selectSubject = (value) => {
    setForm((current) => ({ ...current, objet: value, objetAutre: '', personneConcernee: '' }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (fileError) return;
    // Custom themed dropdowns can't rely on HTML `required`, so validate here.
    if (!initialLetter && !form.objet) { setFormError('Choisissez le sujet de la lettre.'); return; }
    if (!initialLetter && !form.commission) { setFormError('Choisissez le comité destinataire.'); return; }
    setFormError('');
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
          {(pdfReading || pdfFields) && (
            <div className={'pdf-subject-hint' + (pdfOcr && !pdfFields ? ' pdf-ocr-progress' : '')}>
              {pdfFields ? (
                <>
                  <div className="pdf-hint-head">
                    <strong>✦ Champs lus automatiquement</strong>
                    {pdfFields.usedOcr && <span className="muted small"> · OCR {OCR_LANGS_LABEL}</span>}
                    <button type="button" className="btn-link" onClick={() => setShowPdfDetails((v) => !v)}>{showPdfDetails ? 'Masquer' : 'Voir le détail'}</button>
                  </div>
                  <div className="pdf-hint-summary">
                    {pdfFields.sujet && <span>Objet : {pdfFields.sujet}</span>}
                    {pdfFields.expediteur && <span>Expéditeur : {pdfFields.expediteur}</span>}
                    {pdfFields.dateEmission && <span>Date : {pdfFields.dateEmission}</span>}
                  </div>
                  {showPdfDetails && (
                    <div className="pdf-hint-grid">
                      {pdfFields.sujet && <div><b>Objet</b> {pdfFields.sujet}</div>}
                      {pdfFields.expediteur && <div><b>Expéditeur</b> {pdfFields.expediteur}</div>}
                      {pdfFields.dateEmission && <div><b>Date</b> {pdfFields.dateEmission}</div>}
                      {pdfFields.reference && <div><b>Référence</b> {pdfFields.reference}</div>}
                      {pdfFields.priorite && <div><b>Priorité</b> {pdfFields.priorite}</div>}
                      {pdfFields.categorie && <div><b>Catégorie</b> {pdfFields.categorie}</div>}
                    </div>
                  )}
                  <span className="muted small">Les champs du formulaire ont été pré-remplis — modifiez-les si nécessaire.</span>
                </>
              ) : pdfOcr
                ? <>Lecture du scan (OCR français + anglais + arabe) en cours… ça peut prendre quelques secondes.</>
                : <>Lecture du document en cours…</>}
            </div>
          )}
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
            <Select ariaLabel="Direction" value={form.direction} onChange={(v) => set('direction', v)} options={[{ value: 'entrant', label: 'Entrant' }, { value: 'sortant', label: 'Sortant' }]} />
          </label>
          <label className="field"><span>Type</span>
            <Select ariaLabel="Type" value={form.type} onChange={(v) => set('type', v)} options={[{ value: 'courrier', label: 'Courrier' }, { value: 'officielle', label: 'Lettre officielle' }, { value: 'note', label: 'Note' }, { value: 'arrete', label: 'Arrêté' }, { value: 'decret', label: 'Décret' }, { value: 'mandat', label: 'Mandat' }, { value: 'autre', label: 'Autre' }]} />
          </label>
          <label className="field full"><span>Importance</span>
            <div className="priority-checkboxes">
              <label className="priority-checkbox"><input type="checkbox" checked={Array.isArray(form.priorite) ? form.priorite.includes('normale') : form.priorite === 'normale'} onChange={() => togglePriority('normale')} /> Normale</label>
              <label className="priority-checkbox"><input type="checkbox" checked={Array.isArray(form.priorite) ? form.priorite.includes('urgente') : form.priorite === 'urgente'} onChange={() => togglePriority('urgente')} /> Urgente</label>
              <label className="priority-checkbox"><input type="checkbox" checked={Array.isArray(form.priorite) ? form.priorite.includes('confidentielle') : form.priorite === 'confidentielle'} onChange={() => togglePriority('confidentielle')} /> Confidentielle</label>
            </div>
          </label>
          <label className="field"><span>{isAdmin ? 'Comité destinataire' : (initialLetter ? 'Comité (changez-le pour transférer)' : 'Comité destinataire')}</span>
            <Select ariaLabel="Comité" value={form.commission} onChange={(v) => set('commission', v)} placeholder={isAdmin ? '— Aucun —' : '— Choisir un comité —'} options={[{ value: '', label: isAdmin ? '— Aucun —' : '— Choisir un comité —' }, ...committees.map((committee) => ({ value: committee.id, label: committee.nom }))]} />
          </label>
        </div>

        <label className="field full"><span>Objet</span>
          <Select ariaLabel="Objet" value={form.objet} onChange={(v) => selectSubject(v)} placeholder="— Choisir le sujet —" options={[{ value: '', label: '— Choisir le sujet —' }, ...SUBJECTS.map((subject) => ({ value: subject, label: subject })), { value: 'autre', label: 'Autre' }]} />
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
          <label className="field"><span>Date d'émission</span><DatePicker value={form.dateEmission} onChange={(v) => set('dateEmission', v)} /></label>
          <label className="field"><span>Date de réception</span><DatePicker value={form.dateReception} onChange={(v) => set('dateReception', v)} /></label>
        </div>
        <label className="field full"><span>Résumé</span><textarea rows={3} value={form.resume} onChange={(event) => set('resume', event.target.value)} /></label>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la lettre'}</button>
      </div>
    </form>
  );
}
