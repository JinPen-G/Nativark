import { useSyncExternalStore } from "react";

let media: MediaQueryList | undefined;
const query = () => media ??= window.matchMedia("(prefers-reduced-motion: reduce)");
function subscribe(notify: () => void) {
  const current = query();
  current.addEventListener("change", notify);
  return () => current.removeEventListener("change", notify);
}
/** React to preference changes while the workspace is open as well as on mount. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, () => query().matches, () => false);
}
