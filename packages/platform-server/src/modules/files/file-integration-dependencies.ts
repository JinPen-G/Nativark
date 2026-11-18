/** 文件平台停用/位置变更的原事实围栏。只读当前租户/提供者，复用调用方已锁配置的同一事务。
 * 空Core目录不证明文件或未知上传不存在，缺数据库证据时不允许配置变更。 */
import { ConflictException } from "@nestjs/common";
import { sqltag } from "@prisma/client/runtime/library";
import type { TenantIntegrationProvider } from "@rental-os/platform-contracts/tenant-integrations";
import type { TenantIntegrationTransaction } from "../integrations/integration-store";

export type FileIntegrationDependencyReader = Pick<TenantIntegrationTransaction, "$queryRaw">;
type DependencyRow = { id: string };

function requireFileProviderScope(tenantId: string, provider: string) {
  if (!tenantId?.trim() || !provider?.trim())
    throw new ConflictException("文件平台依赖核验缺少当前租户或提供者");
}

export async function assertFileProviderCanDisable(
  transaction: FileIntegrationDependencyReader,
  tenantId: string,
  provider: TenantIntegrationProvider
): Promise<void> {
  requireFileProviderScope(tenantId, provider);
  const [assets, sessions] = await Promise.all([
    transaction.$queryRaw<DependencyRow[]>(sqltag`
      SELECT id FROM \`FileAsset\`
       WHERE tenantId = ${tenantId} AND storageProvider = ${provider}
         AND status IN ('active', 'pending_upload', 'delete_pending', 'delete_in_progress')
       LIMIT 1`),
    transaction.$queryRaw<DependencyRow[]>(sqltag`
      SELECT id FROM file_upload_sessions
       WHERE tenantId = ${tenantId} AND provider = ${provider}
         AND (status IN ('pending_upload', 'freeze_pending', 'cleanup_in_progress') OR cleanupError IS NOT NULL)
       LIMIT 1`)
  ]);
  if (assets.length || sessions.length)
    throw new ConflictException("该文件平台仍有已存文件或待清理上传，请先完成迁移/清理后再停用");
}

export async function assertFileProviderIdentityChange(
  transaction: FileIntegrationDependencyReader,
  tenantId: string,
  provider: TenantIntegrationProvider
): Promise<void> {
  requireFileProviderScope(tenantId, provider);
  const assets = await transaction.$queryRaw<DependencyRow[]>(sqltag`
    SELECT id FROM \`FileAsset\`
     WHERE tenantId = ${tenantId} AND storageProvider = ${provider} AND status <> 'deleted'
     LIMIT 1`);
  if (assets.length)
    throw new ConflictException("原文件或上传仍依赖当前存储位置，不能原位更换；请先完成受控迁移/清理");
  const sessions = await transaction.$queryRaw<DependencyRow[]>(sqltag`
    SELECT id FROM file_upload_sessions
     WHERE tenantId = ${tenantId} AND provider = ${provider}
       AND (status IN ('pending_upload', 'freeze_pending', 'cleanup_in_progress') OR cleanupError IS NOT NULL)
     LIMIT 1`);
  if (sessions.length)
    throw new ConflictException("原文件或上传仍依赖当前存储位置，不能原位更换；请先完成受控迁移/清理");
}
