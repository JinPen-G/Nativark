// Motiq MIT (c) 2026 Mahammad Rustamov; extracted verbatim from vendor/motion.ts.
import * as React from "react";

export function useAnimatedNumber(
  value: number,
  { durationMs = 700, disabled = false }: { durationMs?: number; disabled?: boolean } = {},
): number {
  const [display, setDisplay] = React.useState(value);
  const displayRef = React.useRef(value);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (disabled || typeof requestAnimationFrame === "undefined" || durationMs <= 0) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const from = displayRef.current; // interruption resumes from what's on screen
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (to - from) * easeOut(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs, disabled]);

  return display;
}
