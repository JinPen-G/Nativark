/** Rental经营事实的空间解析与跨空间写入边界。当前请求仍由原Guard/ALS授权。
 * 新空间配置只消费原创建事务的目标对象，其他无会话路径只读原默认空间，不补授权或创建空间。 */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { getRequestIdentity, getRequestWorkspaceId } from "@rental-os/platform-server/request-identity";

export type RentalWorkspaceScopeClient = {
  businessWorkspace: {
    findFirst: (args: {
      where: {
        tenantId?: string;
        defaultMarker?: string;
        id?: string;
      };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

type CreatedWorkspaceConfiguration = {
  id: string;
  tenantId: string;
  categoryCode: string;
  categoryVersionId: string | null;
  categoryAdoptionRevision: number;
  status: string;
  isDefault: boolean;
  defaultMarker: string | null;
};
const createdWorkspaceConfiguration = new AsyncLocalStorage<{
  transaction: RentalWorkspaceScopeClient;
  workspace: Readonly<CreatedWorkspaceConfiguration>;
  identity: ReturnType<typeof getRequestIdentity>;
  active: boolean;
  claimed: boolean;
}>();

/** Only the original create callback selects its returned row. This is a configuration
 * destination in that transaction, while the original Guard identity remains unchanged. */
export async function withCreatedRentalWorkspaceConfiguration<T>(
  transaction: RentalWorkspaceScopeClient, workspace: CreatedWorkspaceConfiguration, consume: () => Promise<T>
): Promise<T> {
  if (createdWorkspaceConfiguration.getStore() || !transaction || "$transaction" in transaction
    || !workspace.id || !workspace.tenantId || !workspace.categoryVersionId
    || workspace.status !== "ACTIVE" || workspace.isDefault || workspace.defaultMarker !== workspace.id
    || workspace.categoryAdoptionRevision !== 0) {
    throw new ConflictException("新空间配置缺少本次创建对象与原事务");
  }
  const scope = { transaction, workspace: Object.freeze({ ...workspace }), identity: getRequestIdentity(), active: true, claimed: false };
  return createdWorkspaceConfiguration.run(scope, async () => {
    try { return await consume(); }
    finally { scope.active = false; }
  });
}

/** Reject escaped, nested and different-transaction consumers. Ordinary configuration
 * retains its session scope when no original creation callback has selected a target. */
export function readCreatedRentalWorkspaceConfiguration(transaction: RentalWorkspaceScopeClient, tenantId: string) {
  const scope = createdWorkspaceConfiguration.getStore();
  if (!scope) return undefined;
  if (!scope.active || transaction !== scope.transaction || tenantId !== scope.workspace.tenantId
    || getRequestIdentity() !== scope.identity) {
    throw new ForbiddenException("新空间配置目标、原事务或请求身份已变化");
  }
  return scope.workspace;
}

export function claimCreatedRentalWorkspaceConfiguration(
  transaction: RentalWorkspaceScopeClient, tenantId: string, workspaceId: string, categoryCode: string
) {
  const workspace = readCreatedRentalWorkspaceConfiguration(transaction, tenantId);
  const scope = createdWorkspaceConfiguration.getStore();
  if (!workspace || !scope || scope.claimed || workspace.id !== workspaceId
    || workspace.categoryCode.toLowerCase() !== categoryCode.toLowerCase()) {
    throw new ConflictException("经营空间配置只能由本次创建事务初始化一次");
  }
  scope.claimed = true;
  return workspace;
}

/**
 * 配置写入的第二道边界：`upsert` 的唯一键通常只有全局 id，
 * 不能因为 id 命中就把另一租户/空间的记录更新成当前请求的数据。
 */
export function assertScopedWrite(
  existing: { tenantId: string; workspaceId: string } | null,
  tenantId: string,
  workspaceId: string,
  label: string
) {
  if (existing && (existing.tenantId !== tenantId || existing.workspaceId !== workspaceId)) {
    throw new ConflictException(`${label}已属于其他租户或经营空间，拒绝覆盖`);
  }
}

/** 新空间配置读取原创建事务的目标，其他经营事实使用Auth/ALS空间并核对租户。
 * 无会话的初始化/恢复只读取原default标记。
 * 原Guard须先拒绝缺少范围的业务请求，这个解析函数不能用于补授权。
 * 缺少默认空间明确拒绝，不创建或猜测空间。 */
export async function resolveScopeWorkspaceId(
  client: RentalWorkspaceScopeClient,
  tenantId: string
): Promise<string> {
  const created = readCreatedRentalWorkspaceConfiguration(client, tenantId);
  const fromSession = created?.id ?? getRequestWorkspaceId();
  if (fromSession) {
    // 会话空间来自认证上下文，但调用方仍可能带着另一个 tenantId 进入
    // 内部服务。不能只信任 workspaceId 本身，否则一个跨租户的内部调用
    // 会把当前空间当成目标租户的空间继续写入。
    const current = await client.businessWorkspace.findFirst({
      where: { id: fromSession, tenantId },
      select: { id: true }
    });
    if (!current) {
      throw new ForbiddenException("当前经营空间不属于目标租户，拒绝访问");
    }
    return current.id;
  }
  const fallback = await client.businessWorkspace.findFirst({
    where: { tenantId, defaultMarker: "default" },
    select: { id: true }
  });
  if (!fallback) {
    throw new ForbiddenException(`租户 ${tenantId} 没有默认经营空间，拒绝访问经营事实`);
  }
  return fallback.id;
}
