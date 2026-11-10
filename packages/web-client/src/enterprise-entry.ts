/** Registered same-origin enterprise entry paths; URL data locates a tenant,
 * never authorizes one. Domain binding must be confirmed by the server. */
const codePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const ENTERPRISE_PAGE_PATHS = ["", "tasks", "members", "applications", "join", "invites", "join-requests", "policy", "approvals", "extension-approvals", "orders", "finance", "records", "profile"] as const;
export interface EnterpriseRoute { tenantCode?: string; basePath: string; boundDomain: boolean }
export function parseEnterpriseRoute(pathname: string): EnterpriseRoute | null {
  const parts = pathname.split("/");
  const suffix = parts[1] === "enterprise" ? parts.slice(2).join("/") : parts.slice(3).join("/");
  if (!ENTERPRISE_PAGE_PATHS.some(page => page === suffix)) return null;
  if (parts[1] === "enterprise") return { basePath: "/enterprise", boundDomain: true };
  if (parts[2] !== "enterprise" || !codePattern.test(parts[1] ?? "")) return null;
  return { tenantCode: parts[1], basePath: `/${parts[1]}/enterprise`, boundDomain: false };
}
export function enterpriseHref(tenantCode: string, domainBound: boolean) {
  if (!codePattern.test(tenantCode)) throw new Error("无效商户入口");
  return domainBound ? "/enterprise" : `/${encodeURIComponent(tenantCode)}/enterprise`;
}
export function safeCustomerReturn(value: string | null, tenantCode: string, domainBound: boolean): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000- ]/.test(value)) return null;
  const url = new URL(value, "https://local.invalid");
  if (url.origin !== "https://local.invalid" || url.hash) return null;
  const enterprise = parseEnterpriseRoute(url.pathname);
  if (enterprise) {
    if (url.search || enterprise.boundDomain !== domainBound || !domainBound && enterprise.tenantCode !== tenantCode) return null;
    const relative = url.pathname.slice(enterprise.basePath.length);
    return ENTERPRISE_PAGE_PATHS.some(page => relative === (page ? `/${page}` : "")) ? url.pathname : null;
  }
  if (!/^\/(?:orders(?:\/[a-zA-Z0-9_-]+)?|account(?:\/[a-zA-Z0-9_-]+)?)\/?$/.test(url.pathname) || url.search) return null;
  return url.pathname;
}
