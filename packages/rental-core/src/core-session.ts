/** Rental 的 Core 会话权限投影。公共读取器继续持有原会话、租户 Core 授权及成员分配查询。
 * 本适配只把原租户/经营空间权限交给 Rental 的精确权限映射，不改变管理身份或 Guard 的业务范围。
 */
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { CoreSessionContext } from "@rental-os/core-contracts";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { composePlatformCoreSessionReader, type PlatformCoreUsers } from "@rental-os/platform-core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalMysqlAuthenticationRepository } from "./mysql-auth-source";
import { rentalCorePermissionCodes } from "./permissions";

export type RentalCoreSessionTransaction = Parameters<RentalMysqlAuthenticationRepository["lockWorkspaceSessionUser"]>[0]
  & CoreHostSqlTransaction;
export interface RentalCoreSessionDependencies<Tx extends RentalCoreSessionTransaction> {
  database: CoreHostSqlClient<Tx>;
  authSource: Pick<RentalMysqlAuthenticationRepository,
    "findUserById" | "lockWorkspaceSessionUser" | "readWorkspaceSessionUser">;
  catalogue: CoreDeployedCatalogue;
}

function currentSession() {
  const identity = getRequestIdentity(), evidence = identity?.accessSession;
  if (!identity?.tenantId || !identity.userId || identity.audience !== "operator" || !evidence?.sessionId
    || !Number.isSafeInteger(evidence.expiresAt) || evidence.expiresAt <= Date.now() / 1000) {
    throw new UnauthorizedException("Rental Core 目录缺少当前 operator 签名会话依据");
  }
  // 公共 Guard 可以仅保留签名 wid；存在两份空间依据时必须一致，不能借 null 或另一个空间降级权限来源。
  if (identity.workspaceId !== undefined && evidence.workspaceId !== undefined
    && identity.workspaceId !== evidence.workspaceId) {
    throw new ForbiddenException("Rental Core 目录的原会话空间依据不一致");
  }
  const workspaceId = evidence.workspaceId ?? identity.workspaceId;
  if (workspaceId !== undefined && (typeof workspaceId !== "string" || !workspaceId.trim())) {
    throw new ForbiddenException("Rental Core 目录缺少有效的原经营空间");
  }
  return Object.freeze({ tenantId: identity.tenantId, userId: identity.userId, audience: "operator" as const,
    sessionId: evidence.sessionId, expiresAt: evidence.expiresAt, workspaceId,
    signedWorkspaceId: evidence.workspaceId, requestWorkspaceId: identity.workspaceId });
}

/** 仅将返回函数交给 Core session reader；不得用此 users 投影替换租户/SaaS 管理仓储。
 * 每次调用固定一个原会话和事务；返回前再次读取原角色和空间成员，撤权不回退到租户通配。
 */
export function composeRentalCoreSessionReader<Tx extends RentalCoreSessionTransaction>(
  input: RentalCoreSessionDependencies<Tx>
): () => Promise<CoreSessionContext> {
  if (typeof input?.database?.$transaction !== "function" || !input.catalogue
    || (["findUserById", "lockWorkspaceSessionUser", "readWorkspaceSessionUser"] as const).some(method =>
      typeof input.authSource?.[method] !== "function")) {
    throw new Error("Rental Core 会话装配缺少原数据库、认证空间权威或部署目录");
  }
  return async () => {
    const expected = currentSession();
    let originalTransaction: Tx | undefined;
    let workspaceLocked = false;
    const assertSession = () => {
      const current = currentSession();
      if (current.tenantId !== expected.tenantId || current.userId !== expected.userId
        || current.sessionId !== expected.sessionId || current.expiresAt !== expected.expiresAt
        || current.signedWorkspaceId !== expected.signedWorkspaceId
        || current.requestWorkspaceId !== expected.requestWorkspaceId) {
        throw new UnauthorizedException("Rental Core 目录读取期间原会话或经营空间已变化");
      }
    };
    const assertUser = (user: SystemUserRow): SystemUserRow => {
      if (user.id !== expected.userId || user.tenantId !== expected.tenantId || !user.isActive || user.mustChangePassword) {
        throw new ForbiddenException("Rental Core 目录的原账号已失效或不属于当前租户");
      }
      return user;
    };
    const users: PlatformCoreUsers<Tx> = {
      async findUserById(userId, transaction) {
        assertSession();
        if (userId !== expected.userId || !transaction || originalTransaction && transaction !== originalTransaction) {
          throw new UnauthorizedException("Rental Core 目录必须复用原主体与同一身份事务");
        }
        originalTransaction = transaction;
        const tenantUser = await input.authSource.findUserById(userId, transaction);
        if (!tenantUser) throw new ForbiddenException("Rental Core 目录的原租户账号已不可用");
        assertUser(tenantUser);
        let workspaceUser: SystemUserRow | undefined;
        if (expected.workspaceId) {
          const binding = { tenantId: expected.tenantId, userId: expected.userId, workspaceId: expected.workspaceId,
            sessionId: expected.sessionId, audience: expected.audience };
          // 公共 principal 已锁租户/账号/会话/租户角色；原空间仓储补持成员及空间角色锁。
          // 后续 revalidate 只重读这个原会话，不重新解析默认空间或换身份。
          workspaceUser = assertUser(workspaceLocked
            ? await input.authSource.readWorkspaceSessionUser(transaction, binding)
            : await input.authSource.lockWorkspaceSessionUser(transaction, binding));
          workspaceLocked = true;
        }
        assertSession();
        return { ...tenantUser, permissions: [...new Set([
          ...tenantUser.permissions.filter(code => code !== "*" && !code.startsWith("rental:")),
          ...rentalCorePermissionCodes({ audience: expected.audience, tenantUser, workspaceUser,
            workspaceId: expected.workspaceId })
        ])] };
      }
    };
    const result = await composePlatformCoreSessionReader({ database: input.database, users, catalogue: input.catalogue })();
    assertSession();
    return result;
  };
}
