import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// One measured content box; spring dimensions settle immediately on width changes.
export function MeasuredHeight({ open = true, children, className = '', id, role }: { open?: boolean; children: ReactNode; className?: string; id?: string; role?: 'list' | 'region' }) {
  const reducedMotion = usePrefersReducedMotion();
  const [present, setPresent] = useState(open), clip = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const spring = useRef({ value: open ? -1 : 0, velocity: 0, target: 0, frame: 0, stamp: 0, width: 0 });
  useLayoutEffect(() => { if (open && !present) setPresent(true); }, [open, present, reducedMotion]);
  useLayoutEffect(() => {
    const state = spring.current, box = clip.current, content = inner.current;
    if (!box || !content) return;
    const finish = () => { box.style.height = `${state.target}px`; state.value = state.target; state.velocity = 0; state.frame = 0; if (!open) setPresent(false); };
    const tick = (time: number) => {
      const dt = Math.min((time - state.stamp) / 1000 || 1 / 60, .032); state.stamp = time;
      state.velocity += ((state.target - state.value) * 500 - state.velocity * 45) * dt; state.value += state.velocity * dt;
      box.style.height = `${Math.max(0, state.value)}px`;
      if (Math.abs(state.target - state.value) < .15 && Math.abs(state.velocity) < .6) finish(); else state.frame = requestAnimationFrame(tick);
    };
    const measure = () => {
      const rect = content.getBoundingClientRect(), changedWidth = state.width > 0 && Math.abs(state.width - rect.width) > 1;
      state.target = open ? rect.height : 0; state.width = rect.width;
      if (state.value < 0 || changedWidth || reducedMotion) { cancelAnimationFrame(state.frame); finish(); }
      else if (!state.frame) { state.stamp = performance.now(); state.frame = requestAnimationFrame(tick); }
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(content);
    return () => { observer.disconnect(); cancelAnimationFrame(state.frame); state.frame = 0; };
  }, [open, present, reducedMotion]);
  return <div ref={clip} id={id} className={className} inert={!open} aria-hidden={!open || undefined} style={{ overflow: 'clip', minWidth: 0, height: open && spring.current.value < 0 ? 'auto' : Math.max(0, spring.current.value) }}><div ref={inner} role={role}>{present && children}</div></div>;
}
