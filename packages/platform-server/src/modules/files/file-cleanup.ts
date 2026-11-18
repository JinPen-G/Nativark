/** 原每租户文件清理内核，无定时器、租户发现或新的任务执行者。
 * 完成暂存对象在DELETE前先持久unknown，失应答后仅HEAD原键；冻结中的原操作保持不变。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { FileUploadCleanupSummary } from "@rental-os/platform-contracts/files";
import { fileStorageLocationHash, frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

type AssetFilter = {
  id?: string;
  tenantId?: string;
  status?: string | { in: string[] };
  uploadScene?: { not: string };
};
type SessionFilter = {
  id?: string;
  tenantId?: string;
  status?: string;
  expiresAt?: Date | { lte: Date };
  completedAt?: Date | null;
  updatedAt?: Date;
  storageKey?: string;
  provider?: string;
  fileAssetId?: string;
  cleanupError?: string | null | { not: null };
  lastCleanupAt?: Date | { lte: Date };
  fileAsset?: { is: { uploadScene?: { not: string } } };
  OR?: SessionFilter[];
};
type SessionWrite = {
  status?: string;
  failureReason?: string;
  cleanupError?: string | null;
  cleanupAttempts?: { increment: number };
  lastCleanupAt?: Date;
};

export interface FileCleanupTransaction {
  fileAsset: {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<StoredFileAsset | null>;
    findMany(query: { where: AssetFilter & { tenantId: string }; orderBy: { updatedAt: "asc" }; take: number }): PromiseLike<StoredFileAsset[]>;
    updateMany(query: { where: AssetFilter & { tenantId: string }; data: { status: string } }): PromiseLike<{ count: number }>;
  };
  fileUploadSession: {
    findMany(query: { where: SessionFilter & { tenantId: string }; orderBy: { expiresAt: "asc" } | Array<{ expiresAt?: "asc"; id?: "asc" }>;
      take: number }): PromiseLike<StoredFileUploadSession[]>;
    updateMany(query: { where: SessionFilter & { tenantId: string }; data: SessionWrite }): PromiseLike<{ count: number }>;
    update(query: { where: { id: string }; data: SessionWrite }): PromiseLike<unknown>;
  };
}

export interface FileCleanupParticipants<Transaction extends FileCleanupTransaction> {
  store: FileCleanupTransaction;
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  runtimeConfig(tenantId: string, provider: string): Promise<TenantIntegrationRuntimeConfig | undefined>;
  /** 所属宿主显式提供原保留场景；公共框架没有Rental场景枚举。 */
  excludedUploadScene: string | undefined;
  deleteObject(config: TenantIntegrationRuntimeConfig, storageKey: string, at: Date): Promise<boolean>;
  presign(config: TenantIntegrationRuntimeConfig, method: "DELETE" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date): {
    url: string;
    headers: Record<string, string>;
  };
  objectRequest(url: string, init: RequestInit): Promise<Response>;
  recordAudit?(input: { tenantId: string; action: string; targetType: string; detail: string; metadata: Record<string, number> }): Promise<unknown>;
}

export const COMPLETED_STAGING_PENDING = "completed_staging_pending";
export const COMPLETED_STAGING_UNKNOWN = "completed_staging_unknown";
type JsonRecord = Record<string, unknown>;


export class FileStorageCleanup<Transaction extends FileCleanupTransaction> {
  constructor(private readonly participants: FileCleanupParticipants<Transaction>) {}

  private reservedSceneFilter(): { uploadScene?: { not: string } } {
    return this.participants.excludedUploadScene ? { uploadScene: { not: this.participants.excludedUploadScene } } : {};
  }

  private isReservedScene(scene: string | undefined) {
    return Boolean(this.participants.excludedUploadScene && scene === this.participants.excludedUploadScene);
  }

