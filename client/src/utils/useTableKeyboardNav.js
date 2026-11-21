import { useEffect } from 'react';

// Keyboard navigation for tables: ArrowUp/ArrowDown move focus between rows,
// Enter/Space activates the focused row (click), Escape clears focus.
// Add `data-nav-row` to <tr> elements and pass a ref to the table/container.
export function useTableKeyboardNav(containerRef, onActivate) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e) => {
      const rows = [...el.querySelectorAll('[data-nav-row]')];
      if (!rows.length) return;
      const active = document.activeElement;
      const idx = rows.indexOf(active);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown'
          ? (idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1))
          : (idx < 0 ? rows.length - 1 : Math.max(idx - 1, 0));
        rows[next].focus();
        rows[next].scrollIntoView({ block: 'nearest' });
      } else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) {
        e.preventDefault();
        rows[idx].click();
        if (onActivate) onActivate(rows[idx]);
      } else if (e.key === 'Escape' && idx >= 0) {
        active.blur();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [containerRef, onActivate]);
}
