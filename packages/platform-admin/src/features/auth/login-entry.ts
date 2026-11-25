/** 登录网址仅选择公开品牌；实际身份仍由原登录接口核验。 */
const TENANT_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
export function resolveLoginTenantCode(value?: string) {
  const code = value?.trim().toLowerCase();
  return code && TENANT_CODE_PATTERN.test(code) ? code : undefined;
}

// 原页面和兼容路径先保留；单段租户别名只选择公开登录品牌。
const reservedSegments = new Set(["login","invite","api","assets","brand","media","src","node_modules","cores","new-order","orders","rental-rules","service-products","services","marketing","pricing","stations","vehicle-groups","vehicles","customers","members","member-reviews","membership-plans","corporates","users","organizations","permissions","system-rules","security-baseline","integrations","notifications","platform-governance","file-assets","async-jobs","ai-operator","workbench","reports","rental","membership","tenant","settings","ai","platform"]);
export function isTenantLoginAliasPath(pathname: string) {
  const segment = /^\/([^/]+)\/?$/u.exec(pathname)?.[1];
  if (!segment) return false;
  let code: string | undefined;
  try { code = resolveLoginTenantCode(decodeURIComponent(segment)); } catch { return false; }
  return Boolean(code && !reservedSegments.has(code));
}
