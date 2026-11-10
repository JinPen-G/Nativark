/** Invitation fragments are admission hints, not authentication. Carry them only
 * within this tab's registered merchant entry; never put them in login URLs. */
import { parseEnterpriseRoute } from "./enterprise-entry";
const key = (basePath: string) => `rental-os:enterprise-invite:${basePath}`;
const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
export function captureEnterpriseInvite() {
  const route = parseEnterpriseRoute(window.location.pathname);
  if (!route || window.location.pathname !== `${route.basePath}/join` || !window.location.hash) return;
  const code = new URLSearchParams(window.location.hash.slice(1)).get("invite");
  // Scrub the raw fragment even if storage fails; no login return may carry it.
  window.history.replaceState(null, "", window.location.pathname);
  if (!valid(code)) return;
  sessionStorage.setItem(key(route.basePath), code);
  if (sessionStorage.getItem(key(route.basePath)) !== code) throw new Error("邀请未保留，请登录后重新打开原邀请 / Reopen the original invitation after sign-in");
}
export function readEnterpriseInvite(basePath: string): string | null {
  const route = parseEnterpriseRoute(basePath);
  if (!route || route.basePath !== basePath) throw new Error("邀请商户入口无效");
  const code = sessionStorage.getItem(key(basePath));
  if (code === null) return null;
  if (!valid(code)) throw new Error("原邀请不可读取，请重新打开原邀请");
  return code;
}
export function clearEnterpriseInvite(basePath: string) {
  sessionStorage.removeItem(key(basePath));
}
