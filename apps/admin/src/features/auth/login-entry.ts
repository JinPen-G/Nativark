import { APP_ROUTES } from "@/app/navigation";

/** 登录入口只决定公开品牌展示，不授予租户权限，也不替代原登录校验。 */
const TENANT_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
const reservedSegments = new Set([
  "login", "api", "assets", "brand", "media", "src", "node_modules",
  ...Object.values(APP_ROUTES).map(route => route.path.split("/")[1]),
  // 原兼容路由继续进入受保护区，不被租户编码简写入口抢占。
  "new-order", "orders", "rental-rules", "service-products", "services", "marketing",
  "pricing", "stations", "vehicle-groups", "vehicles", "customers", "members",
  "member-reviews", "membership-plans", "corporates", "users", "organizations",
  "permissions", "system-rules", "security-baseline", "integrations", "notifications",
  "platform-governance", "file-assets", "async-jobs",
]);

export function resolveLoginTenantCode(value?: string) {
  const code = value?.trim().toLowerCase();
  return code && TENANT_CODE_PATTERN.test(code) ? code : undefined;
}

export function isTenantLoginAliasPath(pathname: string) {
  const segment = /^\/([^/]+)\/?$/u.exec(pathname)?.[1];
  if (!segment) return false;
  let code: string | undefined;
  try { code = resolveLoginTenantCode(decodeURIComponent(segment)); }
  catch { return false; }
  return Boolean(code && !reservedSegments.has(code));
}

export function isAdminLoginPath(pathname: string) {
  return /^\/login(?:\/|$)/iu.test(pathname) || isTenantLoginAliasPath(pathname);
}
