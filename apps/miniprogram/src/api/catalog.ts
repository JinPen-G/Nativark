import type {
  ClientAvailabilityRequest,
  ClientCatalogResponse,
  ClientCreateQuoteRequest,
  RentalAvailabilityResult,
  RentalCustomerCoupon,
  RentalQuoteSnapshotV1
} from "@rental-os/shared";
import { PLANNED_CONTRACTS, contractMissing, plannedUnavailable } from "../contracts/planned";
import { request } from "../core/http";

/** 当前服务的目录（需登录；服务端按会话中的服务返回）。 */
export async function fetchCatalog(): Promise<ClientCatalogResponse> {
  return request<ClientCatalogResponse>("/catalog");
}

/** 游客公开目录（拟新增 MP-03）。未提供时抛 UNAVAILABLE，页面引导登录。 */
export async function fetchPublicCatalog(serviceCode: string): Promise<ClientCatalogResponse> {
  try {
    return await request<ClientCatalogResponse>(PLANNED_CONTRACTS.publicCatalog.path, { auth: "none", query: { service: serviceCode } });
  } catch (error) {
    if (contractMissing(error)) throw plannedUnavailable("publicCatalog");
    throw error;
  }
}

export async function checkAvailability(input: ClientAvailabilityRequest): Promise<RentalAvailabilityResult> {
  return request<RentalAvailabilityResult>("/availability", { method: "POST", data: input });
}

/** 服务端报价：金额只在这里产生，小程序不做任何价格计算。 */
export async function createQuote(input: ClientCreateQuoteRequest): Promise<RentalQuoteSnapshotV1> {
  return request<RentalQuoteSnapshotV1>("/quotes", { method: "POST", data: input });
}

export async function fetchQuote(quoteId: string): Promise<RentalQuoteSnapshotV1> {
  return request<RentalQuoteSnapshotV1>(`/quotes/${encodeURIComponent(quoteId)}`);
}

export async function fetchCoupons(): Promise<RentalCustomerCoupon[]> {
  const result = await request<RentalCustomerCoupon[] | { items?: RentalCustomerCoupon[] }>("/coupons");
  return Array.isArray(result) ? result : result?.items ?? [];
}
