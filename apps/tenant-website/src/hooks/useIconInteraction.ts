import { useEffect, useRef, useState } from 'react';

/** Icons follow their existing control; no extra focus stop or event interception. */
export function useIconInteraction() {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const control = ref.current?.closest<HTMLElement>('button, a, label, summary');
    if (!control) return;
    let hovering = false;
    let focused = control.contains(document.activeElement);
    let pressed = false;
    const update = () => setActive(!control.matches(':disabled, [aria-disabled="true"]') && (hovering || focused || pressed));
    const enter = (event: PointerEvent) => { hovering = event.pointerType !== 'touch' && matchMedia('(hover: hover) and (pointer: fine)').matches; update(); };
    const leave = () => { hovering = false; pressed = false; update(); };
    const focus = () => { focused = true; update(); };
    const blur = (event: FocusEvent) => { focused = event.relatedTarget instanceof Node && control.contains(event.relatedTarget); update(); };
    const down = () => { pressed = true; update(); };
    const up = () => { pressed = false; update(); };
    control.addEventListener('pointerenter', enter);
    control.addEventListener('pointerleave', leave);
    control.addEventListener('pointerdown', down);
    control.addEventListener('pointerup', up);
    control.addEventListener('pointercancel', leave);
    control.addEventListener('focusin', focus);
    control.addEventListener('focusout', blur);
    return () => {
      control.removeEventListener('pointerenter', enter);
      control.removeEventListener('pointerleave', leave);
      control.removeEventListener('pointerdown', down);
      control.removeEventListener('pointerup', up);
      control.removeEventListener('pointercancel', leave);
      control.removeEventListener('focusin', focus);
      control.removeEventListener('focusout', blur);
    };
  }, []);
  return { ref, active };
}
