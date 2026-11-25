import { useEffect, type RefObject } from "react";

/** Adapt only a vendor inset mask's rounded corner to the shared field token.
 * Preserve its animated inset distances, opacity and timing; never edit vendor. */
export function inputRadiusClip(clip: string) {
  if (!clip.startsWith("inset(") || /round\s+var\(--radius-field\)/.test(clip)) return clip;
  return clip.replace(/\s+round\s+[^)]*\)$/, " round var(--radius-field))");
}

export function useInputRadiusClip(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const sync = (target: Element) => {
      if (!(target instanceof HTMLElement) || !target.style.clipPath) return;
      const next = inputRadiusClip(target.style.clipPath);
      if (next !== target.style.clipPath) target.style.clipPath = next;
    };
    node.querySelectorAll("[style]").forEach(sync);
    const observer = new MutationObserver(records => records.forEach(record => {
      if (record.type !== "childList") { sync(record.target as Element); return; }
      // Newly mounted reduced-motion panels may never emit another style change.
      record.addedNodes.forEach(added => {
        if (!(added instanceof HTMLElement)) return;
        sync(added);
        added.querySelectorAll("[style]").forEach(sync);
      });
    }));
    observer.observe(node, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
}
