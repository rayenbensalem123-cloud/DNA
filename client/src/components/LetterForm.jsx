import { useState } from 'react';
import { todayInputValue, toInputDate } from '../utils';

export default function LetterForm({ initial = {}, onSubmit, submitLabel }) {
  const [f, setF] = useState({
    direction: initial.direction || 'entrant',
    type: initial.type || 'courrier',
    categorie: initial.categorie || 'autre',
    priorite: initial.priorite || 'normale',
    statut: initial.statut || 'recu',
    objet: initial.objet || '',
    resume: initial.resume || '',
    expediteurNom: initial.expediteur?.nom || '',
    expediteurFonction: initial.expediteur?.fonction || '',
    expediteurService: initial.expediteur?.service || '',
    destinataireNom: initial.destinataire?.nom || '',
    destinataireFonction: initial.destinataire?.fonction || '',
    destinataireService: initial.destinataire?.service || '',
    dateEmission: toInputDate(initial.dateEmission) || todayInputValue(),
    dateReception: toInputDate(initial.dateReception) || todayInputValue(),
    pieces: (initial.pieces || []).map((p) => `${p.nom}|${p.taille || ''}`).join('\n'),
  });
  const [error, setError] = useState('');
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const pieces = [];
    for (const line of f.pieces.split('\n')) {
      const [nom, taille] = line.split('|');
      if (nom && nom.trim()) pieces.push({ nom: nom.trim(), taille: (taille || '').trim() });
    }
    onSubmit({
      direction: f.direction,
      type: f.type,
      categorie: f.categorie,
      priorite: f.priorite,
      statut: f.statut,
      objet: f.objet,
      resume: f.resume,
      expediteur: { nom: f.expediteurNom, fonction: f.expediteurFonction, service: f.expediteurService },
      destinataire: { nom: f.destinataireNom, fonction: f.destinataireFonction, service: f.destinataireService },
      dateEmission: f.dateEmission ? f.dateEmission + 'T09:00:00.000Z' : new Date().toISOString(),
      dateReception: f.dateReception ? f.dateReception + 'T09:00:00.000Z' : null,
      pieces,
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
        {field('direction', 'Direction', (
          <select value={f.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="entrant">Entrant</option>
            <option value="sortant">Sortant</option>
          </select>
        ))}
        {field('type', 'Type', (
          <select value={f.type} onChange={(e) => set('type', e.target.value)}>
            <option value="officielle">Officielle</option>
            <option value="arrete">Arrêté</option>
            <option value="decret">Décret</option>
            <option value="note">Note</option>
            <option value="courrier">Courrier</option>
            <option value="mandat">Mandat</option>
            <option value="autre">Autre</option>
          </select>
        ))}
        {field('categorie', 'Catégorie', (
          <select value={f.categorie} onChange={(e) => set('categorie', e.target.value)}>
            <option value="administration">Administration</option>
            <option value="juridique">Juridique</option>
            <option value="finances">Finances</option>
            <option value="rh">Ressources humaines</option>
            <option value="communication">Communication</option>
            <option value="securite">Sécurité</option>
            <option value="autre">Autre</option>
          </select>
        ))}
        {field('priorite', 'Priorité', (
          <select value={f.priorite} onChange={(e) => set('priorite', e.target.value)}>
            <option value="normale">Normale</option>
            <option value="urgente">Urgente</option>
            <option value="confidentielle">Confidentielle</option>
          </select>
        ))}
        {field('statut', 'Statut', (
          <select value={f.statut} onChange={(e) => set('statut', e.target.value)}>
            <option value="recu">Reçu</option>
            <option value="enregistre">Enregistré</option>
            <option value="en_cours">En cours</option>
            <option value="traite">Traité</option>
            <option value="transmis">Transmis</option>
            <option value="archive">Archivé</option>
          </select>
        ))}
      </div>
      <label className="field full">
        <span>Objet</span>
        <input value={f.objet} onChange={(e) => set('objet', e.target.value)} required />
      </label>
      <label className="field full">
        <span>Résumé</span>
        <textarea rows={3} value={f.resume} onChange={(e) => set('resume', e.target.value)} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Expéditeur — nom</span>
          <input value={f.expediteurNom} onChange={(e) => set('expediteurNom', e.target.value)} />
        </label>
        <label className="field">
          <span>Expéditeur — fonction</span>
          <input value={f.expediteurFonction} onChange={(e) => set('expediteurFonction', e.target.value)} />
        </label>
        <label className="field">
          <span>Expéditeur — service</span>
          <input value={f.expediteurService} onChange={(e) => set('expediteurService', e.target.value)} />
        </label>
        <label className="field">
          <span>Destinataire — nom</span>
          <input value={f.destinataireNom} onChange={(e) => set('destinataireNom', e.target.value)} />
        </label>
        <label className="field">
          <span>Destinataire — fonction</span>
          <input value={f.destinataireFonction} onChange={(e) => set('destinataireFonction', e.target.value)} />
        </label>
        <label className="field">
          <span>Destinataire — service</span>
          <input value={f.destinataireService} onChange={(e) => set('destinataireService', e.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Date d'émission</span>
          <input type="date" value={f.dateEmission} onChange={(e) => set('dateEmission', e.target.value)} />
        </label>
        <label className="field">
          <span>Date de réception</span>
          <input type="date" value={f.dateReception} onChange={(e) => set('dateReception', e.target.value)} />
        </label>
      </div>
      <label className="field full">
        <span>Pièces jointes (un par ligne : nom|taille)</span>
        <textarea rows={3} value={f.pieces} onChange={(e) => set('pieces', e.target.value)} />
      </label>
      {error && <div className="form-error">{error}</div>}
      <button className="btn btn-primary" type="submit">{submitLabel || 'Enregistrer'}</button>
    </form>
  );
}
