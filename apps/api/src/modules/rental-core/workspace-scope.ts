/** 原API空间边界再导出Rental唯一实现；事务别名只在这个宿主绑定生成类型。 */
import type { Prisma } from "@prisma/client";
export { assertScopedWrite, resolveScopeWorkspaceId } from "@rental-os/rental-core/mysql-workspace-scope";
export type WorkspaceScopeTx = Prisma.TransactionClient;
