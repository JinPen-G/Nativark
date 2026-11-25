/** 客户目录、可用性和报价请求，宿主供给公开渠道配置与原缺能力错误。 */
import type {
  ClientAvailabilityRequest,
  ClientCatalogResponse,
  ClientCreateQuoteRequest,
} from "../../src/client-contracts";
import type {
  RentalAvailabilityResult,
  RentalCustomerCoupon,
  RentalQuoteSnapshotV1,
} from "../../src/contracts";
import type { RentalMiniProgramCatalogPorts } from "./ports";

export function createRentalMiniProgramCatalogApi(ports: RentalMiniProgramCatalogPorts) {
  const { request, publicConfig: PUBLIC_CONFIG, contractMissing, featureUnavailable } = ports;

  /** 当前服务的目录（需登录；服务端按会话中的服务返回）。 */
  async function fetchCatalog(): Promise<ClientCatalogResponse> {
    return request<ClientCatalogResponse>("/catalog");
  }

  /** 游客公开目录（MP-03）：只对已发布到小程序渠道的服务开放；未发布时抛 UNAVAILABLE，页面引导登录。 */
  async function fetchPublicCatalog(serviceCode: string): Promise<ClientCatalogResponse> {
    try {
      return await request<ClientCatalogResponse>("/public/catalog", { auth: "none", query: { tenantCode: PUBLIC_CONFIG.tenantCode, service: serviceCode } });
    } catch (error) {
      if (contractMissing(error)) throw featureUnavailable("商户尚未开放该服务的游客浏览，登录后即可查看设备");
      throw error;
    }
  }

  async function checkAvailability(input: ClientAvailabilityRequest): Promise<RentalAvailabilityResult> {
    return request<RentalAvailabilityResult>("/availability", { method: "POST", data: input });
  }

  /** 服务端报价：金额只在这里产生，小程序不做任何价格计算。 */
  async function createQuote(input: ClientCreateQuoteRequest): Promise<RentalQuoteSnapshotV1> {
    return request<RentalQuoteSnapshotV1>("/quotes", { method: "POST", data: input });
  }

  async function fetchQuote(quoteId: string): Promise<RentalQuoteSnapshotV1> {
    return request<RentalQuoteSnapshotV1>(`/quotes/${encodeURIComponent(quoteId)}`);
  }

  async function fetchCoupons(): Promise<RentalCustomerCoupon[]> {
    const result = await request<RentalCustomerCoupon[] | { items?: RentalCustomerCoupon[] }>("/coupons");
    return Array.isArray(result) ? result : result?.items ?? [];
  }

  return {
    fetchCatalog,
    fetchPublicCatalog,
    checkAvailability,
    createQuote,
    fetchQuote,
    fetchCoupons,
  };
}
