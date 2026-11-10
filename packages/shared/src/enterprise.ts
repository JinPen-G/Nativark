/** Enterprise customer contracts. Customer authentication stays personal;
 * portal activation and each action are distinct from rental/payment authority. */
export const ENTERPRISE_PORTAL_ACTIONS = ["portal:enter", "members:read", "members:manage", "administrators:manage", "invites:manage", "policy:manage", "approvals:review", "orders:read", "finance:read", "requests:manage", "audit:read", "export:create"] as const;
export type EnterprisePortalAction = typeof ENTERPRISE_PORTAL_ACTIONS[number];

export interface EnterprisePortalGrant {
  membershipId: string;
  actions: EnterprisePortalAction[];
}
export interface EnterprisePortalConfiguration {
  tenantEnabled: boolean;
  tenantRevision: number;
  corporateCustomerId: string;
  enabled: boolean;
  revision: number;
  grants: EnterprisePortalGrant[];
}
export interface SaveEnterpriseTenantSettingsRequest {
  enabled: boolean;
  expectedRevision: number;
  operationKey: string;
  reason: string;
}
export interface SaveEnterprisePortalConfigurationRequest extends SaveEnterpriseTenantSettingsRequest {
  grants: EnterprisePortalGrant[];
}
export interface EnterpriseManagedCorporate {
  corporateCustomerId: string;
  corporateName: string;
  membershipId: string;
  actions: EnterprisePortalAction[];
  permissionRevision: string;
}
export interface EnterpriseEntryResponse {
  apiVersion: "v1";
  tenantCode: string;
  tenantName: string;
  customerId: string;
  displayName: string;
  state: "ready" | "not_enabled" | "membership_restricted" | "no_management_access";
  corporates: EnterpriseManagedCorporate[];
  ownRelations: Array<{ corporateCustomerId: string; corporateName: string; role: string }>;
}
export interface EnterpriseMemberView {
  membershipId: string;
  displayName: string;
  updatedAt: string;
  role: string;
  department?: string;
  employeeNo?: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface EnterpriseAdministratorView {
  membershipId: string;
  role: "admin" | "employee";
  actions: EnterprisePortalAction[];
  updatedAt: string;
  revision: number;
}
export interface EnterpriseOwnRelation extends EnterpriseMemberView {
  corporateCustomerId: string;
  corporateName: string;
}
export interface EnterpriseMembersResponse {
  apiVersion: "v1";
  corporateCustomerId: string;
  permissionRevision: string;
  items: EnterpriseMemberView[];
  page: number;
  pageSize: number;
  total: number;
}

export const ENTERPRISE_ORDER_GROUPS = ["enterprise_paid", "personal_benefit"] as const;
export type EnterpriseOrderGroup = typeof ENTERPRISE_ORDER_GROUPS[number];

export interface EnterpriseOrdersQuery {
  group?: EnterpriseOrderGroup;
  keyword?: string;
  page?: number;
  pageSize?: number;
}
export type EnterpriseOrderExportQuery = Pick<EnterpriseOrdersQuery, "group" | "keyword">;
export const ENTERPRISE_ORDER_EXPORT_LIMIT = 500;

/** Original enterprise responsibility or disclosed personal-payment identity.
 * Employee names and memberships come from the order snapshot. */
export interface EnterpriseOrderIndex {
  orderId: string;
  orderNo: string;
  group: EnterpriseOrderGroup;
  categoryCode: string;
  status: string;
  employeeCustomerId: string | null;
  employeeName: string | null;
  corporateMembershipId: string | null;
  startAt: string;
  endAt: string;
  effectiveEndAt: string | null;
  currentReturnAt: string;
  currency: string | null;
  payableAmount: number | null;
  finalPayableAmount: number | null;
  discountAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseOrderLineView {
  lineId: string;
  itemGroupName: string;
  pricingGroupName: string | null;
  quantity: number;
  cancelledQuantity: number;
  amount: number | null;
}

export interface EnterpriseOrderBenefitView {
  planName: string;
  type: string;
  appliesTo: string;
  appliedAmount: number | null;
}

export interface EnterpriseOrderDetail extends EnterpriseOrderIndex {
  corporateName: string | null;
  fulfillmentMode: string;
  rentalAmount: number | null;
  serviceAmount: number | null;
  fulfillmentAmount: number | null;
  couponAmount: number | null;
  adjustmentAmount: number | null;
  taxAmount: number | null;
  /** Only contractual targets for enterprise-paid orders. Actual funding has a
   * separate finance reader and authorization. Personal deposit facts are omitted. */
  depositAmount: number | null;
  preAuthAmount: number | null;
  disclosure: { noticeVersion: string; acknowledgedAt: string } | null;
  lines: EnterpriseOrderLineView[];
  chargeLines: Array<{ code: string; name: string; type: string; amount: number | null }>;
  corporateBenefits: EnterpriseOrderBenefitView[] | null;
}

export interface EnterpriseOrderReadScope {
  apiVersion: "v1";
  tenantCode: string;
  corporateCustomerId: string;
  permissionRevision: string;
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  coverage: "current_workspace_authorized_enterprise_orders";
}

export interface EnterpriseOrdersResponse extends EnterpriseOrderReadScope {
  group: EnterpriseOrderGroup;
  items: EnterpriseOrderIndex[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EnterpriseOrderDetailResponse extends EnterpriseOrderReadScope {
  order: EnterpriseOrderDetail;
}

/** One bounded, complete filtered snapshot delivered under current export grants. */
export interface EnterpriseOrderExportResponse extends EnterpriseOrderReadScope {
  group: EnterpriseOrderGroup;
  items: EnterpriseOrderIndex[];
  total: number;
  maxRows: typeof ENTERPRISE_ORDER_EXPORT_LIMIT;
}
