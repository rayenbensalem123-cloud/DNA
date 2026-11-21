// OCR multi-langue (français + anglais + arabe) pour lire n'importe quel scan.
// Stratégie:
//   1. text layer pdf.js — si riche et cohérent, on l'utilise direct
//   2. sinon: OCR (Tesseract.js) sur TOUTES les pages, avec pré-traitement
//      (grayscale + contraste + upscale) pour maximiser la reconnaissance
//   3. extraction des champs avec labels FR / EN / AR + heuristiques
// Tout tourne dans le navigateur, aucune donnée n'est envoyée ailleurs.
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
const OCR_LANGS = 'fra+eng+ara';
function getTessWorker() {
  if (!tessWorkerPromise) {
    tessWorkerPromise = import('tesseract.js').then((tesseract) =>
      tesseract.createWorker(OCR_LANGS, 1, {
        workerPath: '/tess/worker.min.js',
        workerBlobURL: false,
        corePath: '/tess/tesseract-core-simd-lstm.wasm.js',
        langPath: '/tess',
        logger: (m) => {
          if (ocrProgressCb && m && m.status === 'recognizing text') ocrProgressCb('ocr', m.progress || 0);
        },
      }),
    );
    tessWorkerPromise = Promise.race([
      tessWorkerPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OCR init timeout')), 180000)),
    ]).catch((e) => { tessWorkerPromise = null; throw e; });
  }
  return tessWorkerPromise;
}
function queueOcr(job) {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => {});
  return run;
}

// ---------- Nettoyage / normalisation ----------
const clean = (text) => String(text || '')
  .replace(/\r/g, ' ')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/[\u064B-\u065F\u0670]/g, '') // diacritiques arabes (pour matcher les labels)
  .replace(/\s+/g, ' ')
  .trim();

const isNoise = (line) => {
  if (!line || line.length < 4) return true;
  if (/^[\d\s./\-:]+$/.test(line)) return true;
  if (/^(page|page\s*\d+|\d+\s*\/\s*\d+)$/i.test(line)) return true;
  return false;
};

// ---------- Labels multilingues (FR / EN / AR) ----------
const SUBJECT_LABEL = /(?:^|[\s:：])(?:objet|sujet|subject|obj\b|الموضوع|موضوع|الغرض)\s*[:：]\s*(.*)$/i;
const SENDER_LABEL  = /(?:^|[\s:：])(?:exp[eé]diteur|de\s*[:：]|par\s*[:：]|from|sender|issued\s+by|المرسل|مقدم الطلب|جهة الارسال|الجهة\s*[:：])\s*[:：]?\s*(.+)$/i;
const DATE_LABEL    = /(?:^|[\s:：])(?:date|le\s+|dated|on\s+|التاريخ|تاريخ)\s*[:：]?\s*(.+)$/i;
const REF_LABEL     = /(?:^|[\s:：])(?:r[eé]f(?:[eé]rence)?|reference|n[°º]|num(?:éro|ero|ber)?|lettre\s*n[°º]|courrier\s*n[°º]|الرقم|رقم)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9/\-_. ]{1,40})$/i;

const LETTERHEAD = /^(?:r[ée]publique|republic|minist[èe]re|ministry|f[ée]d[ée]ration|federation|secr[ée]tariat|direction|division|d[ée]partement|department|وزارة|جامعة|مديرية|الجمهورية|مصلحة)/i;
const FIELD_WORDS = /^(?:objet|sujet|subject|date|from|to|r[eé]f|ref|num|exp[eé]diteur|destinataire|recipient|الموضوع|التاريخ|المرسل|الرقم|إلى|الى)\b/i;

function firstLabelled(lines, re, minLen = 3) {
  for (const line of lines) {
    const m = line.match(re);
    if (m && m[m.length - 1] && clean(m[m.length - 1]).length >= minLen) {
      return clean(m[m.length - 1]);
    }
  }
  return '';
}

export function sujetFromLines(lines) {
  const s = firstLabelled(lines, SUBJECT_LABEL, 3);
  if (s && !FIELD_WORDS.test(s)) return s.slice(0, 200);
  // fallback: première ligne meaningful hors letterhead/champs
  for (const line of lines) {
    if (isNoise(line) || LETTERHEAD.test(line) || FIELD_WORDS.test(line)) continue;
    return clean(line).slice(0, 200);
  }
  return '';
}

export function expediteurFromLines(lines) {
  const s = firstLabelled(lines, SENDER_LABEL, 3);
  if (s && !FIELD_WORDS.test(s)) return s.slice(0, 140);
  for (const line of lines) {
    if (isNoise(line) || LETTERHEAD.test(line) || FIELD_WORDS.test(line)) continue;
    return clean(line).slice(0, 140);
  }
  return '';
}

