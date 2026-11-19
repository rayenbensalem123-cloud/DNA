import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import Select from '../components/Select';
import PriorityPills from '../components/PriorityPills';

const CATEGORIES = [
  { value: 'administration', label: 'Administration' },
  { value: 'juridique', label: 'Juridique' },
  { value: 'finances', label: 'Finances' },
  { value: 'rh', label: 'Ressources humaines' },
  { value: 'communication', label: 'Communication' },
  { value: 'securite', label: 'Sécurité' },
  { value: 'autre', label: 'Autre' },
];
const PRIORITES = [
  { value: 'normale', label: 'Normale' },
  { value: 'urgente', label: 'Urgente' },
  { value: 'confidentielle', label: 'Confidentielle' },
];
const TYPES = [
  { value: 'courrier', label: 'Courrier' },
  { value: 'officielle', label: 'Lettre officielle' },
  { value: 'note', label: 'Note' },
  { value: 'arrete', label: 'Arrêté' },
  { value: 'decret', label: 'Décret' },
  { value: 'mandat', label: 'Mandat' },
  { value: 'autre', label: 'Autre' },
];

export default function Templates() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    nom: '', objet: '', type: 'courrier', categorie: 'administration',
    priorite: 'normale', expediteurNom: '', destinataireNom: '', resume: '',
  });

  useEffect(() => {
    setLoading(true);
    api.templates().then((d) => { setItems(d.items || []); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  const resetForm = () => setForm({
    nom: '', objet: '', type: 'courrier', categorie: 'administration',
    priorite: 'normale', expediteurNom: '', destinataireNom: '', resume: '',
  });
  const set = (key, value) => setForm((c) => ({ ...c, [key]: value }));

  const startEdit = (t) => {
    setEditId(t.id);
    setForm({
      nom: t.nom, objet: t.objet, type: t.type, categorie: t.categorie,
      priorite: t.priorite, expediteurNom: t.expediteurNom || '',
      destinataireNom: t.destinataireNom || '', resume: t.resume || '',
    });
  };

  const save = async () => {
    setError('');
    if (!form.nom || !form.objet) { setError('Nom et objet requis'); return; }
    try {
      if (editId) {
        await api.updateTemplate(editId, form);
        setNotice('Modèle mis à jour.');
      } else {
        await api.createTemplate(form);
        setNotice('Modèle créé.');
      }
      resetForm(); setEditId(null);
      const d = await api.templates();
      setItems(d.items || []);
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Supprimer ce modèle ?')) return;
    try {
      await api.deleteTemplate(id);
      setNotice('Modèle supprimé.');
      const d = await api.templates();
      setItems(d.items || []);
    } catch (e) { setError(e.message); }
  };

  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Modèles de courrier</h1>
        <div className="muted">Pré-remplissez les champs récurrents pour gagner du temps à la création.</div>
      </div>
      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="card">
        <div className="card-pad">
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{editId ? 'Modifier le modèle' : 'Nouveau modèle'}</h2>
          <div className="form-grid">
            <label className="field full"><span>Nom du modèle</span><input required value={form.nom} onChange={(e) => set('nom', e.target.value)} placeholder="Ex. Plainte d’un club" /></label>
            <label className="field full"><span>Objet</span><input required value={form.objet} onChange={(e) => set('objet', e.target.value)} placeholder="Ex. Plainte contre décision du comité" /></label>
            <label className="field"><span>Type</span><Select value={form.type} onChange={(v) => set('type', v)} options={TYPES} /></label>
            <label className="field"><span>Catégorie</span><Select value={form.categorie} onChange={(v) => set('categorie', v)} options={CATEGORIES} /></label>
            <label className="field"><span>Priorité</span><Select value={form.priorite} onChange={(v) => set('priorite', v)} options={PRIORITES} /></label>
            <label className="field"><span>Expéditeur</span><input value={form.expediteurNom} onChange={(e) => set('expediteurNom', e.target.value)} placeholder="Nom du service expéditeur" /></label>
            <label className="field"><span>Destinataire</span><input value={form.destinataireNom} onChange={(e) => set('destinataireNom', e.target.value)} placeholder="Nom du service destinataire" /></label>
          </div>
          <label className="field full"><span>Résumé (pré-rempli)</span><textarea rows={3} value={form.resume} onChange={(e) => set('resume', e.target.value)} placeholder="Texte type qui sera pré-rempli dans le résumé de la lettre" /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {editId && <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setEditId(null); }}>Annuler</button>}}
            <button type="button" className="btn btn-primary" onClick={save}>{editId ? 'Enregistrer les modifications' : 'Créer le modèle'}</button>
          </div>
        </div>
      </div>
      <div className="card archive-list-card">
        <div className="archive-list-heading">
          <h2 className="card-title">Modèles existants ({items.length})</h2>
          {isBureau && <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setEditId(null); }}>+ Nouveau modèle</button>}
        </div>
        {loading ? <div className="card-pad">Chargement…</div> : (
          <div className="table-wrap"><table className="table archive-table">
            <thead><tr><th>Nom</th><th>Objet</th><th>Type</th><th>Catégorie</th><th>Priorité</th><th>Expéditeur</th><th>Destinataire</th><th style={{ width: '120px' }}>Actions</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><span className="mono">{t.nom}</span></td>
                  <td>{t.objet}</td>
                  <td>{t.type}</td>
                  <td>{t.categorie}</td>
                  <td><PriorityPills value={t.priorite} /></td>
                  <td>{t.expediteurNom || '—'}</td>
                  <td>{t.destinataireNom || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isBureau && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(t)}>Modifier</button>}
                      {isBureau && <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(t.id)}>Supprimer</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} className="empty-cell">Aucun modèle créé.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 14 }}>Les modèles s’appliquent lors de la création d’une nouvelle lettre (bouton « + » ou « Nouveau courrier »). Sélectionnez un modèle pour pré-remplir les champs, puis modifiez avant d’enregistrer.</p>
    </div>
  );
}
