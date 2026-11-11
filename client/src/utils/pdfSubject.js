// Reads a PDF with pdf.js (lazy-loaded so the main bundle stays lean) and
// guesses the letter's subject:
//   1. a line like "Objet : ..." / "Objet:..." / "الموضوع: ..."
//   2. otherwise the first meaningful line of text (official letters start
//      with the subject right after the letterhead).
// When the PDF has no readable text at all (a scan — just a photo of a page),
// the first page is rendered to a canvas and read with OCR (Tesseract.js,
// French + Arabic, self-hosted under /tess/ so nothing external is fetched).
// Returns '' when even OCR finds nothing — callers keep the file name.
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

// Tesseract worker is kept as a singleton: the OCR engine (~3 MB wasm +
// language data) loads once, then recognition is fast for further files.
let tessWorkerPromise = null;
let ocrQueue = Promise.resolve();
// Progress callback of the OCR job currently running (set by the caller).
let ocrProgressCb = null;
function getTessWorker() {
  if (!tessWorkerPromise) {
    tessWorkerPromise = import('tesseract.js').then((tesseract) =>
      tesseract.createWorker('fra+ara', 1, {
        workerPath: '/tess/worker.min.js',
        workerBlobURL: false, // direct same-origin worker; no blob needed
        corePath: '/tess/tesseract-core-simd-lstm.wasm.js',
        langPath: '/tess',
        logger: (m) => { if (m && m.status === 'recognizing text' && ocrProgressCb) ocrProgressCb('ocr', m.progress); },
      }),
    );
    // The engine setup (wasm + two language models) must not hang forever.
    tessWorkerPromise = Promise.race([
      tessWorkerPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR init timeout')), 120000)),
    ]).catch((e) => { tessWorkerPromise = null; throw e; });
  }
  return tessWorkerPromise;
}
// Serialize OCR jobs: the engine handles one recognition at a time.
function queueOcr(job) {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => {});
  return run;
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

// From a list of visual text lines, pick the best subject ('' when nothing
// convincing). Shared by the text-layer path and the OCR path.
export function sujetFromLines(lines) {
  for (const line of lines) {
    const m = line.match(OBJET_LABEL);
    if (m && clean(m[1])) return clean(m[1]).slice(0, 160);
  }
  let firstAny = '';
  for (const line of lines) {
    if (isNoise(line)) continue;
    if (!firstAny) firstAny = line;
    if (LETTERHEAD.test(line)) continue;
    return line.slice(0, 160);
  }
  return firstAny ? firstAny.slice(0, 160) : '';
}

export async function extractPdfSubject(file, onProgress) {
  if (!file || !/\.pdf$/i.test(file.name) || file.type === 'image/jpeg' || file.type === 'image/png') return '';
  let textSujet = '';
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, 2);
    const lines = [];
    for (let p = 1; p <= pages; p++) {
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
    }
    textSujet = sujetFromLines(lines);
    // Fast path: PDFs with almost no text are scans — remember how empty the
    // text layer was so we only OCR when it is worth it.
    const hasSomeText = lines.length >= 3;
    await task.destroy();
    if (textSujet) return textSujet;
    if (hasSomeText) return ''; // text layer exists but nothing usable; OCR would read the same
  } catch {
    // fall through to OCR — a corrupt text layer may still render fine
  }

  // ---- OCR fallback (scanned page) ----
  try {
    onProgress?.('ocr');
    ocrProgressCb = onProgress;
    return await queueOcr(async () => {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      // Render at a good OCR resolution (~1700px wide, clamped).
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1.5, 1700 / base.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      await task.destroy();

      const worker = await getTessWorker();
      const { data: res } = await worker.recognize(canvas);
      const ocrLines = String(res.text || '').split(/\r?\n/).map(clean).filter(Boolean);
      return sujetFromLines(ocrLines);
    }) || '';
  } catch {
    return ''; // OCR unavailable (old browser without SIMD, offline, …) — keep the file name
  } finally {
    ocrProgressCb = null;
  }
}
