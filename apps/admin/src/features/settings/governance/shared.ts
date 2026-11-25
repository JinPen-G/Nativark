/** Copilot 沿原已验证 AuthStore 读取同一治理权限，其他映射由 Rental 持有。 */
import { useAuthStore } from "@/features/auth/authStore";
import { useGovernancePermissions as readGovernancePermissions } from "@rental-os/rental-core/admin/governance/logic";
export {
  type GovernancePermissions,
  type GovernanceTabContext,
  errorText,
  securityRuleLabels,
  preauthorizationRuleLabels,
  ruleSecurityGroups,
} from "@rental-os/rental-core/admin/governance/logic";
export function useGovernancePermissions() {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  return readGovernancePermissions(hasPermission);
}
