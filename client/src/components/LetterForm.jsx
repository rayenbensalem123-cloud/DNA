import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { todayInputValue, toInputDate, fmtSize } from '../utils';

const CATEGORIES = ['administration', 'juridique', 'finances', 'rh', 'communication', 'securite', 'autre'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE = /\.(pdf|jpe?g|png)$/i;

/**
 * Letter form, used to create a letter (mode "page") and to edit one inside a modal (mode "modal").
 *
 * onSubmit(data) receives the fields plus `files` (new files picked by the user). It may return a
 * promise: while it runs the buttons are disabled, and if it throws the message is shown in the form.
 * In modal mode the already-attached files are passed as `existingPieces`; they can be opened
 * (onOpenPiece) and, when canDeletePieces is true, removed (onDeletePiece).
 */
export default function LetterForm({
  initial = {},
  onSubmit,
  submitLabel,
  mode = 'page',
  onCancel,
  existingPieces = [],
  onOpenPiece,
  onDeletePiece,
  canDeletePieces = false,
  error = '',
}) {
  const { t } = useLanguage();
  const isEdit = mode === 'modal';
  const [committees, setCommittees] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [f, setF] = useState({
    direction: initial.direction || 'entrant',
    type: initial.type || 'courrier',
    categorie: initial.categorie || 'autre',
    priorite: initial.priorite || 'normale',
    statut: initial.statut || 'recu',
    objet: initial.objet || '',
    resume: initial.resume || '',
    numeroLettre: initial.numeroLettre || '',
    commission: initial.commission || '',
    expediteurNom: initial.expediteur?.nom || '',
    expediteurFonction: initial.expediteur?.fonction || '',
    expediteurService: initial.expediteur?.service || '',
    destinataireNom: initial.destinataire?.nom || '',
    destinataireFonction: initial.destinataire?.fonction || '',
    destinataireService: initial.destinataire?.service || '',
    dateEmission: toInputDate(initial.dateEmission) || todayInputValue(),
    dateReception: toInputDate(initial.dateReception) || todayInputValue(),
  });
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    api.committees()
      .then((d) => { if (!cancelled) setCommittees(d.items || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const addFiles = (fileList) => {
    setFileError('');
    const accepted = [];
    for (const file of Array.from(fileList || [])) {
      if (!ALLOWED_FILE.test(file.name)) { setFileError(`${t('form.fileBadType')} ${file.name}`); continue; }
      if (file.size > MAX_FILE_BYTES) { setFileError(`${t('form.fileTooBig')} ${file.name}`); continue; }
      accepted.push(file);
    }
    setFiles((prev) => [...prev, ...accepted]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        direction: f.direction,
        type: f.type,
        categorie: f.categorie,
        priorite: f.priorite,
        statut: f.statut,
        objet: f.objet,
        resume: f.resume,
        numeroLettre: f.numeroLettre,
        commission: f.commission || null,
        expediteur: { nom: f.expediteurNom, fonction: f.expediteurFonction, service: f.expediteurService },
        destinataire: { nom: f.destinataireNom, fonction: f.destinataireFonction, service: f.destinataireService },
        dateEmission: f.dateEmission ? f.dateEmission + 'T09:00:00.000Z' : new Date().toISOString(),
        dateReception: f.dateReception ? f.dateReception + 'T09:00:00.000Z' : null,
        files,
      });
    } catch (err) {
      setSubmitError(err?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const removePiece = async (piece) => {
    if (!onDeletePiece) return;
    if (!window.confirm(t('edit.confirmRemoveFile', { name: piece.nom }))) return;
    setDeletingId(piece.id);
    try { await onDeletePiece(piece); } finally { setDeletingId(null); }
  };

  const field = (key, label, el) => (
    <label className="field">
      <span>{label}</span>
      {el}
    </label>
  );

  const fields = (
    <>
      <div className="form-grid">
        {field('numeroLettre', t('form.numero'), (
          <input value={f.numeroLettre} onChange={(e) => set('numeroLettre', e.target.value)} placeholder="N° ..." />
        ))}
        {field('direction', t('form.direction'), (
          <select value={f.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="entrant">{t('direction.entrant')}</option>
            <option value="sortant">{t('direction.sortant')}</option>
          </select>
        ))}
        {field('type', t('form.type'), (
          <select value={f.type} onChange={(e) => set('type', e.target.value)}>
            <option value="officielle">{t('type.officielle')}</option>
            <option value="arrete">{t('type.arrete')}</option>
            <option value="decret">{t('type.decret')}</option>
            <option value="note">{t('type.note')}</option>
            <option value="courrier">{t('type.courrier')}</option>
            <option value="mandat">{t('type.mandat')}</option>
            <option value="autre">{t('type.autre')}</option>
          </select>
        ))}
        {field('categorie', t('form.categorie'), (
          <select value={f.categorie} onChange={(e) => set('categorie', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t('categorie.' + c)}</option>)}
            {/* keep an older value selectable instead of silently switching it to another category */}
            {!CATEGORIES.includes(f.categorie) && <option value={f.categorie}>{f.categorie}</option>}
          </select>
        ))}
        {field('priorite', t('form.priorite'), (
          <select value={f.priorite} onChange={(e) => set('priorite', e.target.value)}>
            <option value="normale">{t('priorite.normale')}</option>
            <option value="urgente">{t('priorite.urgente')}</option>
            <option value="confidentielle">{t('priorite.confidentielle')}</option>
          </select>
        ))}
        {field('commission', t('form.commission'), (
          <select value={f.commission} onChange={(e) => {
            const next = e.target.value;
            set('commission', next);
            if (next && (f.statut === 'recu' || f.statut === 'enregistre')) set('statut', 'transmis');
          }}>
            <option value="">{t('commission.none')}</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        ))}
        {field('statut', isEdit ? t('form.statutEdit') : t('form.statut'), (
          <select value={f.statut} onChange={(e) => set('statut', e.target.value)}>
            <option value="recu">{t('status.recu')}</option>
            <option value="enregistre">{t('status.enregistre')}</option>
            <option value="en_cours">{t('status.en_cours')}</option>
            <option value="traite">{t('status.traite')}</option>
            <option value="transmis">{t('status.transmis')}</option>
            <option value="archive">{t('status.archive')}</option>
          </select>
        ))}
      </div>
      <label className="field full">
        <span>{t('form.objet')}</span>
        <input value={f.objet} onChange={(e) => set('objet', e.target.value)} required />
      </label>
      <label className="field full">
        <span>{t('form.resume')}</span>
        <textarea rows={3} value={f.resume} onChange={(e) => set('resume', e.target.value)} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>{t('form.expediteurNom')}</span>
          <input value={f.expediteurNom} onChange={(e) => set('expediteurNom', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.expediteurFonction')}</span>
          <input value={f.expediteurFonction} onChange={(e) => set('expediteurFonction', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.expediteurService')}</span>
          <input value={f.expediteurService} onChange={(e) => set('expediteurService', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.destinataireNom')}</span>
          <input value={f.destinataireNom} onChange={(e) => set('destinataireNom', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.destinataireFonction')}</span>
          <input value={f.destinataireFonction} onChange={(e) => set('destinataireFonction', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.destinataireService')}</span>
          <input value={f.destinataireService} onChange={(e) => set('destinataireService', e.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>{t('form.dateEmission')}</span>
          <input type="date" value={f.dateEmission} onChange={(e) => set('dateEmission', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('form.dateReception')}</span>
          <input type="date" value={f.dateReception} onChange={(e) => set('dateReception', e.target.value)} />
        </label>
      </div>

      {isEdit && (
        <div className="field full">
          <span>{t('edit.currentFiles')}</span>
          {existingPieces.length === 0 ? (
            <div className="muted">{t('edit.noFiles')}</div>
          ) : (
            <div className="file-list">
              {existingPieces.map((p) => (
                <div key={p.id} className="file-row">
                  {p.hasFile && onOpenPiece
                    ? <button type="button" className="btn-link" onClick={() => onOpenPiece(p)}>{p.nom}</button>
                    : <span className="file-name">{p.nom}</span>}
                  <span className="muted">{p.taille ? fmtSize(p.taille) : ''}{p.hasFile ? '' : ' (' + t('detail.demoFile') + ')'}</span>
                  {canDeletePieces && onDeletePiece && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm file-delete"
                      disabled={submitting || deletingId === p.id}
                      onClick={() => removePiece(p)}
                    >
                      {t('edit.removeFile')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="field full">
        <span>{isEdit ? t('edit.addFiles') : t('form.addFiles')}</span>
        <label className="upload-box">
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <div>
            <div className="upload-title">{t('form.uploadHint')}</div>
            <div className="muted">{t('form.uploadHintSub')}</div>
          </div>
        </label>
        {fileError && <div className="form-error">{fileError}</div>}
        {files.length > 0 && (
          <div className="file-list">
            {files.map((file, i) => (
              <div key={i} className="file-row">
                <span className="file-name">{file.name}</span>
                <span className="muted">{fmtSize(file.size)}</span>
                <button type="button" className="btn btn-ghost file-delete" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const message = error || submitError;

  if (isEdit) {
    return (
      <form className="modal-form" onSubmit={submit}>
        <div className="modal-body">{fields}</div>
        {message && <div className="modal-error"><div className="form-error">{message}</div></div>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>{t('common.cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? t('common.loading') : (submitLabel || t('form.submit'))}</button>
        </div>
      </form>
    );
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      {fields}
      {message && <div className="form-error">{message}</div>}
      <button className="btn btn-primary" type="submit" disabled={submitting}>{submitLabel || t('form.submit')}</button>
    </form>
  );
}
