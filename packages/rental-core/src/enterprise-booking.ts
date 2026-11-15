/** 原企业租赁预约的告知与冻结依据；只是历史合同，不授予企业权限或认定资金事实。 */
export type EnterpriseBookingApprovalMode = "per_order" | "without_per_order" | "unconfigured";
export interface EnterpriseDisclosure { noticeVersion: string; acknowledged: boolean }
export interface EnterpriseBookingBasis {
  merchantRevision: number; companyRevision: number; employeeRevision: number;
  membershipUpdatedAt: string; noticeVersion: string; acknowledgedAt: string;
  /** Contractual default only; does not claim a deposit payment or freeze. */
  guaranteePayer: "enterprise"; approvalMode: EnterpriseBookingApprovalMode;
}
