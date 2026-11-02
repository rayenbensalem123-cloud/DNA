import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLanguage } from '../i18n';
import { todayInputValue, toInputDate, fmtSize } from '../utils';

export default function LetterForm({ initial = {}, onSubmit, submitLabel }) {
  const { t } = useLanguage();
  const [committees, setCommittees] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
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
      if (file.size > 10 * 1024 * 1024) { setFileError((t('form.fileTooBig'))); continue; }
      accepted.push(file);
    }
    setFiles((prev) => [...prev, ...accepted]);
  };

  const submit = async (e) => {
    e.preventDefault();
    onSubmit({
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
  };

  const field = (key, label, el) => (
    <label className="field">
      <span>{label}</span>
      {el}
    </label>
  );

  return (
    <form className="card form-card" onSubmit={submit}>
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
            <option value="administration">{t('categorie.administration')}</option>
            <option value="juridique">{t('categorie.juridique')}</option>
            <option value="finances">{t('categorie.finances')}</option>
            <option value="rh">{t('categorie.rh')}</option>
            <option value="communication">{t('categorie.communication')}</option>
            <option value="securite">{t('categorie.securite')}</option>
            <option value="autre">{t('categorie.autre')}</option>
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
        {field('statut', t('form.statut'), (
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
      <div className="field full">
        <span>{t('form.addFiles')}</span>
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
                <button type="button" className="btn btn-ghost" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-primary" type="submit">{submitLabel || t('form.submit')}</button>
    </form>
  );
}
