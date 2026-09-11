import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { getRequestWorkspaceId } from "../../common/request-identity";

type AnyClient = {
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

export type WorkspaceScopeTx = Prisma.TransactionClient;

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

/**
 * SPACE-03：读写经营事实时使用的经营空间。
 *
 * 两条来源，优先级明确：
 *   1. **请求路径**取会话空间。会话空间由认证守卫从 `auth_sessions` 写入，
 *      客户端无法伪造；守卫已对经营域做过 fail-closed，因此走到这里时它必然存在。
 *   2. **无会话路径**取该租户的默认经营空间：seed、租户初始化、快照回填。
 *
 * 关于第 2 条与「默认空间回退」的区别——这点必须讲清楚，否则容易被误读成
 * 我在别处明确反对的那种危险回退：
 *   - 危险的那种发生在**鉴权**时：一个无空间的会话本该被拒绝，却因为回退到
 *     默认空间而拿到了数据（P0-01 的同型缺陷）。
 *   - 这里发生在**根本没有会话**的初始化/恢复路径上，不参与任何鉴权判断，
 *     且这些路径操作的正是升级兼容层本身（默认空间）。
 * 因此它不放宽任何访问控制：请求路径永远不会走到第 2 条。
 *
 * 找不到默认空间时**明确拒绝**，绝不写入一个猜测的空间 id——
 * 没有品类档案的租户（如平台管理租户）本就不该产生经营事实。
 */
export async function resolveScopeWorkspaceId(
  client: AnyClient,
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
