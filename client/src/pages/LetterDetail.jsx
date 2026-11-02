import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { fmtDate, fmtDateTime, fmtSize } from '../utils';

export default function LetterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [letter, setLetter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statut, setStatut] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    // The list endpoint is the only read endpoint; find by id from a full scan.
    api.listLetters({ limit: 500, sort: 'date' })
      .then((d) => {
        const found = d.items.find((l) => l.id === id) || null;
        if (cancelled) return;
        setLetter(found);
        setStatut(found ? found.statut : '');
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError('Erreur'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const saveStatus = async () => {
    if (!letter) return;
    try {
      const d = await api.updateLetter(letter.id, { statut });
      setLetter(d.item);
      setStatut(d.item.statut);
    } catch (e) { setError(e.message || 'Erreur'); }
  };

  const remove = async () => {
    if (!letter) return;
    try {
      await api.deleteLetter(letter.id);
      navigate('/lettres');
    } catch (e) { setError(e.message || 'Erreur'); }
  };

  if (loading) return <div className="page"><div className="card">{t('common.loading')}</div></div>;
  if (error) return <div className="page"><div className="card">{error}</div></div>;
  if (!letter) return <div className="page"><div className="card">Introuvable</div></div>;

  const canManage = user?.role === 'admin' || user?.role === 'agent';

  const info = (key, value) => (
    <div key={key} className="detail-row">
      <div className="detail-label">{t(key)}</div>
      <div className="detail-value">{value}</div>
    </div>
  );

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>{t('detail.title')} — {letter.ref}</h1>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/lettres')}>{t('detail.back')}</button>
          {canManage && <button className="btn btn-danger" onClick={remove}>{t('detail.delete')}</button>}
        </div>
      </div>
      <div className="card">
        {info('detail.ref', letter.ref)}
        {info('detail.objet', letter.objet)}
        {info('detail.resume', letter.resume)}
        {info('detail.direction', t('direction.' + (letter.direction || 'entrant')))}
        {info('detail.type', t('type.' + (letter.type || 'autre')))}
        {info('detail.categorie', t('categorie.' + (letter.categorie || 'autre')))}
        {info('detail.statut', t('status.' + (letter.statut || 'recu')))}
        {info('detail.priorite', t('priorite.' + (letter.priorite || 'normale')))}
        {info('detail.expediteur', [letter.expediteur?.nom, letter.expediteur?.fonction, letter.expediteur?.service].filter(Boolean).join(' — ') || '—')}
        {info('detail.destinataire', [letter.destinataire?.nom, letter.destinataire?.fonction, letter.destinataire?.service].filter(Boolean).join(' — ') || '—')}
        {info('detail.dateEmission', fmtDate(letter.dateEmission))}
        {info('detail.dateReception', fmtDate(letter.dateReception))}
        {info('detail.pieces', (letter.pieces || []).map((p) => p.nom + (p.taille ? ' (' + fmtSize(p.taille) + ')' : '')).join(', ') || '—')}
      </div>
      {canManage && (
        <div className="card">
          <h2 className="card-title">{t('detail.actions')}</h2>
          <div className="status-actions">
            <select value={statut} onChange={(e) => setStatut(e.target.value)}>
              {['recu', 'enregistre', 'en_cours', 'traite', 'transmis', 'archive'].map((s) => (
                <option key={s} value={s}>{t('status.' + s)}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={saveStatus}>{t('common.save')}</button>
          </div>
          <div className="muted">{fmtDateTime(letter.createdAt)}</div>
        </div>
      )}
    </div>
  );
}
