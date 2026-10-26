/** Browser-local preference; never changes tenant/account configuration. */
export type MotionPreference = "system" | "full" | "reduced";
export const MOTION_PREFERENCE_KEY = "rental_admin_motion";
let preference: MotionPreference | undefined;
let media: MediaQueryList | undefined;
const listeners = new Set<() => void>();
const parse = (value: string | null): MotionPreference => value === "full" || value === "reduced" ? value : "system";
const systemMedia = () => media ??= window.matchMedia("(prefers-reduced-motion: reduce)");

export function getMotionPreference(): MotionPreference {
  if (preference !== undefined) return preference;
  try { preference = parse(window.localStorage.getItem(MOTION_PREFERENCE_KEY)); }
  catch { preference = "system"; }
  return preference;
}
export function isMotionReduced() {
  const selected = getMotionPreference();
  return selected === "reduced" || selected === "system" && typeof window !== "undefined" && systemMedia().matches;
}
/** Called before first render and synchronously on changes, including other tabs. */
export function applyMotionPreference() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motionPreference = getMotionPreference();
  document.documentElement.dataset.reducedMotion = String(isMotionReduced());
}
function notify() { applyMotionPreference(); listeners.forEach(listener => listener()); }
function onStorage(event: StorageEvent) {
  if (event.key !== MOTION_PREFERENCE_KEY && event.key !== null) return;
  preference = parse(event.newValue); notify();
}
export function subscribeMotionPreference(listener: () => void) {
  if (!listeners.size) {
    systemMedia().addEventListener("change", notify);
    window.addEventListener("storage", onStorage);
    applyMotionPreference();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      systemMedia().removeEventListener("change", notify);
      window.removeEventListener("storage", onStorage);
    }
  };
}
export function setMotionPreference(next: MotionPreference) {
  preference = parse(next);
  try { window.localStorage.setItem(MOTION_PREFERENCE_KEY, preference); }
  catch { /* Still apply to this visit when browser storage is unavailable. */ }
  notify();
}
