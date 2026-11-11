import { useEffect, useState } from 'react';

// Module-level registry: any code (api.js, pages…) can open a document in the
// in-app viewer without prop drilling. PdfViewer is mounted once in Layout.
//
// openPdf({ title }) opens the modal immediately (spinner), a second
// openPdf({ url, mime }) fills it in — so clicking "Voir" shows the viewer
// before the link request even returns.
let current = null;
const listeners = new Set();

export function openPdf(patch = {}) {
  current = { url: '', title: '', mime: '', ...(current || {}), ...patch };
  if (!current.title && !current.url) return;
  listeners.forEach((fn) => fn(current));
}

export function closePdf() {
  if (current?.url?.startsWith('blob:')) URL.revokeObjectURL(current.url);
  current = null;
  listeners.forEach((fn) => fn(null));
}

export default function PdfViewer() {
  const [doc, setDoc] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fn = (d) => setDoc(d);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => { setLoaded(false); }, [doc?.url]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e) => { if (e.key === 'Escape') closePdf(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('pdf-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('pdf-open');
    };
  }, [doc]);

  if (!doc) return null;

  const isPdf = (doc.mime || '').includes('pdf') || /\.pdf$/i.test(doc.title || '');
  const isImage = (doc.mime || '').startsWith('image/');
  const label = doc.title || 'Document';

  return (
    <div className="pdf-backdrop" onClick={closePdf} role="dialog" aria-modal="true" aria-label={label}>
      <div className="pdf-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-head">
          <div className="pdf-head-title" title={label}>{label}</div>
          <button className="pdf-close" type="button" onClick={closePdf} aria-label="Fermer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="pdf-body">
          {doc.url && isImage && <img src={doc.url} alt={label} onLoad={() => setLoaded(true)} />}
          {doc.url && !isImage && <iframe src={doc.url} title={label} onLoad={() => setLoaded(true)} />}
          {!loaded && (
            <div className="pdf-loading" aria-live="polite">
              <div className="pdf-spinner" aria-hidden="true" />
              <span>Chargement du document…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
