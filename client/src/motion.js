import { useSyncExternalStore } from 'react';

// While a full-screen splash covers the app, page animations wait, so they start
// exactly when the splash opens instead of playing out of sight.
let holding = true;
const listeners = new Set();

export function setHolding(value) {
  if (value === holding) return;
  holding = value;
  listeners.forEach((fn) => fn());
}

export function useHolding() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => holding,
    () => holding,
  );
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
