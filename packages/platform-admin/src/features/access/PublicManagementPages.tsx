/** 公共管理路由继续使用 main 原列表/侧窗；所选 Core 仅供给原业务字段与操作。
 * URL 只定位当前目录对象，不授予管理权限；旧编辑地址仍打开同一列表中的原编辑器。 */
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Result } from "../../components/ui";
import { useAdminSession } from "../../runtime";
import { canManagePublicResource } from "../../application-access";
import { PublicOperationsAccountPage } from "./PublicOperationsAccountPage";
import { PublicRolePermissionPage } from "./PublicRolePermissionPage";
import { PublicTenantManagementPage } from "./PublicTenantManagementPage";
import { usePublicManagementCoreAdapter } from "./management-adapter";

type Kind = "users" | "roles" | "tenants";
function ManagementGate({ kind, creating, children }: { kind: Kind; creating: boolean; children: ReactNode }) {
  const { user, sessionVerified } = useAdminSession();
  const allowed = kind === "tenants" ? canManagePublicResource(user, "saas", "system:tenant:manage")
    && (!creating || canManagePublicResource(user, "saas", "system:tenant:bootstrap"))
    : canManagePublicResource(user, "tenant", kind === "users" ? "system:user:manage" : "system:role:manage");
  return sessionVerified && allowed ? children : <Result status="403" title="403" />;
}
export function PublicManagementPage({ kind, edit = false, status = false, action = false }: { kind: Kind; edit?: boolean; status?: boolean; action?: boolean }) {
  const { id } = useParams();
  const core = usePublicManagementCoreAdapter();
  const UsersPage = core?.UsersPage ?? PublicOperationsAccountPage;
  const TenantsPage = core?.TenantsPage ?? PublicTenantManagementPage;
  return <ManagementGate kind={kind} creating={edit && !id}>{kind === "users"
    ? <UsersPage key={id ?? "directory"} routeEdit={edit} routeAction={action} />
    : kind === "roles" ? <PublicRolePermissionPage key={id ?? "directory"} routeEdit={edit} routeAction={action} />
    : <TenantsPage key={id ?? "directory"} routeEdit={edit} routeStatus={status} />}</ManagementGate>;
}
