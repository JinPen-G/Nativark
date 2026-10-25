import type { ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Fade } from "./vendor/animate-ui/fade";
import { useWorkspaceEntry } from "./WorkspaceNavigation";

/** One original Animate UI Fade per mounted page, never keyed by filters or requests.
 * No layout/transform animation: UIArc sliders and popup measurements keep their own coordinates.
 */
export function PageEnter({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const routeEntry = useWorkspaceEntry();
  return <Fade className={className} initialOpacity={reduced || routeEntry ? 1 : 0}
    transition={reduced || routeEntry ? { duration: 0 } : undefined}>{children}</Fade>;
}
