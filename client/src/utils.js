export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' o';
  const kb = Math.round(b / 1024);
  if (kb < 1024) return kb + ' Ko';
  return (kb / 1024).toFixed(1) + ' Mo';
}

export function todayInputValue() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function toInputDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// The committee route of a letter: the name of every committee it passed
// through, in order ("Comité A → Comité B"). Needs the tracking data, which
// only the bureau d'ordre (or "tracking" permission) receives.
export function transferChain(letter, nameOf = (id) => id) {
  if (!letter || !Array.isArray(letter.commissionHisto)) return '';
  const steps = [];
  for (const h of letter.commissionHisto) {
    if (h.type === 'retire') steps.pop();
    else if ((h.type === 'assigne' || h.type === 'transfert') && h.committee) steps.push(h.committee);
  }
  if (letter.commission && steps[steps.length - 1] !== letter.commission) steps.push(letter.commission);
  return steps.filter((s, i) => i === 0 || s !== steps[i - 1]).map(nameOf).join(' → ');
}

