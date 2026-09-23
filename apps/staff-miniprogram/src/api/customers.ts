import type { SaveCorporateMembershipRequest, SavePersonalMembershipRequest, SaveSharedCustomerRequest, SharedCustomerProfile } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 客户主档（租户级）：需要 member:view + 租户级全量数据范围。
 * 小程序只展示脱敏字段；服务端已按权限脱敏，这里不做任何“揭示”。
 */
export function listCustomers(): Promise<SharedCustomerProfile[]> {
  return request<SharedCustomerProfile[]>("/platform/customers", { scope: "tenant" });
}

export function getCustomer(customerId: string): Promise<SharedCustomerProfile> {
  return request<SharedCustomerProfile>(`/platform/customers/${encodeURIComponent(customerId)}`, { scope: "tenant" });
}

export function createCustomer(input: SaveSharedCustomerRequest): Promise<SharedCustomerProfile> {
  return request<SharedCustomerProfile>("/platform/customers", { method: "POST", data: input, scope: "tenant" });
}

export function updatePersonalCustomer(customerId: string, input: SavePersonalMembershipRequest): Promise<unknown> {
  return request(`/membership/personal/${encodeURIComponent(customerId)}`, { method: "PUT", data: input, scope: "tenant" });
}

export function updateCorporateCustomer(input: SaveCorporateMembershipRequest): Promise<unknown> {
  return request("/membership/corporate", { method: "PUT", data: input, scope: "tenant" });
}

/** 本地关键字过滤（姓名 / 脱敏手机号尾号 / 企业名）；服务端列表接口暂无关键字参数。 */
export function matchCustomer(row: SharedCustomerProfile, keyword: string): boolean {
  const key = keyword.trim().toLowerCase();
  if (!key) return true;
  return [row.name, row.phoneMasked, row.corporateName ?? ""].some((text) => text.toLowerCase().includes(key));
}
