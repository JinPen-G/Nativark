/** 公共成员页沿当前会话读取基础角色/组织，关闭弹窗时保留原邀请请求及待核结果。 */
import { useQuery } from "@tanstack/react-query";
import type { OrganizationSummary, SystemRoleRow } from "@rental-os/platform-contracts";
import { QueryState } from "../../components/QueryState";
import { useAdminRuntime } from "../../runtime";
import { OperatorInvitations } from "../messaging";

export function PublicMemberInvitations({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runtime = useAdminRuntime(), epoch = runtime.currentSessionEpoch();
  const roles = useQuery({ queryKey: ["public-management", epoch, "roles"], enabled: open,
    queryFn: ({ signal }) => runtime.request<SystemRoleRow[]>("/platform/roles", { signal }) });
  const organizations = useQuery({ queryKey: ["public-member-invitation-options", epoch, "organizations"], enabled: open,
    queryFn: ({ signal }) => runtime.request<OrganizationSummary[]>("/platform/organizations", { signal }) });
  const error = roles.error ?? organizations.error;
  return <>
    {open && <QueryState loading={roles.isPending || organizations.isPending} error={error}
      onRetry={() => Promise.all([roles.refetch(), organizations.refetch()])}>{null}</QueryState>}
    <OperatorInvitations open={open && Boolean(roles.data && organizations.data) && !error} onClose={onClose}
      roles={roles.data ?? []} organizations={organizations.data ?? []} />
  </>;
}
