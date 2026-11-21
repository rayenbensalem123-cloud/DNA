import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';

const STATUS_LABELS = { actif: 'Actif', inactif: 'Inactif', suspendu: 'Suspendu' };
const emptyReferee = () => ({
  nom: '', prenom: '', grade: '', categorie: '', region: '', telephone: '',
  email: '', dateNaissance: '', association: '', statut: 'actif', note: '',
});
const FIELDS = [
  ['matricule', 'Matricule'],
  ['grade', 'Grade'],
  ['categorie', 'Catégorie'],
  ['region', 'Région'],
  ['association', 'Association / Ligue'],
  ['telephone', 'Téléphone'],
  ['email', 'Email'],
  ['dateNaissance', 'Date de naissance'],
];

export default function Referees() {
  const { user } = useAuth();
  const isBureau = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importReading, setImportReading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await api.referees(); setItems(d.items || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (filterStatut && r.statut !== filterStatut) return false;
      if (!q) return true;
      return [r.nom, r.prenom, r.matricule, r.grade, r.region, r.association].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, query, filterStatut]);

  const openReferee = async (r) => {
    try { const d = await api.referee(r.id); setSelected(d.item); }
    catch { setSelected(r); }
    setForm(null); setConfirmDelete(false);
  };

  const update = (key, value) => setForm((c) => ({ ...c, [key]: value }));
  const edit = (r) => { setError(''); setNotice(''); setForm({ ...r }); setConfirmDelete(false); };
  const add = () => { setError(''); setNotice(''); setForm(emptyReferee()); setSelected(null); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (form.id) {
        const { id, createdAt, createdBy, ...changes } = form;
        const d = await api.updateReferee(id, changes);
        setSelected(d.item);
        setNotice('Arbitre mis à jour.');
      } else {
        const d = await api.createReferee(form);
        setSelected(d.item);
        setNotice('Arbitre ajouté.');
      }
      setForm(null);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.deleteReferee(selected.id);
      setNotice('Arbitre supprimé.');
      setSelected(null); setConfirmDelete(false);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const fullName = (r) => [r.prenom, r.nom].filter(Boolean).join(' ').trim() || '—';
  const initials = (r) => [r.prenom, r.nom].filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  const EXPORT_HEADERS = [
    { key: 'matricule', label: 'Matricule' }, { key: 'nom', label: 'Nom' }, { key: 'prenom', label: 'Prénom' },
    { key: 'grade', label: 'Grade' }, { key: 'categorie', label: 'Catégorie' }, { key: 'region', label: 'Région' },
    { key: 'association', label: 'Association' }, { key: 'telephone', label: 'Téléphone' },
    { key: 'email', label: 'Email' }, { key: 'dateNaissance', label: 'Date naissance' }, { key: 'statut', label: 'Statut' },
  ];
  const exportRows = items.map((r) => Object.fromEntries(EXPORT_HEADERS.map((h) => [h.key, r[h.key] || ''])));
  const doExport = async (format) => {
    try {
      if (format === 'csv') downloadCsv('liste-arbitres', EXPORT_HEADERS, exportRows);
      else if (format === 'xlsx') await downloadXlsx('liste-arbitres', EXPORT_HEADERS, exportRows);
      else printPdf({ title: 'Liste des arbitres', subtitle: `${items.length} arbitres — Direction Nationale d’Arbitrage`, headers: EXPORT_HEADERS, rows: exportRows, meta: { by: user?.name } });
    } catch (e) { setError(e.message); }
  };

  // Parser le texte brut (collé ou issu d'un PDF) en lignes d'arbitres.
  // Formats acceptés (séparateur | , ; ou tab):
  //   Nom | Prénom | Grade | Catégorie | Région | Email | Téléphone
  //   ou une ligne par arbitre avec les champs dans cet ordre.
  const parseImportText = (text) => {
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[|;\t]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      // Heuristic: email = part with @, phone = part with + or digits>=8
      const email = parts.find((p) => /@/.test(p)) || '';
      const telephone = parts.find((p) => /^[+\d][\d\s().-]{7,}$/.test(p)) || '';
      const nameParts = parts[0].split(/\s+/);
      const nom = nameParts.length > 1 ? nameParts.slice(-1)[0] : parts[0];
      const prenom = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (parts[1] && !/@/.test(parts[1]) ? parts[1] : '');
      const rest = parts.filter((p) => p !== parts[0] && p !== email && p !== telephone && p !== prenom);
      return { nom, prenom, grade: rest[0] || '', categorie: rest[1] || '', region: rest[2] || '', association: rest[3] || '', email, telephone, statut: 'actif' };
    }).filter(Boolean);
  };

  const readImportFile = async (file) => {
    setImportReading(true); setError(''); setImportRows([]);
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        // Excel / CSV: lecture structurée avec xlsx
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
        const header = (data[0] || []).map((h) => String(h).toLowerCase().trim());
        const col = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
        const cNom = col(['nom', 'name', 'arbitre']);
        const cPrenom = col(['prenom', 'prénom', 'firstname', 'first name']);
        const cGrade = col(['grade', 'niveau']);
        const cCat = col(['categorie', 'catégorie', 'category']);
        const cRegion = col(['region', 'région', 'lieu']);
        const cEmail = col(['email', 'mail', 'e-mail']);
        const cTel = col(['telephone', 'téléphone', 'tel', 'phone']);
        const cAssoc = col(['association', 'ligue', 'club']);
        const cDate = col(['date', 'naissance', 'birth']);
        const cStatut = col(['statut', 'status', 'etat']);
        const rows = data.slice(1).map((r) => {
          if (!Array.isArray(r)) return null;
          const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
          const nom = get(cNom), prenom = get(cPrenom);
          if (!nom && !prenom) return null;
          return {
            nom, prenom,
            grade: get(cGrade), categorie: get(cCat), region: get(cRegion),
            email: get(cEmail), telephone: get(cTel), association: get(cAssoc),
            dateNaissance: get(cDate),
            statut: /suspend/i.test(get(cStatut)) ? 'suspendu' : /inactif|inactive/i.test(get(cStatut)) ? 'inactif' : 'actif',
          };
        }).filter(Boolean);
        setImportRows(rows);
        setNotice(`${rows.length} arbitre(s) détecté(s) depuis ${file.name}. Vérifiez avant d’importer.`);
      } else if (ext === 'pdf') {
        // PDF: lecture brute avec pdf.js (text layer), puis parsing des lignes
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const data = new Uint8Array(await file.arrayBuffer());
        const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
        const doc = await task.promise;
        let raw = '';
        for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
          const page = await doc.getPage(p);
          const c = await page.getTextContent();
          const lines = {};
          for (const it of c.items) {
            if (!it.str) continue;
            const y = it.transform ? it.transform[5] : 0;
            (lines[y] = lines[y] || []).push(it.str);
          }
          raw += Object.keys(lines).sort((a, b) => b - a).map((y) => lines[y].join(' ')).join('\n') + '\n';
          page.cleanup();
        }
        await task.destroy();
        const rows = parseImportText(raw);
        setImportRows(rows);
        setNotice(`${rows.length} arbitre(s) détecté(s) depuis ${file.name}. Vérifiez avant d’importer.`);
      } else {
        setError('Format non pris en charge. Utilisez un fichier PDF, Excel (.xlsx/.xls) ou CSV.');
      }
    } catch (e) {
      setError('Lecture du fichier impossible : ' + e.message);
    } finally { setImportReading(false); }
  };

  const doImport = async () => {
    if (!importRows.length) { setError('Aucun arbitre détecté. Choisissez un fichier valide.'); return; }
    setBusy(true); setError('');
    try {
      const d = await api.importReferees(importRows);
      setNotice(`${d.created} arbitre(s) importé(s) avec matricule auto.${d.errors?.length ? ' Erreurs: ' + d.errors.join('; ') : ''}`);
      setImportOpen(false); setImportRows([]);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page referees-page">
      <header className="page-header page-title-header">
        <div className="page-title-copy"><span className="page-title-kicker">Direction Nationale d’Arbitrage</span><h1>Arbitres</h1>
          <div className="muted">{items.length} arbitre{items.length > 1 ? 's' : ''} enregistré{items.length > 1 ? 's' : ''}</div>
        </div>
        {isBureau && <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => doExport('csv')}>CSV</button>
          <button className="btn btn-secondary" onClick={() => doExport('xlsx')}>Excel</button>
          <button className="btn btn-secondary" onClick={() => doExport('pdf')}>PDF</button>
          <button className="btn btn-secondary" onClick={() => { setImportOpen(true); setError(''); }}>Importer</button>
          <button className="btn btn-primary" onClick={add}>+ Ajouter un arbitre</button>
        </div>}
      </header>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && !form && <div className="form-error" role="alert">{error}</div>}

      <div className="card referees-card">
        <div className="archive-list-heading">
          <h2 className="card-title">Liste des arbitres</h2>
          <span className="muted">{filtered.length} affiché{filtered.length > 1 ? 's' : ''}</span>
        </div>
        <div className="filters referees-filters">
          <input type="search" aria-label="Rechercher un arbitre" placeholder="Rechercher (nom, matricule, région…)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select ariaLabel="Statut" value={filterStatut} onChange={setFilterStatut} options={[{ value: '', label: 'Tous les statuts' }, ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
        </div>
        {loading ? <div className="card-pad">Chargement…</div> : (
          <div className="table-wrap"><table className="table referees-table">
            <thead><tr><th>Arbitre</th><th>Matricule</th><th>Grade</th><th>Catégorie</th><th>Région</th><th>Statut</th></tr></thead>
            <tbody>{filtered.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => openReferee(r)}>
                <td>
                  <div className="referee-cell">
                    <span className="referee-avatar">{initials(r)}</span>
                    <div><div className="letter-subject">{fullName(r)}</div>{r.email && <div className="letter-subline">{r.email}</div>}</div>
                  </div>
                </td>
                <td className="mono">{r.matricule || '—'}</td>
                <td>{r.grade || '—'}</td>
                <td>{r.categorie || '—'}</td>
                <td>{r.region || '—'}</td>
                <td><span className={'badge referee-status-' + (r.statut || 'actif')}>{STATUS_LABELS[r.statut] || r.statut}</span></td>
              </tr>
            ))}
              {filtered.length === 0 && <tr><td colSpan="6" className="empty-cell">Aucun arbitre trouvé.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Détail de l'arbitre (carte) */}
      {selected && !form && (
        <div className="card referee-detail" style={{ marginTop: 16 }}>
          <div className="referee-detail-head">
            <span className="referee-avatar-lg">{initials(selected)}</span>
            <div className="referee-detail-id">
              <h2>{fullName(selected)}</h2>
              <div className="muted">{selected.grade || 'Arbitre'}{selected.matricule ? ' · ' + selected.matricule : ''}</div>
            </div>
            <span className={'badge referee-status-' + (selected.statut || 'actif')}>{STATUS_LABELS[selected.statut] || selected.statut}</span>
            <div className="referee-detail-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {isBureau && <button className="btn btn-secondary" onClick={() => edit(selected)}>Modifier</button>}
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Fermer</button>
            </div>
          </div>
          <div className="referee-info-grid">
            {FIELDS.map(([key, label]) => (
              <div key={key} className="referee-info-item">
                <span className="referee-info-label">{label}</span>
                <span className="referee-info-value">{selected[key] || '—'}</span>
              </div>
            ))}
          </div>
          {selected.note && <div className="referee-note"><span className="referee-info-label">Note</span><p>{selected.note}</p></div>}
          {isBureau && (
            <div className="referee-danger-zone">
              {confirmDelete ? (
                <span className="account-confirm" role="group" aria-label="Confirmer la suppression">
                  <span>Supprimer cet arbitre ?</span>
                  <button className="btn btn-danger" onClick={remove} disabled={busy}>Oui, supprimer</button>
                  <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Annuler</button>
                </span>
              ) : (
                <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Supprimer l’arbitre</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Formulaire ajout / édition */}
      {form && (
        <section className="card referee-editor" style={{ marginTop: 16 }}>
          <div className="card-head-row"><h2 className="card-title">{form.id ? 'Modifier l’arbitre' : 'Nouvel arbitre'}</h2><button className="btn btn-ghost" type="button" onClick={() => { setForm(null); setError(''); }}>Fermer</button></div>
          <form onSubmit={save}>
            <div className="form-grid">
              <label className="field">Nom<input value={form.nom} onChange={(e) => update('nom', e.target.value)} required placeholder="Nom de famille" /></label>
              <label className="field">Prénom<input value={form.prenom} onChange={(e) => update('prenom', e.target.value)} placeholder="Prénom" /></label>
              <label className="field">Matricule<input value={form.matricule || (form.id ? '' : 'Généré automatiquement')} readOnly disabled placeholder="Généré automatiquement" title="Le matricule est attribué automatiquement par la plateforme" /></label>
              <label className="field">Grade<input value={form.grade} onChange={(e) => update('grade', e.target.value)} placeholder="Ex. FIFA, continental, national" /></label>
              <label className="field">Catégorie<input value={form.categorie} onChange={(e) => update('categorie', e.target.value)} placeholder="Ex. Élite, A, B" /></label>
              <label className="field">Région<input value={form.region} onChange={(e) => update('region', e.target.value)} placeholder="Région" /></label>
              <label className="field">Association / Ligue<input value={form.association} onChange={(e) => update('association', e.target.value)} placeholder="Ligue régionale" /></label>
              <label className="field">Téléphone<input value={form.telephone} onChange={(e) => update('telephone', e.target.value)} placeholder="+216…" /></label>
              <label className="field">Email<input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="email@exemple.tn" /></label>
              <label className="field"><span>Date de naissance</span><DatePicker value={form.dateNaissance} onChange={(v) => update('dateNaissance', v)} placeholder="jj/mm/aaaa" /></label>
              <label className="field">Statut<Select ariaLabel="Statut" value={form.statut} onChange={(v) => update('statut', v)} options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} /></label>
            </div>
            <label className="field full"><span>Note</span><textarea rows={3} value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Note interne sur l'arbitre…" /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button className="btn btn-secondary" type="button" onClick={() => { setForm(null); setError(''); }}>Annuler</button></div>
          </form>
        </section>
      )}

      {/* Modale d'import (fichier PDF / Excel / CSV uniquement) */}
      {importOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setImportOpen(false); }}>
          <section className="modal" style={{ width: 'min(900px, 94vw)', maxHeight: '90vh' }} role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Importer une liste d’arbitres</h2><button type="button" className="modal-close" onClick={() => setImportOpen(false)}>×</button></header>
            <div className="modal-body">
              <p className="muted">Choisissez un fichier <strong>PDF</strong>, <strong>Excel (.xlsx/.xls)</strong> ou <strong>CSV</strong> contenant la liste des arbitres. Un matricule unique sera généré pour chacun.</p>
              <label className={'import-dropzone' + (importReading ? ' reading' : '')} style={{ cursor: importReading ? 'default' : 'pointer' }}>
                <span className="dz-icon" aria-hidden="true">📄</span>
                <span>{importReading ? 'Lecture du fichier en cours…' : 'Choisir un fichier (PDF, Excel ou CSV)'}</span>
                <span className="muted small">Les colonnes reconnues : Nom, Prénom, Grade, Catégorie, Région, Email, Téléphone, Association, Date, Statut</span>
                <input type="file" accept=".pdf,.xlsx,.xls,.csv" style={{ display: 'none' }} disabled={importReading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readImportFile(f); }} />
              </label>
              {importRows.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{importRows.length} arbitre(s) détecté(s) — vérifiez avant d’importer :</div>
                  <div className="table-wrap" style={{ maxHeight: '30vh', overflow: 'auto' }}>
                    <table className="table" style={{ fontSize: 12 }}>
                      <thead><tr><th>Nom</th><th>Prénom</th><th>Grade</th><th>Région</th><th>Email</th></tr></thead>
                      <tbody>{importRows.map((r, i) => <tr key={i}><td>{r.nom}</td><td>{r.prenom}</td><td>{r.grade}</td><td>{r.region}</td><td>{r.email}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {error && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setImportOpen(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={doImport} disabled={busy || !importRows.length}>{busy ? 'Import…' : `Importer ${importRows.length || ''} arbitre(s)`}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
