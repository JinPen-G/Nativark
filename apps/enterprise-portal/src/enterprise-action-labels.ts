/** Display names for registered actions only. These labels never grant authority or availability. */
import type { EnterprisePortalAction } from "@rental-os/shared";
const labels: Record<EnterprisePortalAction, [string, string]> = {
  "portal:enter": ["进入企业后台", "Enter portal"], "members:read": ["查看成员", "Read members"], "members:manage": ["维护成员", "Manage members"],
  "administrators:manage": ["管理管理员", "Manage administrators"], "invites:manage": ["管理邀请", "Manage invitations"], "policy:manage": ["管理政策", "Manage policies"],
  "approvals:review": ["审核付费申请", "Review approvals"], "orders:read": ["查看企业订单", "Read enterprise orders"], "finance:read": ["查看企业财务", "Read finances"],
  "requests:manage": ["管理资料申请", "Manage requests"], "audit:read": ["查看操作记录", "Read audit records"], "export:create": ["导出受权资料", "Export permitted data"]
};
export function enterpriseActionLabel(action: EnterprisePortalAction, english: boolean): string {
  return labels[action][english ? 1 : 0];
}
