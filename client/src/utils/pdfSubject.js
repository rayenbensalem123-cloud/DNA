// Reads a PDF with pdf.js (lazy-loaded so the main bundle stays lean) and
// guesses the letter's subject:
//   1. a line like "Objet : ..." / "Objet:..." / "الموضوع: ..."
//   2. otherwise the first meaningful line of text (official letters start
//      with the subject right after the letterhead).
// Returns '' when the PDF has no readable text (a scanned image) — callers
// then keep the current behavior (file name).
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const clean = (text) => String(text || '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isNoise = (line) => {
  // Dates, page numbers, lone numbers, very short fragments.
  if (!line || line.length < 8) return true;
  if (/^[\d\s./-]+$/.test(line)) return true;
  if (/^(page|page \d+|\d+\s*\/\s*\d+)$/i.test(line)) return true;
  return false;
};

const OBJET_LABEL = /(?:^|\s)(?:objets?|sujets?|الموضوع|موضوع)\s*[:：]\s*(.*)$/i;
// Letterhead lines (institution names) are not useful as a subject.
const LETTERHEAD = /^(?:r[ée]publique|republic|minist[èe]re|f[ée]d[ée]ration|secr[ée]tariat|direction|جمهورية|وزارة|جامعة|مديرية)/i;

export async function extractPdfSubject(file) {
  if (!file || !/\.pdf$/i.test(file.name) || file.type === 'image/jpeg' || file.type === 'image/png') return '';
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, 2);
    let objetLine = '';
    const lines = [];
    for (let p = 1; p <= pages && !objetLine; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Rebuild visual lines: pdf.js reports text runs; group them by baseline.
      let current = '';
      let currentY = null;
      const flush = () => { const l = clean(current); if (l) lines.push(l); current = ''; };
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform ? item.transform[5] : null;
        if (currentY !== null && y !== null && Math.abs(y - currentY) > 3) flush();
        current += (current && !/\s$/.test(current) && !/^\s/.test(item.str) ? ' ' : '') + item.str;
        if (y !== null) currentY = y;
        if (item.hasEOL) { flush(); currentY = null; }
      }
      flush();
      page.cleanup();
      // Prefer an explicit "Objet :" line.
      for (const line of lines) {
        const m = line.match(OBJET_LABEL);
        if (m) { objetLine = clean(m[1]); break; }
      }
    }
    await task.destroy();
    if (objetLine) return objetLine.slice(0, 160);
    // Fallback: first meaningful line that is not a letterhead; else any.
    let firstAny = '';
    for (const line of lines) {
      if (isNoise(line)) continue;
      if (!firstAny) firstAny = line;
      if (LETTERHEAD.test(line)) continue;
      return line.slice(0, 160);
    }
    return firstAny.slice(0, 160);
  } catch {
    return '';
  }
}
