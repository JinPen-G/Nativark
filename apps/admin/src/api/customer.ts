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
  CustomerWorkspaceLink,
  MergeCustomersRequest,
  SharedCustomerProfile
} from "@store-rental/shared";
import { request } from "./http";

/**
 * CUSTOMER-01E：客户主档管理端接口。
 *
 * 两条口径在这一层就固定，不留给页面选择：
 *   1. **空间取自会话**。空间会员相关的读写都不带 workspaceId——服务端按当前会话空间
 *      判定。让页面传空间等于允许在自己无权进入的空间改会员状态。
 *   2. **脱敏由服务端完成**。这里不做任何反脱敏或本地拼接，页面拿到什么就显示什么；
 *      需要明文的场景由服务端按解密权限决定并留访问审计。
 */
export const customerApi = {
  /** 租户级客户主档列表（跨空间可见是设计：同一客户不必在每个空间重复注册）。 */
  list: () => request<SharedCustomerProfile[]>("/platform/customers"),
  /** 当前会话空间的会员关系列表。 */
  workspaceList: () => request<SharedCustomerProfile[]>("/platform/workspace-customers"),
  detail: (customerId: string) => request<SharedCustomerProfile>(`/platform/customers/${customerId}`),

  ensureAccount: (customerId: string) =>
    request<CustomerAccount>(`/platform/customers/${customerId}/account`, { method: "post" }),
  /** 账号级状态：停用会阻止该客户登录**全部**经营空间。 */
  changeAccountStatus: (customerId: string, data: ChangeCustomerAccountStatusRequest) =>
    request<CustomerAccount>(`/platform/customers/${customerId}/account-status`, { method: "put", data }),
  /** 空间级会员状态：只影响当前会话空间，不动账号与其他空间。 */
  changeMembershipStatus: (customerId: string, data: ChangeCustomerMembershipStatusRequest) =>
    request<CustomerWorkspaceLink>(`/platform/workspace-customers/${customerId}/status`, { method: "put", data }),

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

  invoiceProfiles: (customerId: string) =>
    request<CustomerCorporateInvoiceProfile[]>(`/platform/customers/${customerId}/invoice-profiles`),
  contracts: (customerId: string) =>
    request<CustomerCorporateContract[]>(`/platform/customers/${customerId}/contracts`),
  credit: (customerId: string) =>
    request<CustomerCorporateCredit | undefined>(`/platform/customers/${customerId}/credit`)
};
