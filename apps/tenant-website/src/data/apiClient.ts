// 官网数据访问的底层：调用租户客户端公开接口 `/api/client/v1/*`。
// 开发环境经 Vite 代理转发到本地 API（见 vite.config.ts）；生产可用 VITE_API_BASE 指向真实网关。
// 只消费公开（免登录）接口：bootstrap 与 public/catalog；登录态接口留待后续切片。

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const CLIENT_V1 = `${API_BASE}/api/client/v1`;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${CLIENT_V1}${path}?${query}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new ApiError(response.status, `请求失败（${response.status}）`);
  }
  const body = await response.json();
  // 系统响应包装：{ data, requestId }。
  return (body?.data ?? body) as T;
}

/** bootstrap 响应中官网消费到的字段（对应 shared 的 ClientChannelBootstrapResponse，本地只声明用到的部分）。 */
export interface BootstrapWebsite {
  slogan?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroImageUrl?: string;
  secondaryColor?: string;
  footerText?: string;
  contactAddress?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  showPoweredBy: boolean;
}

export interface BootstrapResponse {
  tenantCode: string;
  merchant: { name: string; logoUrl?: string; servicePhone?: string; serviceHours?: string };
  services: Array<{ code: string; name: string; categoryCode: string; isDefault?: boolean; status: 'open' | 'paused' }>;
  defaultServiceCode?: string;
  themeColor?: string;
  website?: BootstrapWebsite;
  capabilities: { publicCatalog: boolean; [key: string]: boolean };
  source: 'channel' | 'workspace_directory';
}

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  inventoryMode?: string;
  images?: Array<{ url: string; alt?: string }>;
  attributes?: Record<string, string>;
  startingPrice?: { amount: number; unit: string; currency: string };
}

export interface CatalogPricingGroup {
  id: string;
  code: string;
  name: string;
  memberItemGroupIds?: string[];
  enabled?: boolean;
}

export interface PublicCatalogResponse {
  workspace: string;
  categoryCode: string;
  items: CatalogItem[];
  pricingGroups?: CatalogPricingGroup[];
  locations?: Array<{ id: string; code: string; name: string; address?: string; businessHours?: string; contactPhone?: string; capabilities?: string[] }>;
}

export const clientApi = {
  bootstrap(tenantCode: string): Promise<BootstrapResponse> {
    return getJson<BootstrapResponse>('/public/bootstrap', { tenantCode, client: 'web' });
  },
  publicCatalog(tenantCode: string, service: string): Promise<PublicCatalogResponse> {
    return getJson<PublicCatalogResponse>('/public/catalog', { tenantCode, service });
  },
  /** 按访问域名反查租户：客户自定义域名在后台「官网配置」绑定；未绑定返回 null。 */
  resolveHost(host: string): Promise<{ tenantCode: string | null }> {
    return getJson<{ tenantCode: string | null }>('/public/site-resolve', { host });
  },
};
