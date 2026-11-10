/** Observe the actual controlled DOM target after two browser frame chances.
 * Mounting/IO alone is not a measurement, and this reads no content for logs. */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { VisibleSourceReference } from './visible-observation-session';
import { useVisibleObservationHost } from './VisibleObservationHost';

/** No permissive fallback for unsupported geometry/visibility APIs. Text uses
 * its real text range, rather than counting the model caption as first text. */
export function visibleObservationTarget(element: HTMLElement, kind: 'text' | 'card'): boolean {
  if (!element.isConnected || document.hidden || navigator.onLine === false || typeof document.elementFromPoint !== 'function') return false;
  let node: HTMLElement | null = element, depth = 0;
  for (; node && depth < 32; node = node.parentElement, depth++) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || node.hidden || node.inert) return false;
  }
  if (node) return false;
  let rects: readonly DOMRect[];
  if (kind === 'text') {
    if (!element.textContent?.trim() || typeof document.createRange !== 'function') return false;
    const range = document.createRange(); range.selectNodeContents(element); rects = Array.from(range.getClientRects());
  } else rects = Array.from(element.getClientRects());
  for (const rect of rects) {
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) continue;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    if (hit && (hit === element || element.contains(hit))) return true;
  }
  return false;
}

export function VisibleObservationBoundary({ reference, kind, ready, children }: {
  reference: VisibleSourceReference; kind: 'text' | 'card'; ready: boolean; children: ReactNode;
}) {
  const host = useVisibleObservationHost(), root = useRef<HTMLDivElement | null>(null);
  const revision = useSyncExternalStore(host?.subscribe ?? (() => () => {}), host?.snapshot ?? (() => 0), () => 0);
  const binding = JSON.stringify([reference, kind, ready]);
  const active = useRef({ binding, ready }); active.current = { binding, ready };
  useEffect(() => {
    if (!host || !ready || !root.current || typeof IntersectionObserver !== 'function') return;
    const target = kind === 'text' ? root.current.querySelector<HTMLElement>('[data-ai-visible-text]') : root.current;
    if (!target) return;
    let closed = false, first: number | undefined, second: number | undefined;
    const check = () => !closed && active.current.binding === binding && active.current.ready && visibleObservationTarget(target, kind);
    const schedule = () => {
      if (closed || first !== undefined || second !== undefined || !check()) return;
      first = window.requestAnimationFrame(() => { first = undefined; if (!check()) return;
        second = window.requestAnimationFrame(() => { second = undefined;
          if (check()) host.visible(reference, kind);
        });
      });
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) schedule(); });
    observer.observe(target); window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule); schedule();
    return () => { closed = true; observer.disconnect(); if (first !== undefined) window.cancelAnimationFrame(first);
      if (second !== undefined) window.cancelAnimationFrame(second); window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule); document.removeEventListener('focusin', schedule); };
  }, [host, binding, kind, ready, revision]);
  return <div ref={root}>{children}</div>;
}
