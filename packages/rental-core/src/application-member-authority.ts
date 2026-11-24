/** 普通 Rental 请求在原事务锁定当前会话/账号/角色，复用原 Auth 与 Guard 的权限和地点投影。
 * 租约仅用于本次请求的提交及返回复验，不改变业务状态、创建授权或包裹外部调用。 */
import { CoreAccessError } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalAuthService } from "./auth-service";
import type { RentalBusinessLocationReader } from "./business-location-scope";
import type { createRentalAuthorization } from "./http-auth";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import type { RentalWorkspaceAccessTransaction } from "./mysql-workspace-principal";

const methods = (value: unknown, names: readonly string[]) => value !== null && typeof value === "object"
  && names.every(name => name in value && typeof Reflect.get(value, name) === "function");
export function isRentalMemberTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction
  & RentalWorkspaceAccessTransaction & RentalBusinessLocationReader {
  return "user" in tx && methods(tx.user, ["findFirst", "findUnique", "findUniqueOrThrow", "update"])
    && "authSession" in tx && methods(tx.authSession, ["findFirst", "create", "updateMany"])
    && "workspaceMember" in tx && methods(tx.workspaceMember, ["findFirst"])
    && "businessWorkspace" in tx && methods(tx.businessWorkspace, ["findFirst"])
    && "organizationUnit" in tx && methods(tx.organizationUnit, ["findMany"])
    && "rentalFulfillmentLocation" in tx && methods(tx.rentalFulfillmentLocation, ["findMany"]);
}
export function memberLocationKey(scope: SystemUserRow["locationScope"]) {
  return scope && JSON.stringify([scope.mode, [...scope.locationIds].sort()]);
}
export function memberProjectionKey(user: SystemUserRow) {
  return JSON.stringify([user.id, user.tenantId, user.isActive, Boolean(user.mustChangePassword), Boolean(user.isSaasAdmin),
    Boolean(user.isPlatformAdmin), [...user.permissions].sort(), user.dataScope, user.organizationId, memberLocationKey(user.locationScope)]);
}

export interface RentalMemberAuthorityRequest {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly audience: "operator" | "staff";
  readonly user: SystemUserRow;
  readonly method: string;
  readonly path: string;
  readonly projection: "tenant" | "workspace";
  readonly allowInvalidWorkspace: boolean;
  /** 只由请求边界的原缓冲读取声明供给，不接受客户端或路由方法推断。 */
  readonly bufferedRead?: true;
}
export interface RentalMemberAuthorityLease { revalidate(): Promise<void> }

export function createRentalMemberAuthority(input: {
  auth: Pick<RentalAuthService, "lockRequestMemberAccess">;
  authorization: Pick<ReturnType<typeof createRentalAuthorization>, "resolveMemberLocationScope">;
}) {
  return Object.freeze({
    async lock(transaction: RentalBusinessTenantTransaction, request: RentalMemberAuthorityRequest): Promise<RentalMemberAuthorityLease> {
      const identity = getRequestIdentity();
      if (!isRentalMemberTransaction(transaction) || "$transaction" in transaction || !identity
        || identity.isSaasAdmin || identity.tenantId !== request.tenantId || identity.userId !== request.user.id
        || identity.workspaceId !== request.workspaceId || identity.audience !== request.audience)
        throw new CoreAccessError("denied", "Rental 普通请求缺少原同事务成员身份与空间依据");
      const original = memberProjectionKey(request.user);
      const lease = await input.auth.lockRequestMemberAccess(transaction,
        { projection: request.projection, allowInvalidWorkspace: request.allowInvalidWorkspace,
          ...(request.bufferedRead === true ? { bufferedRead: true } : {}) });
      const revalidate = async () => {
        const { user, configuredLocationScope } = await lease.revalidate();
        if (getRequestIdentity() !== identity || memberProjectionKey(user) !== original
          || user.id !== identity.userId || user.tenantId !== identity.tenantId || user.isSaasAdmin
          || !user.isActive || user.mustChangePassword
          || JSON.stringify([...user.permissions].sort()) !== JSON.stringify([...(identity.permissions ?? [])].sort())
          || user.dataScope !== identity.dataScope || user.organizationId !== identity.organizationId
          || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin))
          throw new CoreAccessError("denied", "Rental 当前成员权限或范围已变化，请重新读取");
        const locations = await input.authorization.resolveMemberLocationScope(Boolean(identity.staffApi), request.path,
          user, request.workspaceId, configuredLocationScope, transaction);
        if (memberLocationKey(locations) !== memberLocationKey(identity.locationScope)
          || identity.staffApi && memberLocationKey(locations) !== memberLocationKey(identity.staffLocationScope))
          throw new CoreAccessError("denied", "Rental 当前组织或地点范围已变化，请重新读取");
      };
      await revalidate();
      return Object.freeze({ revalidate });
    }
  });
}
export type RentalMemberAuthority = ReturnType<typeof createRentalMemberAuthority>;
