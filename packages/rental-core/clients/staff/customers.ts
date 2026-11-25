/** 员工客户主档与会员请求，使用原租户级范围和服务端脱敏投影。 */
import type {
  SaveCorporateMembershipRequest,
  SavePersonalMembershipRequest,
  SaveSharedCustomerRequest,
  SharedCustomerProfile,
} from "../../src/contracts";
import type { RentalStaffClientPorts } from "./ports";

export function createRentalStaffCustomersApi({ request }: RentalStaffClientPorts) {
  function listCustomers(): Promise<SharedCustomerProfile[]> {
    return request<SharedCustomerProfile[]>("/platform/customers", { scope: "tenant" });
  }

  function getCustomer(customerId: string): Promise<SharedCustomerProfile> {
    return request<SharedCustomerProfile>(`/platform/customers/${encodeURIComponent(customerId)}`, { scope: "tenant" });
  }

  function createCustomer(input: SaveSharedCustomerRequest): Promise<SharedCustomerProfile> {
    return request<SharedCustomerProfile>("/platform/customers", { method: "POST", data: input, scope: "tenant" });
  }

  function updatePersonalCustomer(customerId: string, input: SavePersonalMembershipRequest): Promise<unknown> {
    return request(`/membership/personal/${encodeURIComponent(customerId)}`, { method: "PUT", data: input, scope: "tenant" });
  }

  function updateCorporateCustomer(input: SaveCorporateMembershipRequest): Promise<unknown> {
    return request("/membership/corporate", { method: "PUT", data: input, scope: "tenant" });
  }

  return { listCustomers, getCustomer, createCustomer, updatePersonalCustomer, updateCorporateCustomer };
}

/** 本地关键字过滤（姓名 / 脱敏手机号尾号 / 企业名）；服务端列表接口暂无关键字参数。 */
export function matchCustomer(row: SharedCustomerProfile, keyword: string): boolean {
  const key = keyword.trim().toLowerCase();
  if (!key) return true;
  return [row.name, row.phoneMasked, row.corporateName ?? ""].some((text) => text.toLowerCase().includes(key));
}
