// Export helpers: CSV, Excel (.xlsx) and print/PDF for tables.
// All client-side: CSV/Excel are real downloads, "PDF" is a styled print
// window (the browser's "Save as PDF") which also renders Arabic glyphs
// without any heavy PDF font-embedding dependency.

// Spreadsheet formula injection: a value typed by a user such as
// "=HYPERLINK(...)" would run as a formula when the export is opened in Excel.
// Prefix risky leading characters with an apostrophe so it stays plain text.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = cell(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map((h) => esc(h.label)).join(';')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h.key])).join(';'));
  return '\uFEFF' + lines.join('\r\n');
}

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadCsv(name, headers, rows) {
  download(name.endsWith('.csv') ? name : `${name}.csv`, 'text/csv;charset=utf-8', toCsv(headers, rows));
}

export async function downloadXlsx(name, headers, rows) {
  const XLSX = await import('xlsx');
  const data = rows.map((r) => Object.fromEntries(headers.map((h) => [h.label, cell(r[h.key])])));
  const ws = XLSX.utils.json_to_sheet(data, { header: headers.map((h) => h.label) });
  // Column width fits the longest value (capped), not just the header label.
  ws['!cols'] = headers.map((h) => {
    const longest = rows.reduce((acc, r) => Math.max(acc, cell(r[h.key]).length), 0);
    return { wch: Math.max(10, Math.min(60, Math.max(h.label.length + 4, longest + 2))) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  XLSX.writeFile(wb, name.endsWith('.xlsx') ? name : `${name}.xlsx`);
}

// Print/PDF: opens a new window with an official, self-contained document —
// letterhead with the FTF emblem, document reference, filter chips, a table
// whose header repeats on every printed page, a watermark, and signature
// blocks. The browser's "Save as PDF" produces the PDF (Arabic glyphs render
// natively, no font-embedding dependency).
export function printPdf({ title, subtitle = '', headers, rows, footer = '', meta = {} }) {
  const esc = (v) => cell(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const now = new Date();
  const today = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Document reference, e.g. DO-20261117-1452 — stamped like an official register page.
  const refDoc = `DO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const origin = window.location.origin;

  // Subtitle (filters, date range) rendered as chips; count as its own chip.
  const chips = [
    ...subtitle.split(/ ?· ?| — /).map((s) => s.trim()).filter(Boolean),
    `${rows.length} ligne${rows.length > 1 ? 's' : ''}`,
  ];

  const num = (i) => String(i + 1).padStart(2, '0');
  const head = [`<th class="num">#</th>`, ...headers.map((h) => `<th>${esc(h.label)}</th>`)].join('');
  const body = rows.map((r, i) =>
    `<tr><td class="num">${num(i)}</td>${headers.map((h) => `<td>${esc(r[h.key])}</td>`).join('')}</tr>`).join('');

  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { alert('Autorisez les fenêtres popup pour l’export PDF'); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm 12mm 16mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1c1c22; margin: 0; position: relative; }

    /* Fixed layers repeat on every printed page */
    .watermark { position: fixed; inset: 0; z-index: -1; display: grid; place-items: center; pointer-events: none; }
    .watermark span { font-size: 340px; font-weight: 900; letter-spacing: .06em; color: rgba(230, 0, 27, .045); transform: rotate(-18deg); }
    .pagefoot { position: fixed; left: 0; right: 0; bottom: 0; height: 26px; border-top: 1.5px solid #e6001b; display: flex; align-items: center; justify-content: space-between; padding: 0 2mm 0 0; font-size: 9.5px; color: #7d7d88; background: #fff; }
    .pagefoot::before { content: ''; position: absolute; top: -5px; left: 0; right: 0; height: 3px; background: #1c1c22; }
    .pagefoot .docref { margin-left: 12px; }
    .pagefoot .docref::after { content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 8px; border-radius: 50%; background: #e6001b; vertical-align: middle; }

    /* Letterhead */
    .letterhead { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; }
    .emblem { width: 62px; height: 62px; border-radius: 50%; object-fit: contain; background: #fff; box-shadow: 0 0 0 2px #e6001b, 0 3px 10px rgba(0,0,0,.12); padding: 4px; flex: none; }
    .emblem-fallback { width: 62px; height: 62px; border-radius: 50%; background: linear-gradient(150deg, #e6001b, #a30014); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 19px; flex: none; box-shadow: 0 3px 10px rgba(0,0,0,.15); }
    .org { display: flex; flex-direction: column; gap: 2px; }
    .org .federation { font-size: 15.5px; font-weight: 800; letter-spacing: .12em; color: #1c1c22; text-transform: uppercase; }
    .org .direction { font-size: 11.5px; font-weight: 600; color: #6a6a75; letter-spacing: .04em; }
    .docmeta { margin-left: auto; text-align: right; border: 1px solid #e8e8ee; border-radius: 10px; padding: 8px 12px; background: #fafafc; min-width: 190px; }
    .docmeta .ref { font-size: 12.5px; font-weight: 800; color: #8a0012; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
    .docmeta .line { font-size: 10.5px; color: #6a6a75; margin-top: 3px; }
    .rule { display: flex; flex-direction: column; gap: 2.5px; margin-bottom: 16px; }
    .rule i { display: block; height: 3px; background: linear-gradient(90deg, #e6001b 0%, #e6001b 55%, rgba(230,0,27,.15) 100%); border-radius: 2px; }
    .rule i:last-child { height: 1px; background: #1c1c22; opacity: .55; }

    /* Title + chips */
    .titleblock { text-align: center; margin-bottom: 16px; }
    .titleblock h1 { font-size: 22px; margin: 0 0 4px; font-weight: 850; letter-spacing: .02em; }
    .titleblock .accent { width: 84px; height: 4px; border-radius: 3px; background: #e6001b; margin: 0 auto 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
    .chip { font-size: 10.5px; font-weight: 650; color: #4c4c58; background: #f4f4f8; border: 1px solid #e4e4ec; border-radius: 999px; padding: 3.5px 11px; }
    .chip.count { background: #fdeef0; border-color: #f5c9ce; color: #a30014; }

    /* Table */
    table { width: 100%; max-width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th { background: linear-gradient(180deg, #9a0015, #7c0010); color: #fff; text-align: left; padding: 9px 10px; font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; border: 1px solid #7c0010; overflow-wrap: anywhere; }
    td { padding: 7.5px 10px; border: 1px solid #e7e7ee; vertical-align: top; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; }
    td.num, th.num { text-align: center; width: 30px; color: #9a9aa5; font-variant-numeric: tabular-nums; font-weight: 650; }
    /* The reference number column stays narrow; the rest share the width evenly */
    td:first-of-type + td { width: 12%; }
    tbody tr:nth-child(even) td { background: #f7f7fa; }
    tbody tr:hover td { background: #fdeef0; }
    .empty { text-align: center; padding: 34px 10px; color: #9a9aa5; font-size: 12.5px; font-style: italic; }

    /* Signature blocks */
    .signatures { display: flex; gap: 40px; justify-content: flex-end; margin-top: 34px; page-break-inside: avoid; }
    .sigbox { width: 58mm; }
    .sigbox .who { font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; color: #1c1c22; border-bottom: 2px solid #1c1c22; padding-bottom: 4px; margin-bottom: 2px; }
    .sigbox .sub { font-size: 9.5px; color: #8a8a95; margin-bottom: 26px; }
    .sigbox .space { height: 20mm; border-bottom: 1px dashed #c9c9d4; }

    /* Screen-only toolbar */
    .toolbar { position: fixed; top: 14px; right: 14px; z-index: 10; display: flex; gap: 8px; }
    .toolbar button { padding: 10px 20px; border: 0; border-radius: 9px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .toolbar .primary { background: #e6001b; color: #fff; box-shadow: 0 6px 16px rgba(230,0,27,.35); }
    .toolbar .primary:hover { background: #c50018; }
    .toolbar .ghost { background: #fff; color: #33333d; border: 1px solid #d9d9e0; }
    .toolbar .ghost:hover { border-color: #e6001b; color: #e6001b; }
    .toolbar .ghost.oactive { background: #fdeef0; border-color: #e6001b; color: #a30014; }
    /* Portrait mode: narrower sheet, denser table */
    body.portrait table { font-size: 10px; }
    body.portrait td { padding: 6px 8px; }
    body.portrait th { padding: 8px; }
    body.portrait .sigbox { width: 70mm; }
    body.portrait .watermark span { font-size: 250px; }
    @media print { .toolbar { display: none; } .letterhead, .titleblock, table, .signatures { position: static; } body { padding-bottom: 30px; } .sheet { padding: 0; max-width: none; } }
    @media screen { body { background: #e9e9ef; padding: 26px; } .sheet { background: #fff; max-width: 1100px; margin: 0 auto; padding: 18mm 14mm; box-shadow: 0 10px 40px rgba(0,0,0,.16); border-radius: 4px; } body.portrait .sheet { max-width: 830px; } }
  </style>
  <style id="orient-style">@page { size: A4 landscape; }</style></head><body>
  <div class="watermark" aria-hidden="true"><span>DNA</span></div>
  <div class="toolbar">
    <button type="button" class="ghost" id="btn-portrait" aria-pressed="false">Portrait</button>
    <button type="button" class="ghost oactive" id="btn-landscape" aria-pressed="true">Paysage</button>
    <button type="button" class="primary" id="btn-print">Imprimer / Enregistrer en PDF</button>
    <button type="button" class="ghost" id="btn-close">Fermer</button>
  </div>
  <div class="sheet">
    <div class="letterhead">
      <img class="emblem" src="${origin}/federation-tunisienne-logo.webp" alt="" id="emblem-img">
      <div class="org">
        <span class="federation">Fédération Tunisienne de Football</span>
        <span class="direction">Direction Nationale de l’Arbitrage — Bureau d’ordre</span>
      </div>
      <div class="docmeta">
        <div class="ref">${esc(refDoc)}</div>
        <div class="line">Édité le ${today} à ${heure}</div>
        ${meta.by ? `<div class="line">Par ${esc(meta.by)}</div>` : ''}
      </div>
    </div>
    <div class="rule"><i></i><i></i></div>
    <div class="titleblock">
      <h1>${esc(title)}</h1>
      <div class="accent"></div>
      <div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    </div>
    <table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="empty" colspan="${headers.length + 1}">Aucune donnée sur la période sélectionnée</td></tr>`}</tbody></table>
    <div class="signatures">
      <div class="sigbox"><div class="who">Visa — Direction</div><div class="sub">Direction Nationale de l’Arbitrage</div><div class="space"></div></div>
      <div class="sigbox"><div class="who">Cachet &amp; signature</div><div class="sub">Bureau d’ordre</div><div class="space"></div></div>
    </div>
  </div>
  <div class="pagefoot"><span class="docref">${esc(title)} · ${esc(refDoc)}</span><span>${esc(footer || 'Fédération Tunisienne de Football — Direction Nationale de l’Arbitrage')}</span></div>
  </body></html>`);
  w.document.close();
  // The site CSP blocks inline handlers (about:blank inherits the opener CSP),
  // so listeners are attached from JS. The emblem falls back to a monogram if
  // the image cannot load.
  const btn = w.document.getElementById('btn-print');
  if (btn) btn.addEventListener('click', () => w.print());
  const close = w.document.getElementById('btn-close');
  if (close) close.addEventListener('click', () => w.close());
  // Portrait / landscape toggle: rewrites the @page rule and adapts the layout.
  const orientStyle = w.document.getElementById('orient-style');
  const setOrientation = (o) => {
    if (orientStyle) orientStyle.textContent = `@page { size: A4 ${o}; }`;
    if (w.document.body) w.document.body.classList.toggle('portrait', o === 'portrait');
    const p = w.document.getElementById('btn-portrait');
    const l = w.document.getElementById('btn-landscape');
    if (p) { p.classList.toggle('oactive', o === 'portrait'); p.setAttribute('aria-pressed', String(o === 'portrait')); }
    if (l) { l.classList.toggle('oactive', o === 'landscape'); l.setAttribute('aria-pressed', String(o === 'landscape')); }
  };
  const pBtn = w.document.getElementById('btn-portrait');
  const lBtn = w.document.getElementById('btn-landscape');
  if (pBtn) pBtn.addEventListener('click', () => setOrientation('portrait'));
  if (lBtn) lBtn.addEventListener('click', () => setOrientation('landscape'));
  const img = w.document.getElementById('emblem-img');
  if (img) img.addEventListener('error', () => {
    const fb = w.document.createElement('div');
    fb.className = 'emblem-fallback';
    fb.textContent = 'FTF';
    img.replaceWith(fb);
  });
}
