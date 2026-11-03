import { useState } from 'react';
import { api, setToken } from '../api';
import { useLanguage } from '../i18n';
import Modal from './Modal';

export default function ChangePassword({ onClose }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError(t('password.tooShort'));
    if (next !== confirm) return setError(t('password.mismatch'));
    setBusy(true);
    try {
      const d = await api.changePassword(current, next);
      setToken(d.token); // the old session just ended; this one replaces it
      setDone(true);
    } catch (err) {
      setError(err.message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('password.title')} onClose={onClose} closeLabel={t('common.close')}>
      {done ? (
        <>
          <div className="modal-body"><div className="form-notice">{t('password.saved')}</div></div>
          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>
          </div>
        </>
      ) : (
        <form className="modal-form" onSubmit={submit}>
          <div className="modal-body">
            <label className="field">
              <span>{t('password.current')}</span>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
            <label className="field">
              <span>{t('password.new')}</span>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            <label className="field">
              <span>{t('password.confirm')}</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
            <div className="muted">{t('password.hint')}</div>
          </div>
          {error && <div className="modal-error"><div className="form-error">{error}</div></div>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
