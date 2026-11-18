// Reads a scanned PDF (or image) and extracts the letter's key fields:
//   sujet, expediteur, dateEmission, priorite, reference, categorie.
//   1. text layer (pdf.js) — fast, exact
//   2. OCR fallback (Tesseract.js, French + Arabic, self-hosted under /tess/)
// Returns empty strings for anything not found — callers keep defaults.
// Nothing is sent to an external service: pdf.js + tesseract run entirely
// in the browser.
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

let tessWorkerPromise = null;
let ocrQueue = Promise.resolve();
let ocrProgressCb = null;
function getTessWorker() {
  if (!tessWorkerPromise) {
    tessWorkerPromise = import('tesseract.js').then((tesseract) =>
      tesseract.createWorker('fra+ara', 1, {
        workerPath: '/tess/worker.min.js',
        workerBlobURL: false,
        corePath: '/tess/tesseract-core-simd-lstm.wasm.js',
        langPath: '/tess',
        logger: (m) => { if (m && m.status === 'recognizing text' && ocrProgressCb) ocrProgressCb('ocr', m.progress); },
      }),
    );
    tessWorkerPromise = Promise.race([
      tessWorkerPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR init timeout')), 120000)),
    ]).catch((e) => { tessWorkerPromise = null; throw e; });
  }
  return tessWorkerPromise;
}
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
  if (!line || line.length < 6) return true;
  if (/^[\d\s./-]+$/.test(line)) return true;
  if (/^(page|page \d+|\d+\s*\/\s*\d+)$/i.test(line)) return true;
  return false;
};

// ---------- Subject ----------
const OBJET_LABEL = /(?:^|\s)(?:objets?|sujets?|objet\b|le sujet|الموضوع|موضوع)\s*[:：]\s*(.*)$/i;
const LETTERHEAD = /^(?:r[ée]publique|republic|minist[èe]re|f[ée]d[ée]ration|secr[ée]tariat|direction| république |وزارة|جامعة|مديرية|presidence|présidence)/i;

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
};

// ---------- Sender ----------
const SENDER_LABELS = /(?:^|\s)(?:exp[eé]diteur|de\s*[:：]|par\s*[:：]|[\u062f\u0646]\s*[:：]|from\s*[:：])\s*(.+)$/i;
const SENDER_NOISE = /^(?:objet|sujet|date|réf|ref|num|téléphone|tel|fax|email|courrier|lettre|monsieur|madame|à\s*[:：]|destinataire)/i;

export function expediteurFromLines(lines) {
  for (const line of lines) {
    const m = line.match(SENDER_LABELS);
    if (m && clean(m[1]).length > 4 && !SENDER_NOISE.test(clean(m[1]))) {
      return clean(m[1]).slice(0, 120);
    }
  }
  // fallback: first non-noise, non-letterhead line that looks like an org/person
  for (const line of lines) {
    if (isNoise(line) || LETTERHEAD.test(line)) continue;
    if (/^(?:objet|sujet|date|réf|ref|num|destinataire|à\s*[:：])/i.test(line)) continue;
    return clean(line).slice(0, 120);
  }
  return '';
};

// ---------- Date ----------
const DATE_LABELS = /(?:^|\s)(?:date\s*[:：]|le\s+|dated\s*[:：]|[\u062a\u0627\u0640]\s*[:：])\s*(.+)$/i;
const DATE_PATTERN = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
const DATE_FRENCH = /\b(\d{1,2})\s+(janv|f[ée]vr|mar|avr|mai|juin|juil|ao[ûu]t|sep|oct|nov|d[ée]c)[a-z]*\s+(\d{2,4})\b/i;

export function dateFromLines(lines) {
  for (const line of lines) {
    const m = line.match(DATE_LABELS);
    if (m) {
      const d = parseDate(clean(m[1]));
      if (d) return d;
    }
    const m2 = line.match(DATE_PATTERN);
    if (m2) {
      const d = parseDate(m2[1]);
      if (d) return d;
    }
    const m3 = line.match(DATE_FRENCH);
    if (m3) {
      return isoFromFrench(m3[1], m3[2], m3[3]);
    }
  }
  return '';
};

