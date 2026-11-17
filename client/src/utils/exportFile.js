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
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(10, Math.min(50, h.label.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  XLSX.writeFile(wb, name.endsWith('.xlsx') ? name : `${name}.xlsx`);
}

// Print/PDF: opens a new window with a styled, self-contained table.
export function printPdf({ title, subtitle = '', headers, rows, footer = '' }) {
  const esc = (v) => cell(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const head = headers.map((h) => `<th>${esc(h.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h.key])}</td>`).join('')}</tr>`).join('');
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { alert('Autorisez les fenêtres popup pour l’export PDF'); return; }
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; }
    .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #e6001b; padding-bottom: 10px; margin-bottom: 14px; }
    .mark { width: 44px; height: 44px; border-radius: 50%; background: #e6001b; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex: none; }
    h1 { font-size: 19px; margin: 0; }
    .sub { font-size: 12px; color: #555; margin-top: 3px; }
    .meta { margin-left: auto; text-align: right; font-size: 11px; color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #f3e2e5; color: #7a0012; text-align: left; padding: 7px 8px; border: 1px solid #e3c8cd; }
    td { padding: 6px 8px; border: 1px solid #e5e5e5; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .foot { margin-top: 12px; font-size: 10px; color: #777; display: flex; justify-content: space-between; }
    .print-btn { position: fixed; top: 12px; right: 12px; padding: 9px 18px; background: #e6001b; color: #fff; border: 0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    @media print { .print-btn { display: none; } }
  </style></head><body>
  <button class="print-btn" type="button">Imprimer / PDF</button>
  <div class="head">
    <div class="mark">FTF</div>
    <div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>
    <div class="meta">Généré le ${today}<br/>${rows.length} ligne${rows.length > 1 ? 's' : ''}</div>
  </div>
  <table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + headers.length + '">Aucune donnée</td></tr>'}</tbody></table>
  <div class="foot"><span>${esc(footer || 'Direction Nationale de l’Arbitrage — Fédération Tunisienne de Football')}</span><span>Document généré par le bureau d’ordre</span></div>
  </body></html>`);
  w.document.close();
  const btn = w.document.querySelector('.print-btn');
  if (btn) btn.addEventListener('click', () => w.print());
}
