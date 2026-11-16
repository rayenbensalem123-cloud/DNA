import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];
const DAY_NAMES_FR = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function parseIso(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoStr);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  return { year: y, month: mon, day: d };
}

function formatDisplay(isoStr) {
  const p = parseIso(isoStr);
  if (!p) return '';
  return `${pad2(p.day)}/${pad2(p.month + 1)}/${p.year}`;
}

export default function DatePicker({
  value = '',
  onChange,
  min = '',
  max = '',
  placeholder = 'jj/mm/aaaa',
  disabled = false,
  ariaLabel = 'Date',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);
  const popRef = useRef(null);

  // View year and month for calendar navigation
  const parsed = parseIso(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(() => (parsed ? parsed.year : today.getFullYear()));
  const [viewMonth, setViewMonth] = useState(() => (parsed ? parsed.month : today.getMonth()));

  // Keep view aligned with value when value changes externally
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Position popover relative to trigger box
  const place = () => {
    if (!boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const popWidth = 296;
    const popHeight = 336;
    const up = r.bottom + popHeight > window.innerHeight && r.top > popHeight;

    const next = {
      up,
      width: popWidth,
      top: up ? null : Math.min(r.bottom + 6, window.innerHeight - popHeight - 8),
      bottom: up ? window.innerHeight - Math.max(r.top - 6, 8) : null,
      left: Math.max(8, Math.min(r.left, window.innerWidth - popWidth - 12)),
    };
    setPos(next);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    let raf = 0;
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const prevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectDate = (iso) => {
    if (onChange) onChange(iso);
    setOpen(false);
  };

  const clearDate = (e) => {
    e.stopPropagation();
    if (onChange) onChange('');
  };

  const selectToday = (e) => {
    e.stopPropagation();
    const tIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
    selectDate(tIso);
  };

  // Build grid of days
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
  // In JS getDay(): 0 is Sunday, 1 is Monday... convert so Monday is index 0
  const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  // Days from previous month to fill leading row
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: d, month: m, year: y, currentMonth: false, iso: toIsoDate(y, m, d) });
  }
  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, currentMonth: true, iso: toIsoDate(viewYear, viewMonth, d) });
  }
  // Days from next month to fill trailing row (multiple of 7)
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: m, year: y, currentMonth: false, iso: toIsoDate(y, m, d) });
  }

  const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const isDisabled = (iso) => {
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  const currentYear = today.getFullYear();
  const startYear = Math.min(1980, viewYear - 10);
  const endYear = Math.max(currentYear + 10, viewYear + 10);
  const years = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  const popover = open && pos && createPortal(
    <div
      ref={popRef}
      className="themed-calendar-popover"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top !== null ? pos.top : 'auto',
        bottom: pos.bottom !== null ? pos.bottom : 'auto',
        width: pos.width,
        zIndex: 960,
      }}
      role="dialog"
      aria-label="Calendrier"
    >
      <header className="themed-calendar-head">
        <button type="button" className="cal-nav-btn" onClick={prevMonth} aria-label="Mois précédent" title="Mois précédent">‹</button>
        <div className="cal-head-selectors">
          <select
            className="cal-select cal-select-month"
            value={viewMonth}
            onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
            aria-label="Sélectionner le mois"
          >
            {MONTH_NAMES_FR.map((name, idx) => (
              <option key={name} value={idx}>{name}</option>
            ))}
          </select>
          <select
            className="cal-select cal-select-year"
            value={viewYear}
            onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
            aria-label="Sélectionner l'année"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button type="button" className="cal-nav-btn" onClick={nextMonth} aria-label="Mois suivant" title="Mois suivant">›</button>
      </header>

      <div className="themed-calendar-weekdays" aria-hidden="true">
        {DAY_NAMES_FR.map((d) => (
          <span key={d} className="cal-weekday">{d}</span>
        ))}
      </div>

      <div className="themed-calendar-grid" role="grid">
        {cells.map((c) => {
          const isSelected = value === c.iso;
          const isToday = todayIso === c.iso;
          const disabledDay = isDisabled(c.iso);

          let cls = 'cal-day-btn';
          if (!c.currentMonth) cls += ' outside';
          if (isSelected) cls += ' selected';
          if (isToday) cls += ' today';
          if (disabledDay) cls += ' disabled';

          return (
            <button
              type="button"
              key={c.iso}
              className={cls}
              disabled={disabledDay}
              onClick={() => selectDate(c.iso)}
              aria-label={`${c.day} ${MONTH_NAMES_FR[c.month]} ${c.year}`}
              aria-selected={isSelected}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      <footer className="themed-calendar-foot">
        <button type="button" className="cal-quick-btn" onClick={selectToday}>Aujourd'hui</button>
        {value && <button type="button" className="cal-quick-btn cal-clear" onClick={clearDate}>Effacer</button>}
      </footer>
    </div>,
    document.body
  );

  return (
    <div className={`themed-datepicker-box ${className}`} ref={boxRef}>
      <button
        type="button"
        className={`themed-datepicker-btn ${open ? 'open' : ''} ${!value ? 'empty' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="cal-btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <span className="cal-btn-val">
          {value ? formatDisplay(value) : placeholder}
        </span>
        {value && !disabled && (
          <span
            className="cal-btn-clear"
            onClick={clearDate}
            title="Effacer la date"
            aria-label="Effacer la date"
          >
            ×
          </span>
        )}
      </button>
      {popover}
    </div>
  );
}