  async cleanupCompletedStagingObjects(tenantId: string, limit: number): Promise<FileUploadCleanupSummary> {
    if (!tenantId) throw new ConflictException("文件清理缺少当前租户");
    const now = new Date(), staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
    const rows = structuredClone(await this.participants.store.fileUploadSession.findMany({
      where: { tenantId, status: "completed", expiresAt: { lte: now }, OR: [
        { cleanupError: COMPLETED_STAGING_PENDING },
        { cleanupError: COMPLETED_STAGING_UNKNOWN, lastCleanupAt: { lte: staleBefore } }
      ] },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: Math.max(1, Math.min(limit, 100))
    }));
    const summary: FileUploadCleanupSummary = { scanned: rows.length, invalidated: 0, deletedObjects: 0, cleanupPending: 0, sessionIds: [] };
    for (const row of rows) {
      try {
        const asset = await this.participants.store.fileAsset.findFirst({ where: { id: row.fileAssetId, tenantId } });
        const config = await this.participants.runtimeConfig(tenantId, row.provider);
        const metadata = asset?.metadata as JsonRecord | null;
        const staging = metadata?.stagingStorageKey;
        if (!asset || !config || row.provider === "local_mock" || config.provider !== row.provider
          || asset.storageProvider !== row.provider || asset.storageKey !== row.storageKey
          || !["active", "delete_pending", "delete_in_progress", "deleted"].includes(asset.status)
          || !row.completedAt || typeof staging !== "string" || !frozenFileContentHash(asset, config)) {
          throw new ConflictException("已完成上传缺少原临时对象与存储位置依据，不能清理");
        }
        // Persist uncertainty before external DELETE. A lost claim acknowledgement
        // must not become a second DELETE; later owners only observe this key.
        const claimed = await this.participants.transaction(async tx => {
          const current = await tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } });
          if (requestFingerprint(current) !== requestFingerprint(asset)) throw new ConflictException("原文件清理依据已变化");
          return tx.fileUploadSession.updateMany({ where: { id: row.id, tenantId, status: "completed",
            updatedAt: row.updatedAt, storageKey: row.storageKey, provider: row.provider, fileAssetId: asset.id,
            cleanupError: row.cleanupError, expiresAt: row.expiresAt, completedAt: row.completedAt },
            data: { cleanupError: COMPLETED_STAGING_UNKNOWN, cleanupAttempts: { increment: 1 }, lastCleanupAt: now } });
        });
        if (claimed.count !== 1) continue;
        summary.sessionIds.push(row.id);
        const key = `${staging}.pending-upload`;
        const method = row.cleanupError === COMPLETED_STAGING_PENDING ? "DELETE" : "HEAD";
        const signed = this.participants.presign(config, method, key, "application/octet-stream", new Date(now.getTime() + 60_000));
        const response = await this.participants.objectRequest(signed.url, { method, headers: signed.headers });
        const absent = method === "DELETE" ? response.ok || response.status === 404 : response.status === 404;
        if (!absent) throw new ServiceUnavailableException("原临时对象清理结果尚未证实");
        const recorded = await this.participants.store.fileUploadSession.updateMany({ where: { id: row.id, tenantId, status: "completed",
          storageKey: row.storageKey, fileAssetId: asset.id, cleanupError: COMPLETED_STAGING_UNKNOWN,
          lastCleanupAt: now }, data: { cleanupError: null } });
        if (recorded.count !== 1) throw new ConflictException("原临时对象清理收据已变化");
        summary.deletedObjects += 1;
      } catch {
        // Do not overwrite the original marker with provider errors or credentials.
        // Missing evidence stays unavailable; uncertain deletion stays HEAD-only.
        summary.cleanupPending += 1;
      }
    }
    return summary;
  }

  async cleanupExpiredUploadSessions(tenantId: string, limit = 50): Promise<FileUploadCleanupSummary> {
    if (!tenantId) throw new ConflictException("文件清理缺少当前租户");
    const now = new Date();
    const staleCleanupBefore = new Date(now.getTime() - 10 * 60 * 1000);
    const rows = await this.participants.store.fileUploadSession.findMany({
      where: {
        tenantId,
        expiresAt: { lte: now },
        fileAsset: { is: { ...this.reservedSceneFilter() } },
        OR: [
          { status: "pending_upload" },
          { status: "failed", cleanupError: { not: null } },
          { status: "cleanup_in_progress", lastCleanupAt: { lte: staleCleanupBefore } }
        ]
      },
      orderBy: { expiresAt: "asc" },
      take: Math.max(1, Math.min(limit, 100))
    });
    let invalidated = 0;
    let deletedObjects = 0;
    let cleanupPending = 0;
    const sessionIds: string[] = [];
    for (const row of rows) {
      const source = await this.participants.store.fileAsset.findFirst({ where: { id: row.fileAssetId, tenantId } });
      if (this.isReservedScene(source?.uploadScene)) continue;
      const claimed = await this.participants.store.fileUploadSession.updateMany({
        where: {
          id: row.id,
          tenantId,
          fileAsset: { is: { ...this.reservedSceneFilter() } },
          OR: [
            { status: "pending_upload" },
            { status: "failed", cleanupError: { not: null } },
            { status: "cleanup_in_progress", lastCleanupAt: { lte: staleCleanupBefore } }
          ]
        },
        data: { status: "cleanup_in_progress", cleanupAttempts: { increment: 1 }, lastCleanupAt: now }
      });
      if (claimed.count !== 1) continue;
      sessionIds.push(row.id);
      let cleanupError: string | undefined;
      let deleted = row.provider === "local_mock";
      try {
        if (!deleted) {
          const config = await this.participants.runtimeConfig(tenantId, row.provider);
          if (!config) throw new ServiceUnavailableException("文件平台已停用，无法清理过期对象");
          const asset = await this.participants.store.fileAsset.findFirst({ where: { id: row.fileAssetId, tenantId } });
          const metadata = asset?.metadata as JsonRecord | null;
          const staged = metadata?.fileUploadVersion === 2;
          if (staged && metadata.storageLocationHash !== fileStorageLocationHash(config)) throw new ConflictException("原上传存储位置已变化，不能清理其他位置的对象");
          deleted = await this.participants.deleteObject(config, staged ? `${row.storageKey}.pending-upload` : row.storageKey, now);
          if (!deleted) throw new ServiceUnavailableException("对象存储未确认删除过期对象");
        }
      } catch (error) {
        cleanupError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      }
      await this.participants.transaction(async tx => {
        await tx.fileUploadSession.update({
          where: { id: row.id },
          data: { status: "failed", failureReason: "上传会话已过期", cleanupError: cleanupError ?? null }
        });
        await tx.fileAsset.updateMany({
          where: { id: row.fileAssetId, tenantId, status: "pending_upload" }, data: { status: "failed" }
        });
      });
      invalidated += 1;
      if (deleted) deletedObjects += 1;
      else cleanupPending += 1;
    }
    const completed = await this.cleanupCompletedStagingObjects(tenantId, limit);
    deletedObjects += completed.deletedObjects;
    cleanupPending += completed.cleanupPending;
    sessionIds.push(...completed.sessionIds);
    await this.participants.recordAudit?.({
      tenantId,
      action: "file.upload.cleanup-expired",
      targetType: "file-upload-session",
      detail: "清理过期文件上传会话",
      metadata: { scanned: rows.length + completed.scanned, invalidated, deletedObjects, cleanupPending }
    });
    return { scanned: rows.length + completed.scanned, invalidated, deletedObjects, cleanupPending, sessionIds };
  }

  async cleanupPendingFileAssetDeletes(tenantId: string, limit = 50) {
    if (!tenantId) throw new ConflictException("文件清理缺少当前租户");
    const rows = await this.participants.store.fileAsset.findMany({
      where: { tenantId, status: { in: ["delete_pending", "delete_in_progress"] }, ...this.reservedSceneFilter() },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.min(limit, 100))
    });
    let deleted = 0;
    let pending = 0;
    for (const row of rows) {
      if (this.isReservedScene(row.uploadScene)) continue;
      const claimed = await this.participants.store.fileAsset.updateMany({
        where: { id: row.id, tenantId, status: { in: ["delete_pending", "delete_in_progress"] }, ...this.reservedSceneFilter() },
        data: { status: "delete_in_progress" }
      });
      if (claimed.count !== 1) continue;
      try {
        if (row.storageProvider !== "local_mock") {
          const config = await this.participants.runtimeConfig(tenantId, row.storageProvider);
          if (!config || !(await this.participants.deleteObject(config, row.storageKey, new Date()))) throw new ServiceUnavailableException("对象存储未确认删除文件");
        }
        await this.participants.store.fileAsset.updateMany({ where: { id: row.id, tenantId, status: "delete_in_progress" }, data: { status: "deleted" } });
        deleted += 1;
      } catch {
        await this.participants.store.fileAsset.updateMany({ where: { id: row.id, tenantId, status: "delete_in_progress" }, data: { status: "delete_pending" } });
        pending += 1;
      }
    }
    if (deleted || pending) {
      await this.participants.recordAudit?.({ tenantId, action: "file.delete.cleanup", targetType: "file", detail: "重试待删除业务文件", metadata: { scanned: rows.length, deleted, pending } });
    }
    return { scanned: rows.length, deleted, pending };
  }
}
