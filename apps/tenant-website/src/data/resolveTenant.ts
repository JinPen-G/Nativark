// 多租户识别：一套前端部署 + 一个后端端口，服务任意多个租户。
// 每个请求解析出「当前是哪个租户」，再由 bootstrap 决定该租户的品类数 → 三种首页形态自动切换。
//
// 解析优先级（从高到低）：
//   1. ?tenant=single|double|multiple —— 参考演示，走本地静态数据，保持三种形态可离线预览。
//   2. ?tenantCode=xxx —— 显式指定真实租户（本地联调、预览、后台跳转都用它）。
//   3. 平台子域名 —— 配置 VITE_BASE_DOMAIN=rentalos.com 后，guangying.rentalos.com → guangying（本地即可判定）。
//   4. 客户自定义域名 —— 其余公网域名（如 www.brand.com）交给后端 /public/site-resolve 按 Host 反查
//      租户在「官网配置」里绑定的域名；这一步是异步的，由 SiteProvider 执行。
//   5. VITE_DEFAULT_TENANT —— 单租户独立部署兜底（自定义域名未绑定时也回落到它）。
//   6. 都没有 → 回退演示模式（multiple），保证空环境也能打开。

export type SiteResolution =
  | { kind: 'demo'; demoKey: 'single' | 'double' | 'multiple' }
  | { kind: 'remote'; tenantCode: string }
  /** 需要后端按 Host 反查的自定义域名；反查不到时使用 fallback。 */
  | { kind: 'host'; host: string; fallback: SiteResolution };

const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'app', 'static', 'assets', 'cdn', 'localhost']);

function hostnameOf(host: string): string {
  return host.split(':')[0].trim().toLowerCase();
}

/** 本地/内网地址不当作租户域名：localhost、IPv4、*.local。 */
export function isLocalHost(host: string): boolean {
  const hostname = hostnameOf(host);
  return !hostname || hostname === 'localhost' || hostname.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * 平台子域名 → 租户编码：只认 baseDomain 的直接子域（a.rentalos.com → 'a'），保留字除外。
 * 未配置 baseDomain 时一律返回 null——不再猜测最左一段，避免把客户域名 shop.brand.com 误判成租户 shop。
 */
export function tenantCodeFromHost(host: string, baseDomain = import.meta.env?.VITE_BASE_DOMAIN): string | null {
  const hostname = hostnameOf(host);
  if (!baseDomain || isLocalHost(hostname)) return null;
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const sub = hostname.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return null;
  return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
}

/** 属于平台自身的域名（基础域名本身或其子域）——这些不走自定义域名反查。 */
function isPlatformHost(host: string, baseDomain: string | undefined): boolean {
  if (!baseDomain) return false;
  const hostname = hostnameOf(host);
  const base = baseDomain.toLowerCase();
  return hostname === base || hostname.endsWith(`.${base}`);
}

/** 无法从参数/域名确定租户时的兜底：单租户部署用环境变量，否则回退演示。 */
export function fallbackResolution(defaultTenant = import.meta.env?.VITE_DEFAULT_TENANT): SiteResolution {
  const fromEnv = defaultTenant?.trim();
  return fromEnv ? { kind: 'remote', tenantCode: fromEnv } : { kind: 'demo', demoKey: 'multiple' };
}

export function resolveSite(
  search: string,
  host: string,
  options: { baseDomain?: string; defaultTenant?: string } = { baseDomain: import.meta.env?.VITE_BASE_DOMAIN, defaultTenant: import.meta.env?.VITE_DEFAULT_TENANT },
): SiteResolution {
  const params = new URLSearchParams(search);

  const demo = params.get('tenant');
  if (demo === 'single' || demo === 'double' || demo === 'multiple') return { kind: 'demo', demoKey: demo };

  const explicit = params.get('tenantCode')?.trim();
  if (explicit) return { kind: 'remote', tenantCode: explicit };

  const fromSubdomain = tenantCodeFromHost(host, options.baseDomain);
  if (fromSubdomain) return { kind: 'remote', tenantCode: fromSubdomain };

  const fallback = fallbackResolution(options.defaultTenant);
  // 公网非平台域名 = 客户自定义域名，需后端反查；本地地址与平台自身域名直接兜底。
  if (!isLocalHost(host) && !isPlatformHost(host, options.baseDomain)) {
    return { kind: 'host', host: hostnameOf(host), fallback };
  }
  return fallback;
}
