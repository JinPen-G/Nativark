import { useEffect, useRef } from 'react';

/** Reveal the selected item inside its own rail without moving the page. */
export function useActiveRail<T extends HTMLElement>(activeKey: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const reveal = () => {
      const rail = ref.current;
      const item = rail?.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"], [aria-selected="true"]');
      if (!rail || !item || rail.scrollWidth <= rail.clientWidth) return;
      const bounds = rail.getBoundingClientRect();
      const current = item.getBoundingClientRect();
      if (current.left < bounds.left || current.right > bounds.right) {
        rail.scrollLeft += current.left - bounds.left - (rail.clientWidth - current.width) / 2;
      }
    };
    const frame = window.requestAnimationFrame(reveal);
    window.addEventListener('resize', reveal);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', reveal); };
  }, [activeKey]);
  return ref;
}
