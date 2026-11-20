import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtSize, transferChain } from '../utils';
import { downloadCsv, downloadXlsx, printPdf } from '../utils/exportFile';
import { extractPdfDetails } from '../utils/pdfExtract';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import PriorityPills from '../components/PriorityPills';
import LetterCreateModal from '../components/LetterCreateModal';

export default function Courrier() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const role = user?.role || 'agent';
  const isBureau = role === 'admin' || role === 'supervisor' || role === 'daf';
  const canCreate = isBureau || Boolean(user?.permissions?.create);
  const canDafStep = role === 'daf' || role === 'admin';
  const canFinalStep = role === 'supervisor' || role === 'admin';
  const canSeeTracking = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf' || Boolean(user?.permissions?.tracking);

  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [committees, setCommittees] = useState([]);
  const [users, setUsers] = useState([]); // employees for assignment
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ q: '', direction: '', statut: '', priorite: '', bucket: '', from: '', to: '', expediteur: '' });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAction, setBatchAction] = useState('');
  const [batchEmployee, setBatchEmployee] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingDirection, setPendingDirection] = useState('entrant');
  const [showCreate, setShowCreate] = useState(false);
  const [pending, setPending] = useState([]);
  const [singleFile, setSingleFile] = useState(null);
  const [assigningLetter, setAssigningLetter] = useState(null); // letter being assigned to employee

  const committeeName = (id) => committees.find((c) => c.id === id)?.nom || 'Sans comité';
  const employeeName = (id) => users.find((u) => u.id === id)?.name || id;

  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    Promise.all([api.committees(), api.users()])
      .then(([c, u]) => { setCommittees(c.items || []); setUsers(u.items || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.listLetters({ limit: 500, sort: 'date' })
      .then((d) => {
        if (cancelled) return;
        setAllItems(d.items || []);
        setTotal(d.total || 0);
        applyFilters();
      })
      .catch((e) => { setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  const applyFilters = () => {
    const fifteenDaysAgo = Date.now() - 15 * 24 * 3600 * 1000;
    let matched = allItems;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      matched = matched.filter((l) => {
        const hay = [(l.ref || ''), (l.numeroLettre || ''), (l.objet || ''), (l.expediteur?.nom || ''), (l.destinataire?.nom || '')].join(' ').toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      });
    }
    if (filters.direction) matched = matched.filter((l) => (l.direction || 'entrant') === filters.direction);
    if (filters.statut) matched = matched.filter((l) => (l.statut || 'recu') === filters.statut);
    if (filters.priorite) matched = matched.filter((l) => Array.isArray(l.priorite) ? l.priorite.includes(filters.priorite) : l.priorite === filters.priorite);
    if (filters.from) matched = matched.filter((l) => (l.dateEmission || l.createdAt) >= filters.from);
    if (filters.to) matched = matched.filter((l) => (l.dateEmission || l.createdAt) <= filters.to);
    if (filters.expediteur) {
      const e = filters.expediteur.toLowerCase();
      matched = matched.filter((l) => (l.expediteur?.nom || '').toLowerCase().includes(e));
    }
    if (filters.bucket === 'overdue') {
      matched = matched.filter((l) => (l.statut || 'recu') !== 'archive' && new Date(l.dateReception || l.dateEmission || l.createdAt).getTime() < fifteenDaysAgo);
    } else if (filters.bucket === 'pending') {
      matched = matched.filter((l) => (l.statut || 'recu') !== 'archive');
    }
    matched.sort((a, b) => new Date(b.dateReception || b.dateEmission || b.createdAt) - new Date(a.dateReception || a.dateEmission || a.createdAt));
    setItems(matched);
    setTotal(matched.length);
  };
  const hasFilters = Boolean(filters.q || filters.direction || filters.statut || filters.priorite || filters.bucket || filters.from || filters.to || filters.expediteur);

  const toggleSelect = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? new Set(items.map((l) => l.id)) : new Set());
  };
  const isSelected = (id) => selectedIds.has(id);
  const hasSelection = selectedIds.size > 0;
  const selectedItems = items.filter((l) => selectedIds.has(l.id));

  const hasValidationButtons = isBureau && (canDafStep || canFinalStep);

  const validateDaf = async (c) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.validateCourrierDaf(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé (étape DAF) — en attente de la validation finale.');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const validateFinal = async (c) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.validateCourrier(c.id, '');
      setNotice('Courrier ' + c.nom + ' validé — lettre créée.');
      setAssigningLetter(c);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.rejectCourrier(rejecting.id, reason);
      setNotice('Courrier ' + rejecting.nom + ' rejeté.');
      setRejecting(null); setReason('');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const loadPending = () => Promise.all([api.listCourriers('a_valider'), api.listCourriers('daf_valide')])
    .then(([a, b]) => setPending([...(a.items || []), ...(b.items || [])].sort((x, y) => String(y.uploadedAt).localeCompare(String(x.uploadedAt)))))
    .catch(() => {});
  useEffect(() => { loadPending(); }, []);

  const load = () => {
    loadPending();
    api.listLetters({ limit: 500, sort: 'date' })
      .then((d) => { setAllItems(d.items || []); setTotal(d.total || 0); applyFilters(); })
      .catch(() => {});
  };

  const exportHeaders = [
    { key: 'numeroLettre', label: 'N° courrier' },
    { key: 'objet', label: 'Objet' },
    { key: 'commission', label: 'Comité' },
    { key: 'direction', label: 'Direction' },
    { key: 'statut', label: 'Statut' },
    { key: 'priorite', label: 'Priorité' },
    { key: 'expediteur', label: 'Expéditeur' },
    { key: 'date', label: 'Date' },
  ];
  const exportRows = items.map((l) => ({
    numeroLettre: l.numeroLettre || l.ref || '',
    objet: l.objet || '',
    commission: committeeName(l.commission),
    direction: l.direction === 'sortant' ? 'Sortant' : 'Entrant',
    statut: t('status.' + (l.statut || 'recu')),
    priorite: l.priorite === 'urgente' ? 'Urgente' : l.priorite === 'confidentielle' ? 'Confidentielle' : 'Normale',
    expediteur: l.expediteur?.nom || '',
    date: fmtDate(l.dateReception || l.dateEmission),
  }));
  const doExport = async (format) => {
    try {
      const name = 'courriers';
      if (format === 'csv') downloadCsv(name, exportHeaders, exportRows);
      else if (format === 'xlsx') await downloadXlsx(name, exportHeaders, exportRows);
      else printPdf({ title: 'Courriers à valider', subtitle: [filters.q && 'Recherche : ' + filters.q, filters.from && 'du ' + filters.from, filters.to && 'au ' + filters.to].filter(Boolean).join(' · '), headers: exportHeaders, rows: exportRows, meta: { by: user?.name } });
    } catch { /* non-critical */ }
  };

  const assignTo = async (c, employeeId) => {
    setBusy(true); setError('');
    try {
      await api.assignCourrier(c.id, employeeId);
      setNotice(employeeId ? 'Responsable : ' + employeeName(employeeId) : 'Responsable retiré');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const assignEmployee = async (employeeId) => {
    if (!assigningLetter) return;
    setBusy(true); setError('');
    try {
      await api.assignCourrier(assigningLetter.id, employeeId);
      setNotice('Responsable : ' + employeeName(employeeId));
      setAssigningLetter(null);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const executeBatchAction = async (action) => {
    try {
      if (action === 'archive') {
        for (const l of selectedItems) {
          if (l.statut === 'archive') continue;
          await api.updateLetter(l.id, { statut: 'archive' });
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' archivé' + (selectedItems.length > 1 ? 's' : ''));
      } else if (action === 'employee') {
        if (!batchEmployee) { setError('Sélectionnez un employé'); return; }
        for (const l of selectedItems) {
          await api.updateLetter(l.id, { assignedTo: batchEmployee });
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' assigné' + (selectedItems.length > 1 ? 's' : '') + ' à ' + employeeName(batchEmployee));
      } else if (action === 'delete') {
        for (const l of selectedItems) {
          await api.deleteLetter(l.id);
        }
        setNotice(selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : '') + ' supprimé' + (selectedItems.length > 1 ? 's' : ''));
      } else if (action === 'export-csv' || action === 'export-xlsx' || action === 'export-pdf') {
        const headers = [
          { key: 'numeroLettre', label: 'N° courrier' },
          { key: 'objet', label: 'Objet' },
          { key: 'commission', label: 'Comité' },
          { key: 'direction', label: 'Direction' },
          { key: 'statut', label: 'Statut' },
          { key: 'priorite', label: 'Priorité' },
          { key: 'expediteur', label: 'Expéditeur' },
          { key: 'date', label: 'Date' },
        ];
        if (!filters.q) headers.splice(2, 0, { key: 'commission', label: 'Comité' });
        const rows = selectedItems.map((l) => ({
          numeroLettre: l.numeroLettre || l.ref || '',
          objet: l.objet || '',
          direction: l.direction === 'sortant' ? 'Sortant' : 'Entrant',
          statut: t('status.' + (l.statut || 'recu')),
          priorite: l.priorite === 'urgente' ? 'Urgente' : l.priorite === 'confidentielle' ? 'Confidentielle' : 'Normale',
          expediteur: l.expediteur?.nom || '',
          date: fmtDate(l.dateReception || l.dateEmission),
        }));
        if (action === 'export-csv') downloadCsv('courriers-selection', headers, rows);
        else if (action === 'export-xlsx') await downloadXlsx('courriers-selection', headers, rows);
        else printPdf({ title: 'Courriers — Sélection', subtitle: selectedItems.length + ' courrier' + (selectedItems.length > 1 ? 's' : ''), headers, rows, meta: { by: user?.name } });
      }
      setSelectedIds(new Set()); setBatchOpen(false); setBatchAction(''); setBatchEmployee('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const PRIORITY_LABELS = { normale: 'Normale', urgente: 'Urgente', confidentielle: 'Confidentielle' };

  const readFileAsBuffer = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });

  const handleFiles = async (files, direction = 'entrant') => {
    setPendingDirection(direction);
    setBusy(true); setError(''); setNotice('');
    const extracted = [];
    try {
      let readCount = 0;
      for (const file of files) {
        const details = await extractPdfDetails(file, (phase) => {
          if (phase === 'ocr') setNotice('Lecture de « ' + file.name + ' » (OCR du scan)…');
        });
        if (details.sujet) readCount++;
        extracted.push({ file, details, edited: { ...details } });
      }
      setPendingFiles(extracted);
      setReviewOpen(true);
      setNotice(files.length + ' fichier(s) prêt(s) à importer' + (readCount ? ` — champs lus automatiquement pour ${readCount}.` : '.'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const handleSingleFile = async (file, direction = 'entrant') => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const details = await extractPdfDetails(file, (phase) => {
        if (phase === 'ocr') setNotice('Lecture de « ' + file.name + ' » (OCR du scan)…');
      });
      await api.uploadCourrierFile(file, details.sujet, {
        expediteur: details.expediteur,
        dateEmission: details.dateEmission,
        priorite: details.priorite,
        reference: details.reference,
        categorie: details.categorie,
        direction,
      });
      setNotice('Courrier importé : ' + file.name + (details.sujet ? ' (sujet lu automatiquement)' : ''));
      setSingleFile(null);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const updateField = (fileIdx, field, value) => {
    setPendingFiles((prev) => prev.map((p, i) => i === fileIdx ? { ...p, edited: { ...p.edited, [field]: value } } : p));
  };

  const confirmImport = async () => {
    setBusy(true); setError(''); setReviewOpen(false);
    try {
      for (const p of pendingFiles) {
        await api.uploadCourrierFile(p.file, p.edited.sujet, {
          expediteur: p.edited.expediteur,
          dateEmission: p.edited.dateEmission,
          priorite: p.edited.priorite,
          reference: p.edited.reference,
          categorie: p.edited.categorie,
          direction: pendingDirection,
        });
      }
      setNotice(pendingFiles.length + ' courrier(s) importé(s).');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); setPendingFiles([]); }
  };

  const CATEGORY_LABELS = { administration: 'Administration', juridique: 'Juridique', finances: 'Finances', rh: 'Ressources humaines', communication: 'Communication', securite: 'Sécurité' };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-copy">
          <span className="page-title-kicker">Courriers à valider</span>
          <h1>Courriers à valider</h1>
          <div className="muted">{items.length} courrier{items.length === 1 ? '' : 's'} — DAF puis superviseur</div>
        </div>
        {hasSelection && (
          <div className="batch-bar">
            <span className="muted">{selectedIds.size} courrier{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleSelectAll(false)}>Tout désélectionner</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('archive'); setBatchOpen(true); }}>Archiver la sélection</button>
            {isBureau && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('employee'); setBatchOpen(true); }}>Assigner à un employé</button>}
            <button type="button" className="btn btn-danger btn-sm" onClick={() => { setBatchAction('delete'); setBatchOpen(true); }}>Supprimer la sélection</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-csv'); setBatchOpen(true); }}>Exporter CSV</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-xlsx'); setBatchOpen(true); }}>Exporter Excel</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBatchAction('export-pdf'); setBatchOpen(true); }}>Exporter PDF</button>
          </div>
        )}
        {!hasSelection && (
          <div className="page-actions">
            <div style={{ display: 'flex', gap: 8 }}>
              {canCreate && <button type="button" className="btn btn-primary btn-add" style={{ gap: 6 }} onClick={() => setShowCreate(true)}>
                <span className="plus" aria-hidden="true">+</span><span className="btn-label">Ajouter un courrier</span>
              </button>}
              <label className="btn btn-secondary" title="Téléverser un ou plusieurs scans à valider" style={{ cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Téléversement...' : 'Courrier'}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style={{ display: 'none' }} disabled={busy}
                  onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length === 1) handleSingleFile(f[0]); else if (f.length > 1) handleFiles(f); }} />
              </label>
            </div>
            {isBureau && <button className="btn btn-secondary" onClick={() => navigate('/courriers-rejetes')}>Courriers rejetés</button>}
          </div>
        )}
      </div>

      {notice && <div className="account-notice" role="status">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><h2 style={{ margin: 0, fontSize: 16 }}>Scans en attente de validation ({pending.length})</h2></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fichier</th><th>Type</th><th>Téléversé par</th><th>Date</th><th>Étape</th><th>Actions</th></tr></thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td><span className="file-pill">Fichier {c.nom}</span>{c.sujet && <div className="muted small" style={{ marginTop: 4 }}>Titre lu : {c.sujet}</div>}<div className="muted small">{fmtSize(c.taille)}</div></td>
                  <td><span className={'direction-pill direction-' + (c.direction === 'sortant' ? 'sortant' : 'entrant')}><i />{c.direction === 'sortant' ? 'Départ' : 'Arrivée'}</span></td>
                  <td>{c.uploadedByName || '—'}</td>
                  <td className="date-cell">{fmtDate(c.uploadedAt)}</td>
                  <td>{c.status === 'daf_valide'
                    ? <span className="badge statut-en_cours" title={c.dafValidatedByName ? `Validé par ${c.dafValidatedByName}` : ''}>DAF ✓ · superviseur requis</span>
                    : <span className="badge statut-recu">DAF requis</span>}</td>
                  <td>
                    <div className="row-actions" style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
                      <button className="btn btn-ghost" onClick={() => api.openCourrierFile(c.id, c.nom).catch((e) => setError(e.message))} onMouseEnter={() => api.warmFile('courrier', c.id)} onTouchStart={() => api.warmFile('courrier', c.id)}>Voir</button>
                      {isBureau && c.status === 'a_valider' && canDafStep && role !== 'admin' && <button className="btn btn-primary" onClick={() => validateDaf(c)} disabled={busy} title="Validation DAF (étape 1)">Valider (DAF)</button>}
                      {isBureau && c.status === 'a_valider' && role === 'admin' && <button className="btn btn-primary" onClick={() => validateFinal(c)} disabled={busy} title="Validation directe (les deux étapes)">Valider (2 étapes)</button>}
                      {isBureau && c.status === 'a_valider' && role === 'supervisor' && <span className="muted small">En attente du DAF</span>}
                      {isBureau && c.status === 'daf_valide' && canFinalStep && <button className="btn btn-primary" onClick={() => validateFinal(c)} disabled={busy} title="Validation finale (étape 2)">Valider (final)</button>}
                      {isBureau && c.status === 'daf_valide' && !canFinalStep && <span className="muted small">En attente du superviseur</span>}
                      {isBureau && <button className="btn btn-danger" onClick={() => { setRejecting(c); setReason(''); }} disabled={busy}>Rejeter</button>}
                      {isBureau && <div style={{ minWidth: 170 }}><Select ariaLabel="Responsable" value={c.assignedTo || ''} onChange={(v) => assignTo(c, v)} disabled={busy} options={[{ value: '', label: 'Responsable…' }, ...users.filter((u) => ['admin', 'supervisor', 'daf'].includes(u.role)).map((u) => ({ value: u.id, label: u.name || u.username }))]} /></div>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}


      {rejecting && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setRejecting(null); setReason(''); } }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Rejeter le courrier</h2><button type="button" className="modal-close" onClick={() => { setRejecting(null); setReason(''); }}>x</button></header>
            <div className="modal-body">
              <p className="muted">Fichier : <strong>{rejecting.nom}</strong></p>
              <label className="field">Motif du rejet
                <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: document illisible, mauvais format, etc." />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => { setRejecting(null); setReason(''); }}>Annuler</button>
              <button className="btn btn-danger" onClick={reject} disabled={busy || !reason.trim()}>{busy ? 'Rejet...' : 'Rejeter'}</button>
            </div>
          </section>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setReviewOpen(false); setPendingFiles([]); } }}>
          <section className="modal" style={{ width: 'min(960px, 92vw)' }} role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Confirmer l'import — champs lus par l'OCR</h2><button type="button" className="modal-close" onClick={() => { setReviewOpen(false); setPendingFiles([]); }}>x</button></header>
            <div className="modal-body">
              <p className="muted">Vérifiez et corrigez les champs lus automatiquement sur chaque scan avant l'import.</p>
              <div className="table-wrap" style={{ maxHeight: '64vh', overflow: 'auto', marginTop: 10 }}>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr>
                    <th style={{ width: '26%' }}>Fichier</th>
                    <th>Sujet (objet)</th>
                    <th>Expéditeur</th>
                    <th>Date</th>
                    <th>Priorité</th>
                    <th>Référence</th>
                    <th>Catégorie</th>
                  </tr></thead>
                  <tbody>
                    {pendingFiles.map((p, i) => (
                      <tr key={i}>
                        <td className="mono nowrap" style={{ fontSize: 12 }}>{p.file.name}</td>
                        <td><input className="form-input" value={p.edited.sujet} onChange={(e) => updateField(i, 'sujet', e.target.value)} /></td>
                        <td><input className="form-input" value={p.edited.expediteur} onChange={(e) => updateField(i, 'expediteur', e.target.value)} /></td>
                        <td><input className="form-input" value={p.edited.dateEmission} onChange={(e) => updateField(i, 'dateEmission', e.target.value)} placeholder="jj/mm/aaaa" /></td>
                        <td><select className="form-input" value={p.edited.priorite} onChange={(e) => updateField(i, 'priorite', e.target.value)}>
                          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></td>
                        <td><input className="form-input" value={p.edited.reference} onChange={(e) => updateField(i, 'reference', e.target.value)} /></td>
                        <td><select className="form-input" value={p.edited.categorie} onChange={(e) => updateField(i, 'categorie', e.target.value)}>
                          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></td>
                      </tr>
                    ))}
                    {pendingFiles.length === 0 && <tr><td colSpan={7} className="empty-cell">Aucun fichier.</td></tr>}
                  </tbody>
                </table>
              </div>
              {pendingFiles.some((p) => p.usedOcr) && <p className="muted small" style={{ marginTop: 8 }}>Certains fichiers ont été lus par OCR (scan sans couche texte) — vérifiez particulièrement les noms et dates.</p>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => { setReviewOpen(false); setPendingFiles([]); }}>Annuler</button>
              <button className="btn btn-primary" onClick={confirmImport} disabled={busy}>{busy ? 'Import…' : 'Importer tout'}</button>
            </div>
          </section>
        </div>
      )}

      {assigningLetter && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAssigningLetter(null); }}>
          <section className="modal" role="dialog" aria-modal="true">
            <header className="modal-head"><h2>Responsable du courrier</h2><button type="button" className="modal-close" onClick={() => setAssigningLetter(null)} aria-label="Fermer">×</button></header>
            <div className="modal-body">
              <p className="muted">{assigningLetter.sujet || assigningLetter.nom}</p>
              <label className="field">Responsable
                <Select ariaLabel="Employé" value={assigningLetter.assignedTo || ''} onChange={(v) => assignEmployee(v)} options={[{ value: '', label: '— Choisir un employé —' }, ...users.filter((u) => ['admin', 'supervisor', 'daf'].includes(u.role)).map((u) => ({ value: u.id, label: u.name || u.username }))]} />
              </label>
              <p className="muted small">Employés de l’administration uniquement. Il sera responsable de la lettre une fois le courrier validé.</p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setAssigningLetter(null)}>Plus tard</button>
            </div>
          </section>
        </div>
      )}
      {showCreate && <LetterCreateModal onClose={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}