const MONTHS = { janv: 1, fevr: 2, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const parseDate = (s) => {
  s = clean(s);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const fullY = y < 100 ? 2000 + y : y;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${fullY}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
};
const isoFromFrench = (d, moName, y) => {
  const mo = MONTHS[moName.toLowerCase().replace(/[ûu]/g,'u')];
  const fullY = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  if (mo && Number(d) >= 1 && Number(d) <= 31) return `${fullY}-${String(mo).padStart(2,'0')}-${String(Number(d)).padStart(2,'0')}`;
  return null;
};

// ---------- Priority ----------
const PRIORITY_PATTERNS = [
  [/urgent[e]?|tr[\u00e8e]s\s+urgent|imm[ée]diat|prioritaire/i, 'urgente'],
  [/confidentiel[le]?|secret|r[ée]serv[e]?/i, 'confidentielle'],
];
export function prioriteFromLines(lines) {
  for (const [re, val] of PRIORITY_PATTERNS) {
    for (const line of lines) {
      if (re.test(line)) return val;
    }
  }
  return 'normale';
};

// ---------- Reference ----------
const REF_LABELS = /(?:^|\s)(?:r[eé]f(?:[eé]rence)?|n[°º]\s*[:：]?|num[ée]ro|lettre\s*n[°º]|courrier\s*n[°º])\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9/\- ]{2,30})$/i;
const REF_STANDALONE = /\b(BO-\d{4}-\d{4}|[A-Z]{2}-\d{4}-\d{4}|[A-Z]{1,3}\d{3,6})\b/;
export function referenceFromLines(lines) {
  for (const line of lines) {
    const m = line.match(REF_LABELS);
    if (m && clean(m[1])) return clean(m[1]).slice(0, 40);
    const m2 = line.match(REF_STANDALONE);
    if (m2 && !LETTERHEAD.test(m2[0])) return m2[0];
  }
  return '';
};

// ---------- Category ----------
const CAT_KEYWORDS = [
  [/juridique|contentieux|proc[èe]s|plainte|r[eè]clamation/i, 'juridique'],
  [/finance|budget|facture|paiement|comptabilit/i, 'finances'],
  [/rh|ressources\s+humaines|personnel|recrutement|contrat de travail/i, 'rh'],
  [/communication|presse|m[ée]dia|publication|campagne/i, 'communication'],
  [/s[ée]curit|protection|gardien|acc[èe]s/i, 'securite'],
  [/administration|g[ée]n[ée]ral|administratif|courrier/i, 'administration'],
];
export function categorieFromLines(lines) {
  const text = lines.join(' ').toLowerCase();
  for (const [re, val] of CAT_KEYWORDS) {
    if (re.test(text)) return val;
  }
  return 'administration';
};

// ---------- Public: extract everything from a file ----------
export const DETAIL_LABELS = ['sujet','expediteur','dateEmission','priorite','reference','categorie'];

export async function extractPdfDetails(file, onProgress) {
  const empty = { sujet:'', expediteur:'', dateEmission:'', priorite:'normale', reference:'', categorie:'administration' };
  if (!file) return empty;
  const isPdf = /\.pdf$/i.test(file.name);
  const isImage = /\.(jpe?g|png)$/i.test(file.name);
  if (!isPdf && !isImage) return empty;

  let lines = [];
  let usedOcr = false;

  // ---- text layer (PDF only) ----
  if (isPdf) {
    try {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
      const doc = await task.promise;
      const pages = Math.min(doc.numPages, 2);
      for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let current = '', currentY = null;
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
      await task.destroy();
    } catch { /* fall through to OCR */ }
  }

  // ---- OCR fallback (scanned page or image file) ----
  if (lines.length < 3) {
    usedOcr = true;
    try {
      onProgress?.('ocr');
      ocrProgressCb = onProgress;
      const ocrText = await queueOcr(async () => {
        if (isPdf) {
          const pdfjs = await loadPdfjs();
          const data = new Uint8Array(await file.arrayBuffer());
          const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
          const doc = await task.promise;
          const page = await doc.getPage(1);
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
          return String(res.text || '');
        }
        // image file: recognize directly
        const worker = await getTessWorker();
        const img = await loadImage(file);
        const { data: res } = await worker.recognize(img);
        return String(res.text || '');
      }) || '';
      lines = String(ocrText).split(/\r?\n/).map(clean).filter(Boolean);
    } catch {
      // OCR unavailable — return empty
    } finally {
      ocrProgressCb = null;
    }
  }

  return {
    sujet: sujetFromLines(lines).slice(0, 160),
    expediteur: expediteurFromLines(lines).slice(0, 120),
    dateEmission: dateFromLines(lines),
    priorite: prioriteFromLines(lines),
    reference: referenceFromLines(lines).slice(0, 40),
    categorie: categorieFromLines(lines),
    usedOcr,
  };
};

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('cannot load image')); };
    img.src = url;
  });
}

// Backward-compatible: subject only.
export async function extractPdfSubject(file, onProgress) {
  const d = await extractPdfDetails(file, onProgress);
  return d.sujet;
};
