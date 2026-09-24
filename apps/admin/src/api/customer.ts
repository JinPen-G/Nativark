/** 客户档案 API：客户账户、会员身份状态、合并与查询（`/rental/v1/customers*`）。 */
import type {
  ChangeCustomerAccountStatusRequest,
  ChangeCustomerMembershipStatusRequest,
  CustomerAccount,
  CustomerClosability,
  CustomerCorporateContract,
  CustomerCorporateCredit,
  CustomerCorporateInvoiceProfile,
  CustomerDuplicateCandidate,
  CustomerMergePreview,
  CustomerSensitiveAccessAuditEntry,
  CustomerStatusHistoryEntry,
  CustomerMembership,
  CustomerProfileOrderQuery,
  CustomerProfileOverview,
  SaveCustomerProfileAddressRequest,
  MergeCustomersRequest,
  SaveCustomerContractRequest,
  SaveCustomerCreditRequest,
  SaveCustomerInvoiceProfileRequest,
  SharedCustomerProfile
} from "@rental-os/shared";
import { request } from "./http";

/**
 * CUSTOMER-01E：客户主档管理端接口。
 *
 * 两条口径在这一层就固定，不留给页面选择：
 *   1. **租户取自会话**。主档、账号与会员状态均在租户内统一，不传 tenantId 或 workspaceId。
 *      经营空间只承载订单及空间业务配置，不再决定客户是否是会员。
 *   2. **脱敏由服务端完成**。这里不做任何反脱敏或本地拼接，页面拿到什么就显示什么；
 *      需要明文的场景由服务端按解密权限决定并留访问审计。
 */
export const customerApi = {
  /** 租户级客户主档列表（跨空间可见是设计：同一客户不必在每个空间重复注册）。 */
  list: () => request<SharedCustomerProfile[]>("/platform/customers"),
  detail: (customerId: string) => request<SharedCustomerProfile>(`/platform/customers/${customerId}`),
  profileOverview: (customerId: string, params?: CustomerProfileOrderQuery) =>
    request<CustomerProfileOverview>(`/platform/customers/${customerId}/profile`, { params }),
  saveAddress: (customerId: string, data: SaveCustomerProfileAddressRequest) =>
    request<CustomerProfileOverview["addresses"][number]>(`/platform/customers/${customerId}/addresses`, { method: "put", data }),
  removeAddress: (customerId: string, addressId: string) =>
    request<{ success: true }>(`/platform/customers/${customerId}/addresses/${addressId}`, { method: "delete" }),

  ensureAccount: (customerId: string) =>
    request<CustomerAccount>(`/platform/customers/${customerId}/account`, { method: "post" }),
  /** 账号级状态：停用会阻止该客户登录**全部**经营空间。 */
  changeAccountStatus: (customerId: string, data: ChangeCustomerAccountStatusRequest) =>
    request<CustomerAccount>(`/platform/customers/${customerId}/account-status`, { method: "put", data }),
  /** 租户会员状态：暂停、退出或注销会影响租户内全部经营空间。 */
  changeMembershipStatus: (customerId: string, data: ChangeCustomerMembershipStatusRequest) =>
    request<CustomerMembership>(`/platform/customers/${customerId}/membership-status`, { method: "put", data }),

  statusHistory: (customerId: string) =>
    request<CustomerStatusHistoryEntry[]>(`/platform/customers/${customerId}/status-history`),
  /** 敏感资料访问审计。本身就是访问画像，需解密权限（服务端判定）。 */
  sensitiveAccess: (customerId: string) =>
    request<CustomerSensitiveAccessAuditEntry[]>(`/platform/customers/${customerId}/sensitive-access`),

  duplicates: (customerId: string) =>
    request<CustomerDuplicateCandidate[]>(`/platform/customers/${customerId}/duplicates`),
  mergePreview: (customerId: string, targetCustomerId: string) =>
    request<CustomerMergePreview>(`/platform/customers/${customerId}/merge-preview`, { params: { targetCustomerId } }),
  merge: (data: MergeCustomersRequest) =>
    request<unknown>("/platform/customers/merge", { method: "post", data }),
  closability: (customerId: string) =>
    request<CustomerClosability>(`/platform/customers/${customerId}/closability`),
  membershipClosability: (customerId: string) =>
    request<CustomerClosability>(`/platform/customers/${customerId}/membership-closability`),

  invoiceProfiles: (customerId: string) =>
    request<CustomerCorporateInvoiceProfile[]>(`/platform/customers/${customerId}/invoice-profiles`),
  /** 新增或编辑开票资料。带 id 即编辑；设为默认由服务端负责降级旧默认。 */
  saveInvoiceProfile: (customerId: string, data: SaveCustomerInvoiceProfileRequest) =>
    request<CustomerCorporateInvoiceProfile>(`/platform/customers/${customerId}/invoice-profiles`, { method: "put", data }),
  contracts: (customerId: string) =>
    request<CustomerCorporateContract[]>(`/platform/customers/${customerId}/contracts`),
  saveContract: (customerId: string, data: SaveCustomerContractRequest) =>
    request<CustomerCorporateContract>(`/platform/customers/${customerId}/contracts`, { method: "put", data }),
  credit: (customerId: string) =>
    request<CustomerCorporateCredit | undefined>(`/platform/customers/${customerId}/credit`),
  /**
   * 维护授信与账期。**只存事实**：本阶段不接进报价、支付或订单额度占用——
   * 额度占用要与订单、支付、退款联动，缺这层联动就先改金额链路会留下对不上的账。
   */
  saveCredit: (customerId: string, data: SaveCustomerCreditRequest) =>
    request<CustomerCorporateCredit>(`/platform/customers/${customerId}/credit`, { method: "put", data })
};
