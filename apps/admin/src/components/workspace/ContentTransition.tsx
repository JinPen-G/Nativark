import { animate, type AnimationPlaybackControls } from "motion/react";
import { motionTokens, useTempoTransition } from "@animate-ui/react/utils/motion";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { ADMIN_CONTENT_MOTION } from "@/app/designTokens";

/** Animate UI's short fade for live state changes. No snapshots, retained trees,
 * transforms or React keys: forms, focus and sticky columns keep their owners. */
export function useContentTransition() {
  const reduced = usePrefersReducedMotion();
  const transition = useTempoTransition(motionTokens.transition.fade);
  const latest = useRef({ reduced, transition });
  latest.current = { reduced, transition };
  const active = useRef<{ node: HTMLElement; opacity: string; controls: AnimationPlaybackControls } | null>(null);
  const stop = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.controls.stop();
    current.node.style.opacity = current.opacity;
    current.node.removeAttribute("data-content-transition");
  }, []);
  const play = useCallback((node: HTMLElement | null) => {
    stop();
    if (!node || latest.current.reduced || document.hidden
      || document.documentElement.hasAttribute("data-workspace-navigation")
      || node.parentElement?.closest("[data-content-transition]")) return;
    const opacity = node.style.opacity;
    node.setAttribute("data-content-transition", "fade");
    const controls = animate(node, { opacity: [ADMIN_CONTENT_MOTION.changedOpacity, 1] }, latest.current.transition);
    const current = { node, opacity, controls };
    active.current = current;
    void Promise.resolve(controls).then(() => { if (active.current === current) stop(); }).catch(() => { if (active.current === current) stop(); });
  }, [stop]);
  useEffect(() => { if (reduced) stop(); }, [reduced, stop]);
  useEffect(() => stop, [stop]);
  return play;
}

export function ContentTransition({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const node = useRef<HTMLDivElement>(null);
  const previous = useRef(value);
  const play = useContentTransition();
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    play(node.current);
  }, [value, play]);
  return <div ref={node} className={className} style={{ minWidth: 0 }} data-content-view={value}>{children}</div>;
}
