/** 原 MCP 的经营空间管理权威。复用当前账号权限、原空间投影和同一事务；
 * 账号/角色读取仍由宿主提供，不创建身份、授予权限或回退到内存范围。 */
import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";

type Binding = { userId: string; tenantId: string; workspaceId: string };
type CurrentUser = Pick<SystemUserRow, "id" | "tenantId" | "isActive" | "isSaasAdmin">;
type Result<T> = T | PromiseLike<T>;

export interface OriginalMcpWorkspaceIntegrationSource {
  assertTenantPermissionInTransaction(transaction: Prisma.TransactionClient, tenantId: string,
    userId: string, permission: "system:integration:manage"): Result<SystemUserRow>;
  resolveTrustedWorkspacePrincipal(binding: Binding, transaction: Prisma.TransactionClient):
    Result<{ workspaceValid: boolean; workspaceId?: string | null } | null | undefined>;
}

/** 与原 PlatformRepository 单源的账号及空间复验，调用方持有原事务。 */
export async function assertOriginalMcpWorkspaceIntegrationManagement(
  source: OriginalMcpWorkspaceIntegrationSource, binding: Binding, transaction: Prisma.TransactionClient,
): Promise<SystemUserRow> {
  const actor = await source.assertTenantPermissionInTransaction(transaction, binding.tenantId, binding.userId, "system:integration:manage");
  if (!actor.isActive || actor.mustChangePassword !== false || actor.id !== binding.userId || actor.tenantId !== binding.tenantId) {
    throw new ForbiddenException("缺少当前租户集成管理身份");
  }
  const context = await source.resolveTrustedWorkspacePrincipal(binding, transaction);
  if (!context?.workspaceValid || context.workspaceId !== binding.workspaceId) throw new ForbiddenException("缺少当前经营空间管理范围");
  return actor;
}

export interface OriginalMcpManagedWorkspaceRepository {
  assertTrustedWorkspaceIntegrationManagement(binding: Binding, transaction: Prisma.TransactionClient): Result<SystemUserRow>;
  findUserById(userId: string, transaction: Prisma.TransactionClient): Result<CurrentUser | null | undefined>;
}

export interface OriginalMcpWorkspaceManagementSource {
  useMysqlDataSource(): boolean;
  repository: OriginalMcpManagedWorkspaceRepository;
}

/** 原服务端持久化准入检查；不能由请求字段选择存储模式。 */
export async function assertOriginalMcpManagedWorkspace(
  source: OriginalMcpWorkspaceManagementSource, binding: Binding, transaction: Prisma.TransactionClient,
): Promise<SystemUserRow> {
  if (!source.useMysqlDataSource()) throw new ForbiddenException("可信空间集成管理需要原持久身份系统");
  return source.repository.assertTrustedWorkspaceIntegrationManagement(binding, transaction);
}

export async function assertOriginalMcpManagedSubject(source: OriginalMcpWorkspaceManagementSource,
  binding: Binding, targetUserId: string, transaction: Prisma.TransactionClient) {
  if (!source.useMysqlDataSource() || !transaction?.user || typeof targetUserId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(targetUserId)) throw new ForbiddenException("可信主体管理需要原持久身份系统");
  const actor = await assertOriginalMcpManagedWorkspace(source, binding, transaction);
  const user = await source.repository.findUserById(targetUserId, transaction);
  if (!user || typeof user !== "object") throw new ForbiddenException("缺少当前租户主体");
  const descriptors = Object.getOwnPropertyDescriptors(user);
  const value = (name: string) => { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, "value")) throw new ForbiddenException("缺少当前租户主体"); return field.value; };
  if (value("id") !== targetUserId || value("tenantId") !== binding.tenantId || value("isActive") !== true
    || value("isSaasAdmin") !== false || actor.id !== binding.userId || actor.tenantId !== binding.tenantId) throw new ForbiddenException("缺少当前租户主体");
  return Object.freeze({ actorId: actor.id, tenantId: binding.tenantId, userId: targetUserId, workspaceId: binding.workspaceId });
}

export interface PlatformService {
  assertTrustedWorkspaceIntegrationManagement(binding: Binding, transaction: Prisma.TransactionClient): Promise<SystemUserRow>;
  assertTrustedWorkspaceSubjectManagement(binding: Binding, targetUserId: string, transaction: Prisma.TransactionClient):
    ReturnType<typeof assertOriginalMcpManagedSubject>;
}

/** 受控宿主把自己的真实仓储和当前配置接入同一检查，默认不提供通过实现。 */
export function createOriginalMcpWorkspaceManagementAuthority(source: OriginalMcpWorkspaceManagementSource): PlatformService {
  return {
    assertTrustedWorkspaceIntegrationManagement: (binding, transaction) => assertOriginalMcpManagedWorkspace(source, binding, transaction),
    assertTrustedWorkspaceSubjectManagement: (binding, userId, transaction) => assertOriginalMcpManagedSubject(source, binding, userId, transaction),
  };
}
