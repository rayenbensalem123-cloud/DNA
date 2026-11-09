import { useEffect, useState } from 'react';
import { useHolding, prefersReducedMotion } from '../motion';

// Counts a number up from 0 once the page is visible. Non-numbers are shown as they are.
export default function CountUp({ value, duration = 900 }) {
  const holding = useHolding();
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState(isNumber && !prefersReducedMotion() ? 0 : value);

  useEffect(() => {
    if (!isNumber || prefersReducedMotion()) { setShown(value); return undefined; }
    if (holding) { setShown(0); return undefined; }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, holding, isNumber, duration]);

  return <>{isNumber ? shown : value}</>;
}
