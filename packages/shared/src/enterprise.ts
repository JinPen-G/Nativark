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
