import { useEffect, useRef } from 'react';

/**
 * Simple dialog. Closes with the × button or the Escape key (not by clicking outside,
 * so a stray click never throws away what was typed in a form).
 */
export default function Modal({ title, onClose, closeLabel = 'Fermer', children }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={closeLabel}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
