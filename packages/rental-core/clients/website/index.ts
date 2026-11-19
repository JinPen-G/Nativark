/** Rental 官网公开请求与兼容合同，宿主供给网关基址。
 * 服务端持有渠道发布与公开字段投影，页面持有读取寿命和迟到响应隔离。 */
import type {
  ClientAvailabilityRequest,
  ClientCatalogItem,
  ClientCatalogPricingGroup,
  ClientCatalogResponse,
  ClientChannelBootstrapResponse,
  ClientPublicDocumentKind,
  ClientPublicDocumentResponse,
  ClientWebsiteConfig,
  ClientWebsiteHostResolution,
} from "../../src/client-contracts";
import type { RentalAvailabilityLine } from "../../src/contracts";

export type BootstrapWebsite = ClientWebsiteConfig;
export type PublicDocumentResponse = ClientPublicDocumentResponse;
export type BootstrapResponse = ClientChannelBootstrapResponse;
export type CatalogItem = ClientCatalogItem;
export type CatalogPricingGroup = ClientCatalogPricingGroup;
export type PublicCatalogResponse = ClientCatalogResponse;

/** 原官网支持省略门店，正式公开可用性 HTTP 合同仍须核定。 */
export type PublicAvailabilityRequest = Omit<ClientAvailabilityRequest, "locationId"> &
  Partial<Pick<ClientAvailabilityRequest, "locationId">>;

/** 保留原官网的宽松行投影，缺可用性事实继续交由原页面表达未知。 */
export interface PublicAvailabilityResponse {
  lines?: Array<Pick<RentalAvailabilityLine, "itemGroupId"> &
    Partial<Pick<RentalAvailabilityLine, "available" | "availableQuantity">>>;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function createRentalWebsitePublicClient(apiBase: string) {
  const clientV1 = `${apiBase.replace(/\/$/, "")}/api/client/v1`;
  const requestJson = async <T>(path: string, params: Record<string, string>,
    init: RequestInit = { headers: { Accept: "application/json" } }): Promise<T> => {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${clientV1}${path}?${query}`, init);
    if (!response.ok) throw new ApiError(response.status, `请求失败（${response.status}）`);
    const body = await response.json();
    // 同时消费原 { data, requestId } 包装和原裸响应，保持 nullish 解包语义。
    return (body?.data ?? body) as T;
  };

  return {
    bootstrap(tenantCode: string): Promise<BootstrapResponse> {
      return requestJson<BootstrapResponse>("/public/bootstrap", { tenantCode, client: "web" });
    },
    publicCatalog(tenantCode: string, service: string): Promise<PublicCatalogResponse> {
      return requestJson<PublicCatalogResponse>("/public/catalog", { tenantCode, service });
    },
    publicAvailability(tenantCode: string, service: string, payload: PublicAvailabilityRequest): Promise<PublicAvailabilityResponse> {
      return requestJson<PublicAvailabilityResponse>("/public/availability", { tenantCode, service }, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    },
    publicDocument(tenantCode: string, kind: ClientPublicDocumentKind): Promise<PublicDocumentResponse> {
      return requestJson<PublicDocumentResponse>(`/public/documents/${encodeURIComponent(kind)}`, { tenantCode });
    },
    resolveHost(host: string): Promise<ClientWebsiteHostResolution> {
      return requestJson<ClientWebsiteHostResolution>("/public/site-resolve", { host });
    },
  };
}
