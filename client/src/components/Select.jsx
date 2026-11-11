import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Themed dropdown that replaces the native <select>.
// Native option lists can't be styled, so this renders the trigger and the
// list itself in the app theme. Same contract as a select:
//   <Select value={v} onChange={(val) => set(val)} options={[{ value, label }]} />
// The menu is portaled to <body> with position:fixed coordinates: an ancestor
// with backdrop-filter/transform (cards, modals) would otherwise become its
// containing block and misplace it. The position is re-measured every frame
// while open, so it tracks scrolls, hover transforms and layout shifts.
export default function Select({ value, onChange, options = [], placeholder = '—', disabled, ariaLabel, className = '' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null); // { top, left, width, up }
  const box = useRef(null);
  const menu = useRef(null);

  const current = options.find((o) => o.value === value) || null;
  const label = current ? current.label : placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (box.current && box.current.contains(event.target)) return;
      if (menu.current && menu.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // (Re)place the fixed menu relative to the trigger; keep it in view by
  // opening upward when the trigger is near the bottom of the screen.
  const place = () => {
    if (!box.current) return;
    const r = box.current.getBoundingClientRect();
    const up = r.bottom + 320 > window.innerHeight && r.top > 320;
    const next = {
      up,
      width: r.width,
      top: up ? null : Math.min(r.bottom + 6, window.innerHeight - 8),
      bottom: up ? window.innerHeight - Math.max(r.top - 6, 8) : null,
      left: Math.min(r.left, window.innerWidth - r.width - 8),
    };
    // Skip identical updates so the rAF loop doesn't re-render every frame.
    setPos((prev) => (prev && prev.up === next.up && prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left && prev.width === next.width ? prev : next));
  };

  useLayoutEffect(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    if (!open) return undefined;
    place();
    // Live-track the trigger: hover lifts (transform) on cards/buttons and
    // scrolling inside any scrollable ancestor all change its rect.
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (opt) => {
    setOpen(false);
    if (onChange) onChange(opt.value);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive((i) => options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const opt = options[active];
      if (opt) choose(opt);
    }
  };

  const menuNode = open && pos && (
    <ul
      ref={menu}
      className={'tselect-menu' + (pos.up ? ' up' : '')}
      role="listbox"
      aria-activedescendant={options[active] ? 'tsopt-' + active : undefined}
      style={{ position: 'fixed', width: pos.width, left: pos.left, top: pos.top, bottom: pos.bottom }}
    >
      {options.map((opt, i) => (
        <li
          key={opt.value}
          id={'tsopt-' + i}
          role="option"
          aria-selected={opt.value === value}
          className={'tselect-opt' + (opt.value === value ? ' selected' : '') + (i === active ? ' active' : '')}
          onMouseEnter={() => setActive(i)}
          onClick={() => choose(opt)}
        >
          <span className="tselect-opt-label">{opt.label}</span>
          {opt.value === value && <span className="tselect-check" aria-hidden="true"><svg viewBox="0 0 12 10" width="12" height="10"><path d="M1 5.5l3.5 3L11 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
        </li>
      ))}
      {options.length === 0 && <li className="tselect-opt tselect-empty">Aucun choix</li>}
    </ul>
  );

  return (
    <div className={'tselect ' + className} ref={box} onKeyDown={onKeyDown}>
      <button
        type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        className={'tselect-btn' + (open ? ' open' : '') + (current ? '' : ' empty')}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="tselect-value">{label}</span>
        <span className="tselect-chevron" aria-hidden="true"><svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      </button>
      {menuNode && createPortal(menuNode, document.body)}
    </div>
  );
}
