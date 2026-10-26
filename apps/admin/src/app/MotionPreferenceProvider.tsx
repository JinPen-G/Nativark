import { useLayoutEffect, type ReactNode } from "react";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    MotionGlobalConfig.skipAnimations = reduced;
    // Release an in-flight navigation/theme snapshot when the preference changes.
    if (reduced) (document as Document & { activeViewTransition?: { skipTransition(): void } }).activeViewTransition?.skipTransition();
  }, [reduced]);
  // Visual elements cache reducedMotion on mount in the installed runtime.
  // Keep that switch stable; the shared hook and live global flag own policy,
  // so Full motion restores existing controls without remounting business forms.
  return <MotionConfig reducedMotion="never">
    {children}
  </MotionConfig>;
}
