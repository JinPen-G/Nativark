import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/shared";
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds } from "../../common/request-identity";
import type { AuthService, WorkspaceAccessLease } from "../auth/auth.service";

export const CATEGORY_ADOPTION_MANAGE = "rental-os:category:adopt";

/** Rental action scope. Platform Auth owns the live identity and row locks. */
export function assertCategoryPreparationPermission(user: SystemUserRow) {
  if (user.isSaasAdmin || (!user.permissions.includes("*") && !user.permissions.includes(CATEGORY_ADOPTION_MANAGE))) {
    throw new ForbiddenException("仅获授权的租户人员可准备本空间的品类版本资料");
  }
  if (getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined) {
    throw new ForbiddenException("空间整体版本准备需要当前空间全部资料与地点权限，不能绕过受限数据范围");
  }
}

export async function lockCategoryAdoptionAccess(
  tx: Prisma.TransactionClient, actor: Pick<SystemUserRow, "id" | "tenantId">,
  auth?: Pick<AuthService, "lockRequestWorkspaceAccess">
): Promise<WorkspaceAccessLease> {
  const identity = getRequestIdentity();
  if (identity?.audience !== "operator" || identity.userId !== actor.id || identity.tenantId !== actor.tenantId || !identity.workspaceId) {
    throw new ForbiddenException("品类采用需要原运营会话的操作人与经营空间，不能借用其他身份");
  }
  if (!auth) throw new ConflictException("未装配事务内认证复核，品类操作未执行");
  const lease = await auth.lockRequestWorkspaceAccess(tx);
  const check = (current: SystemUserRow) => {
    if (current.id !== actor.id || current.tenantId !== actor.tenantId || current.dataScope !== "all" ||
        (current.locationScope !== undefined && current.locationScope.mode !== "all")) {
      throw new ForbiddenException("当前空间完整资料或地点权限已变化，品类操作未获准");
    }
    assertCategoryPreparationPermission(current);
    return current;
  };
  return { user: check(lease.user), revalidate: async () => check(await lease.revalidate()) };
}