// ---------- Date (FR / EN / AR + formats) ----------
const MONTHS = {
  janv:1, jan:1, fevr:2, fev:2, feb:2, mar:3, mars:3, apr:4, avr:4, mai:5, may:5,
  juin:6, jun:6, juil:7, jul:7, aout:8, aou:8, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12, decembre:12,
  janvier:1, fevrier:2, mars:3, avril:4, mai:5, juin:6, juillet:7, aout:8, septembre:9, octobre:10, novembre:11, decembre:12,
};
const parseNumeric = (s) => {
  s = clean(s);
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);   // jj/mm/aaaa
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);          // aaaa-mm-jj
  if (m) return toIso(+m[3], +m[2], +m[1]);
  return null;
};
const toIso = (d, mo, y) => {
  if (y < 100) y += 2000;
  if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  return null;
};
const parseNamed = (d, moName, y) => {
  const key = moName.toLowerCase().replace(/[ûu]/g,'u').replace(/[^a-z]/g,'');
  const mo = MONTHS[key] || MONTHS[key.slice(0, 4)] || MONTHS[key.slice(0, 3)];
  return mo ? toIso(+d, mo, +y) : null;
};
const MONTH_NAMES = 'janv|janvier|f[ée]vr|f[ée]vrier|fev|feb|mars?|avril|avr|mai|may|juin|jun|juillet|juil|jul|ao[ûu]t|aou|aug|sept|septembre|sep|oct|octobre|nov|novembre|d[ée]c|d[ée]cembre';
const DATE_PATTERNS = [
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/,
  /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
  new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})[a-z]*\\s+(\\d{2,4})\\b`, 'i'),
  new RegExp(`\\b(${MONTH_NAMES})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{2,4})\\b`, 'i'),
];
export function dateFromLines(lines) {
  for (const line of lines) {
    const labelled = firstLabelled(lines, DATE_LABEL, 4);
    if (labelled) {
      const d = parseNumeric(labelled) || (() => {
        for (const re of DATE_PATTERNS) { const m = labelled.match(re); if (m) {
          if (/^\d{4}$/.test(m[1])) return toIso(+m[3], +m[2], +m[1]);
          if (/^\d+$/.test(m[1])) return parseNamed(m[1], m[2], m[3]);
          return parseNamed(m[2], m[1], m[3]);
        } }
        return null;
      })();
      if (d) return d;
    }
    for (const re of DATE_PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      if (/^\d{4}$/.test(m[1])) { const d = toIso(+m[3], +m[2], +m[1]); if (d) return d; }
      else if (/^\d+$/.test(m[1])) { const d = parseNamed(m[1], m[2], m[3]); if (d) return d; }
      else { const d = parseNamed(m[2], m[1], m[3]); if (d) return d; }
    }
  }
  return '';
}

// ---------- Priorité (FR / EN / AR) ----------
const PRIORITY_PATTERNS = [
  [/urgent|immediate|prioritaire|asap|عاجل|استعجال|عاجلة/i, 'urgente'],
  [/confidentiel|confidential|secret|priv[eé]|سري|سريعة|مكتوم/i, 'confidentielle'],
];
export function prioriteFromLines(lines) {
  const text = lines.join(' ');
  for (const [re, val] of PRIORITY_PATTERNS) if (re.test(text)) return val;
  return 'normale';
}

// ---------- Référence (FR / EN / AR) ----------
const REF_STANDALONE = /\b(BO-\d{4}-\d{4}|[A-Z]{2,4}-\d{2,4}-\d{3,6}|[A-Z]{1,4}[-/]?\d{3,6})\b/;
export function referenceFromLines(lines) {
  const labelled = firstLabelled(lines, REF_LABEL, 2);
  if (labelled) return labelled.slice(0, 60);
  for (const line of lines) {
    const m = line.match(REF_STANDALONE);
    if (m && !LETTERHEAD.test(m[0])) return m[0];
  }
  return '';
}

// ---------- Catégorie (FR / EN / AR) ----------
const CAT_KEYWORDS = [
  [/juridique|legal|contentieux|proc[èe]s|plainte|r[eè]clamation|قانوني|شكوى/i, 'juridique'],
  [/finance|financier|budget|facture|paiement|comptab|مالية|فاتورة/i, 'finances'],
  [/rh|ressources humaines|personnel|recrutement|contrat de travail|موارد بشرية/i, 'rh'],
  [/communication|presse|m[ée]dia|publication|campagne|إعلام|اتصال/i, 'communication'],
  [/s[ée]curit|security|protection|gardien|acc[èe]s|أمن|حماية/i, 'securite'],
  [/administration|administratif|general|service|إدارة/i, 'administration'],
];
export function categorieFromLines(lines) {
  const text = lines.join(' ').toLowerCase();
  for (const [re, val] of CAT_KEYWORDS) if (re.test(text)) return val;
  return 'administration';
}

// ---------- Pré-traitement d'image pour améliorer l'OCR ----------
function preprocessCanvas(srcCanvas) {
  const out = document.createElement('canvas');
  out.width = srcCanvas.width; out.height = srcCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  // grayscale + étirement de contraste (améliore les scans pâles)
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) | 0;
    if (g < min) min = g;
    if (g > max) max = g;
    d[i] = d[i+1] = d[i+2] = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i];
    const v = ((g - min) * 255 / range) | 0;
    // seuil douxpour renforcer le texte sans trop de bruit
    d[i] = d[i+1] = d[i+2] = v < 110 ? 0 : v > 200 ? 255 : v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('cannot load image')); };
    img.src = url;
  });
}

// ---------- Public: extraction complète ----------
export const DETAIL_LABELS = ['sujet','expediteur','dateEmission','priorite','reference','categorie'];

export async function extractPdfDetails(file, onProgress) {
  const empty = { sujet:'', expediteur:'', dateEmission:'', priorite:'normale', reference:'', categorie:'administration' };
  if (!file) return empty;
  const isPdf = /\.pdf$/i.test(file.name);
  const isImage = /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name) || /^image\//.test(file.type);
  if (!isPdf && !isImage) return empty;

  let lines = [];
  let usedOcr = false;
  let textQuality = 0; // nb de caractères alphabétiques dans le text layer

  // ---- 1. text layer (PDF) ----
  if (isPdf) {
    try {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
      const doc = await task.promise;
      const maxPages = Math.min(doc.numPages, 5);
      for (let p = 1; p <= maxPages; p++) {
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
      textQuality = lines.join(' ').replace(/[^A-Za-z\u0600-\u06FF]/g, '').length;
    } catch { /* OCR fallback */ }
  }

  // ---- 2. OCR si texte pauvre / absent (scan) ----
  const hasKeyFields = SUBJECT_LABEL.test(lines.join('\n')) || /\b(date|objet|subject|from)\b/i.test(lines.join(' '));
  if (textQuality < 40 || !hasKeyFields) {
    usedOcr = true;
    try {
      onProgress?.('ocr');
      ocrProgressCb = onProgress;
      const worker = await getTessWorker();
      const ocrText = await queueOcr(async () => {
        let chunks = [];
        if (isPdf) {
          const pdfjs = await loadPdfjs();
          const data = new Uint8Array(await file.arrayBuffer());
          const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
          const doc = await task.promise;
          const maxPages = Math.min(doc.numPages, 5);
          for (let p = 1; p <= maxPages; p++) {
            const page = await doc.getPage(p);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(4, Math.max(2, 2200 / base.width));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            const processed = preprocessCanvas(canvas);
            onProgress?.('ocr', p / maxPages);
            const { data: r } = await worker.recognize(processed);
            chunks.push(String(r.text || ''));
            if (p >= 2 && chunks.join(' ').length > 120 && SUBJECT_LABEL.test(chunks.join('\n'))) break;
          }
          await task.destroy();
        } else {
          const img = await loadImage(file);
          const canvas = document.createElement('canvas');
          const scale = Math.min(3, Math.max(1, 2200 / img.width));
          canvas.width = img.width * scale; canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const processed = preprocessCanvas(canvas);
          const { data: r } = await worker.recognize(processed);
          chunks.push(String(r.text || ''));
        }
        return chunks.join('\n');
      }) || '';
      const ocrLines = String(ocrText).split(/\r?\n/).map(clean).filter(Boolean);
      // Fusionner: garder le text layer s'il apporte plus d'info
      lines = ocrLines.length >= lines.length ? ocrLines : [...ocrLines, ...lines];
    } catch (e) {
      console.error('OCR failed:', e.message || e);
    } finally {
      ocrProgressCb = null;
    }
  }

  return {
    sujet: sujetFromLines(lines).slice(0, 200),
    expediteur: expediteurFromLines(lines).slice(0, 140),
    dateEmission: dateFromLines(lines),
    priorite: prioriteFromLines(lines),
    reference: referenceFromLines(lines).slice(0, 60),
    categorie: categorieFromLines(lines),
    usedOcr,
  };
}

// Version compat: sujet seul
export async function extractPdfSubject(file, onProgress) {
  const d = await extractPdfDetails(file, onProgress);
  return d.sujet;
};
