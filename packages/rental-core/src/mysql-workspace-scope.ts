/** Rental经营事实的空间解析与跨空间写入边界。当前请求仍由原Guard/ALS授权；初始化/恢复只读原默认空间。
 * 不创建或猜测业务空间，也不把Rental默认空间作为其他Core的公共模型。 */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { getRequestWorkspaceId } from "@rental-os/platform-server/request-identity";

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

/** 经营事实优先使用Auth/ALS空间并核对租户；初始化/恢复只读取原default标记。
 * 原Guard须先拒绝缺少范围的业务请求，这个解析函数不能用于补授权。
 * 缺少默认空间明确拒绝，不创建或猜测空间。 */
export async function resolveScopeWorkspaceId(
  client: RentalWorkspaceScopeClient,
  tenantId: string
): Promise<string> {
  const fromSession = getRequestWorkspaceId();
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
