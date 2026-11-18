/** 原AI附件清理参加者，沿当前授权回调、原政策和原收据裁定物理删除与同事务确认。
 * 失应答保持原对象和unknown收据，恢复仅核对原对象缺失证据。 */
import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FileStoragePrimitives } from "@rental-os/platform-server/files";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import { fetchObjectStorageWithTimeout as fetchWithTimeout } from "@rental-os/platform-server/object-storage";
import type { TenantIntegrationService, TenantIntegrationRuntimeConfig } from "@rental-os/platform-server/tenant-integration";
import { aiRetentionObjectHash } from "../ai-native/privacy/retention-binding";
import { AI_RETENTION_POLICY } from "../ai-native/privacy/retention-policy";

type JsonRecord = Record<string, unknown>;
type FileAiRetentionStorage = Pick<PrismaClient, "aiDataErasure" | "fileAsset" | "$transaction">;

interface FileAiRetentionObjectPorts {
  presign: FileStoragePrimitives["presign"];
  deleteObject: FileStoragePrimitives["deleteObject"];
}

export class FileAiRetentionParticipant {
  constructor(private readonly prisma: FileAiRetentionStorage,
    private readonly integrations: Pick<TenantIntegrationService, "runtimeConfig">,
    private readonly storage: FileAiRetentionObjectPorts) {}


  /** Privacy-only fixed original object, never the generic business delete.
   * The current authorized service supplies a private recheck callback, not an
   * HTTP function or a caller claim. Unknown DELETE is observed by HEAD only.
   */
  async eraseAiRetentionObject(tenantId: string, workspaceId: string, receiptId: string, recheck: () => Promise<void>) {
    await recheck();
    const receipt = await this.prisma.aiDataErasure.findFirst({ where: { id: receiptId, tenantId, workspaceId,
      kind: 'attachment', policyVersion: AI_RETENTION_POLICY.version } });
    if (!receipt) throw new NotFoundException('清理收据不可用');
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: receipt.resourceId, tenantId,
      businessModule: 'ai-native', businessType: 'ai_knowledge_document',
      status: { in: ['ai_erasure_pending', 'deleted'] }, metadata: { path: '$.workspaceId', equals: workspaceId } } });
    if (!asset || aiRetentionObjectHash(asset) !== receipt.targetHash) throw new ConflictException('清理对象已变化');
    if (receipt.state === 'erased' && asset.status === 'deleted') return { id: receiptId, state: 'erased', replayed: true };
    if (!['prepared', 'deleting', 'unknown'].includes(receipt.state)) throw new ConflictException('清理状态不允许执行');
    if (asset.storageProvider === 'local_mock') return { id: receiptId, state: 'unavailable', reason: 'mock_storage_has_no_physical_erasure_evidence' };
    let deleting = false, claimAttempted = false;
    try {
      const config = await this.integrations.runtimeConfig('file', tenantId, asset.storageProvider as never, { requireLiveTest: false });
      if (!config) throw new ServiceUnavailableException('文件存储清理依赖不可用');
      const locationHash = (asset.metadata as JsonRecord | null)?.storageLocationHash;
      if (typeof locationHash !== 'string' || locationHash !== this.retentionLocationHash(config)) {
        return { id: receiptId, state: 'unavailable', reason: 'original_storage_location_not_proved' };
      }
      await recheck();
      const current = await this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId, status: 'ai_erasure_pending' } });
      if (!current || aiRetentionObjectHash(current) !== receipt.targetHash) throw new ConflictException('清理对象已变化');
      let confirmed = false;
      if (receipt.state === 'prepared') {
        // Exactly one owner may send DELETE. A lost claim acknowledgement does
        // not grant permission to send; a subsequent call only checks absence.
        claimAttempted = true;
        const claim = await this.prisma.aiDataErasure.updateMany({ where: { id: receiptId, tenantId, workspaceId,
          state: 'prepared', revision: receipt.revision }, data: { state: 'deleting', revision: { increment: 1 } } });
        if (claim.count !== 1) return { id: receiptId, state: 'unknown', retryable: false };
        deleting = true;
        await recheck();
        confirmed = await this.storage.deleteObject(config, asset.storageKey, new Date());
      } else {
        const signed = this.storage.presign(config, 'HEAD', asset.storageKey, asset.mimeType, new Date(Date.now() + 60000));
        const response = await fetchWithTimeout(signed.url, { method: 'HEAD', headers: signed.headers });
        confirmed = response.status === 404; // 403/timeouts/200 never prove erasure.
      }
      if (!confirmed) throw new ServiceUnavailableException('原对象删除尚未证实');
      await recheck();
      await this.prisma.$transaction(async tx => {
        const changed = await tx.fileAsset.updateMany({ where: { id: asset.id, tenantId,
          storageKey: asset.storageKey, checksum: asset.checksum, status: 'ai_erasure_pending' },
          data: { status: 'deleted', publicUrl: null, fileName: '[已删除]', metadata: { workspaceId, retentionReceiptId: receiptId, storageLocationHash: locationHash } } });
        if (changed.count !== 1) throw new ConflictException('清理对象已变化');
        const committed = await tx.aiDataErasure.updateMany({ where: { id: receiptId, tenantId, workspaceId,
          targetHash: receipt.targetHash, state: { in: ['deleting', 'unknown'] } },
          data: { state: 'erased', erasedAt: new Date(), revision: { increment: 1 } } });
        if (committed.count !== 1) throw new ConflictException('清理收据已变化');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      return { id: receiptId, state: 'erased', replayed: receipt.state !== 'prepared' };
    } catch {
      // Unknown is durable. It never enters generic delete_pending retry work.
      if (deleting) await this.prisma.aiDataErasure.updateMany({ where: { id: receiptId, tenantId, workspaceId,
        state: 'deleting' }, data: { state: 'unknown', revision: { increment: 1 } } }).catch(() => undefined);
      return !claimAttempted && receipt.state === 'prepared'
        ? { id: receiptId, state: 'unavailable', retryable: false, reason: 'storage_dependency_unavailable' }
        : { id: receiptId, state: 'unknown', retryable: false, nextAction: 'observe_original_object_absence' };
    }
  }


  private retentionLocationHash(config: TenantIntegrationRuntimeConfig) {
    return fileStorageLocationHash(config);
  }
}
