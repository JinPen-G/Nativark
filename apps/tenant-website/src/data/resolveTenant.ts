// 多租户识别：一套前端部署 + 一个后端端口，服务任意多个租户。
// 每个请求解析出「当前是哪个租户」，再由 bootstrap 决定该租户的品类数 → 三种首页形态自动切换。
//
// 解析优先级（从高到低）：
//   1. ?tenant=single|double|multiple —— 参考演示，走本地静态数据，保持三种形态可离线预览。
//   2. ?tenantCode=xxx —— 显式指定真实租户（本地联调、预览、后台跳转都用它）。
//   3. 自定义域名 / 子域名 —— 生产环境每个租户一个域名（guangying.rentalos.com → guangying），
//      同一份代码不改一行即可服务新租户。localhost / IP / 保留子域(www/api…) 不当作租户。
//   4. VITE_DEFAULT_TENANT —— 单租户独立部署时，用环境变量钉死租户，无需域名或参数。
//   5. 都没有 → 回退演示模式（multiple），保证空环境也能打开。

export type SiteResolution =
  | { kind: 'demo'; demoKey: 'single' | 'double' | 'multiple' }
  | { kind: 'remote'; tenantCode: string };

const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'app', 'static', 'assets', 'cdn', 'localhost']);

/** 从 host 提取子域作为租户编码：a.rentalos.com → 'a'；裸域 / IP / localhost / 保留字 → null。 */
export function tenantCodeFromHost(host: string, baseDomain = import.meta.env?.VITE_BASE_DOMAIN): string | null {
  const hostname = host.split(':')[0].trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  // 配了基础域名时，只认它的直接子域；否则按「至少三段」粗略取最左一段。
  if (baseDomain) {
    const suffix = `.${baseDomain.toLowerCase()}`;
    if (!hostname.endsWith(suffix)) return null;
    const sub = hostname.slice(0, -suffix.length);
    if (!sub || sub.includes('.')) return null;
    return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
  }
  const parts = hostname.split('.');
  if (parts.length < 3) return null;
  const sub = parts[0];
  return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
}

export function resolveSite(search: string, host: string): SiteResolution {
  const params = new URLSearchParams(search);

  const demo = params.get('tenant');
  if (demo === 'single' || demo === 'double' || demo === 'multiple') return { kind: 'demo', demoKey: demo };

  const explicit = params.get('tenantCode')?.trim();
  if (explicit) return { kind: 'remote', tenantCode: explicit };

  const fromHost = tenantCodeFromHost(host);
  if (fromHost) return { kind: 'remote', tenantCode: fromHost };

  const fromEnv = import.meta.env?.VITE_DEFAULT_TENANT?.trim();
  if (fromEnv) return { kind: 'remote', tenantCode: fromEnv };

  return { kind: 'demo', demoKey: 'multiple' };
}
