/** 原每租户文件清理内核，无定时器、租户发现或新的任务执行者。
 * DELETE前持久占用，失应答后仅HEAD原键；冻结中的原操作保持不变。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FileUploadCleanupSummary } from "@rental-os/platform-contracts/files";
import { fileStorageLocationHash, frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import { safeObjectPrefix } from "../integrations/object-storage.provider.service";
import type { StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

type AssetFilter = {
  id?: string;
  tenantId?: string;
  status?: string | { in: string[] };
  uploadScene?: string | { not: string };
  updatedAt?: Date;
  storageKey?: string;
  storageProvider?: string;
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
  cleanupAttempts?: number;
  failureReason?: string | null;
  idempotencyKey?: string | null;
  createdAt?: Date;
  lastCleanupAt?: Date | null | { lte: Date };
  fileAsset?: { is: { uploadScene?: { not: string } } };
  OR?: SessionFilter[];
};
type SessionWrite = {
  status?: string;
  failureReason?: string | null;
  cleanupError?: string | null;
  cleanupAttempts?: { increment: number };
  lastCleanupAt?: Date | null;
  updatedAt?: Date;
};

export interface FileCleanupTransaction {
  fileAsset: {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<StoredFileAsset | null>;
    findMany(query: { where: AssetFilter & { tenantId: string }; orderBy: { updatedAt: "asc" }; take: number }): PromiseLike<StoredFileAsset[]>;
    updateMany(query: { where: AssetFilter & { tenantId: string }; data: { status: string; updatedAt?: Date } }): PromiseLike<{ count: number }>;
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
type ExpiredUpload = { asset: StoredFileAsset; session: StoredFileUploadSession };
const expiredUnknown = "expired_upload_unknown:1:";
const changedUpload = () => new ConflictException("原过期上传清理依据已变化，只能核对原会话");
const uploadConfigHash = (config: TenantIntegrationRuntimeConfig) => requestFingerprint({
  id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials
});
// The original 500-character receipt field stores only a nonce and digest.
// Bind the complete versions, not provider errors, credentials or signed URLs.
// Serialize Dates before the original JSON-key normalizer, which otherwise
// treats Date objects as empty records and would lose version/expiry evidence.
const cleanupSnapshotHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const expiredReceiptHash = ({ asset, session }: ExpiredUpload, configHash: string) =>
  cleanupSnapshotHash({ asset, session: { ...session, cleanupError: null }, configHash });
const expiredReceipt = (snapshot: ExpiredUpload, configHash: string) =>
  `${expiredUnknown}${randomUUID()}:${expiredReceiptHash(snapshot, configHash)}`;
const nextVersion = (version: Date, at: Date) => new Date(Math.max(version.getTime() + 1, at.getTime()));


export class FileStorageCleanup<Transaction extends FileCleanupTransaction> {
  constructor(private readonly participants: FileCleanupParticipants<Transaction>) {}

  private reservedSceneFilter(): { uploadScene?: { not: string } } {
    return this.participants.excludedUploadScene ? { uploadScene: { not: this.participants.excludedUploadScene } } : {};
  }

  private isReservedScene(scene: string | undefined) {
    return Boolean(this.participants.excludedUploadScene && scene === this.participants.excludedUploadScene);
  }

  /** Session -> asset matches the original freeze/completion lock order.
   * Each CAS advances both versions, including same-millisecond attempts, so
   * ownership never depends on MySQL's affected-row count for a no-op update.
   * A mismatch rolls both writes back through the host's original transaction. */
  private async replaceExpiredUpload(tx: Transaction, before: ExpiredUpload, after: ExpiredUpload) {
    const session = before.session, asset = before.asset;
    const claimed = await tx.fileUploadSession.updateMany({ where: { ...session }, data: {
      status: after.session.status, failureReason: after.session.failureReason, cleanupError: after.session.cleanupError,
      cleanupAttempts: { increment: after.session.cleanupAttempts - session.cleanupAttempts },
      lastCleanupAt: after.session.lastCleanupAt, updatedAt: after.session.updatedAt
    } });
    if (claimed.count !== 1) throw changedUpload();
    const locked = await tx.fileAsset.updateMany({ where: { id: asset.id, tenantId: asset.tenantId, status: asset.status,
      updatedAt: asset.updatedAt, storageKey: asset.storageKey, storageProvider: asset.storageProvider, uploadScene: asset.uploadScene },
      data: { status: after.asset.status, updatedAt: after.asset.updatedAt } });
    if (locked.count !== 1) throw changedUpload();
    const currentAsset = await tx.fileAsset.findFirst({ where: { id: asset.id, tenantId: asset.tenantId } });
    const currentSessions = await tx.fileUploadSession.findMany({ where: { id: session.id, tenantId: session.tenantId },
      orderBy: { expiresAt: "asc" }, take: 2 });
    if (currentSessions.length !== 1 || cleanupSnapshotHash(currentAsset) !== cleanupSnapshotHash(after.asset)
      || cleanupSnapshotHash(currentSessions[0]) !== cleanupSnapshotHash(after.session)) throw changedUpload();
  }

  private async expiredUploadConfig(snapshot: ExpiredUpload) {
    const { asset, session } = snapshot;
    if (session.tenantId !== asset.tenantId || session.fileAssetId !== asset.id || session.provider !== asset.storageProvider
      || session.storageKey !== asset.storageKey || session.completedAt !== null
      || !["pending_upload", "failed"].includes(asset.status) || this.isReservedScene(asset.uploadScene)) throw changedUpload();
    if (session.provider === "local_mock") return;
    const config = structuredClone(await this.participants.runtimeConfig(session.tenantId, session.provider));
    const metadata = asset.metadata as JsonRecord | null;
    // Old rows without their original configuration cannot identify a safe
    // destination. They remain pending; cleanup never certifies new metadata.
    if (!config || config.provider !== session.provider || !metadata
      || metadata.storageLocationHash !== fileStorageLocationHash(config)
      || metadata.uploadConfigHash !== uploadConfigHash(config)
      || metadata.fileContentVersion !== undefined || metadata.stagingStorageKey !== undefined) throw changedUpload();
    const prefix = safeObjectPrefix(config.settings.objectPrefix ?? "tenant-files");
    const suffix = metadata.fileUploadVersion === 2 ? "blob"
      : asset.fileName.trim().replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 180) || "file";
    if (metadata.fileUploadVersion !== undefined && metadata.fileUploadVersion !== 2
      || session.storageKey !== `${prefix ? `${prefix}/` : ""}${asset.tenantId}/${asset.id}/${suffix}`) throw changedUpload();
    return config;
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
    const rows = structuredClone(await this.participants.store.fileUploadSession.findMany({
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
    }));
    let invalidated = 0;
    let deletedObjects = 0;
    let cleanupPending = 0;
    const sessionIds: string[] = [];
    for (const row of rows) {
      try {
        const asset = structuredClone(await this.participants.store.fileAsset.findFirst({ where: { id: row.fileAssetId, tenantId } }));
        if (this.isReservedScene(asset?.uploadScene)) continue;
        if (!asset || row.tenantId !== tenantId || row.expiresAt > now || !Number.isSafeInteger(row.cleanupAttempts)
          || row.cleanupAttempts < 0 || row.cleanupAttempts >= 2147483647) throw changedUpload();
        const before: ExpiredUpload = { asset, session: row }, config = await this.expiredUploadConfig(before);
        const configHash = config ? cleanupSnapshotHash(config) : "local_mock";
        if (row.cleanupError?.startsWith(expiredUnknown)
          && (!/^expired_upload_unknown:1:[a-f0-9-]{36}:[a-f0-9]{64}$/u.test(row.cleanupError)
            || row.cleanupError.slice(-64) !== expiredReceiptHash(before, configHash))) throw changedUpload();
        // Only a pristine pending row authorizes one DELETE. Every prior
        // attempt, including legacy arbitrary errors and expired claims, is
        // unknown. Neither a TTL nor HEAD 200 can authorize another DELETE.
        const ownsDispatch = row.status === "pending_upload" && row.cleanupError === null
          && row.cleanupAttempts === 0 && row.lastCleanupAt === null;
        let claim: ExpiredUpload = { asset: { ...asset, updatedAt: nextVersion(asset.updatedAt, now) },
          session: { ...row, status: "cleanup_in_progress", cleanupAttempts: row.cleanupAttempts + 1,
            lastCleanupAt: now, updatedAt: nextVersion(row.updatedAt, now) } };
        claim.session.cleanupError = expiredReceipt(claim, configHash);
        await this.participants.transaction(tx => this.replaceExpiredUpload(tx, before, claim));
        sessionIds.push(row.id);
        let deleted = row.provider === "local_mock";
        try {
          if (config) {
            const currentConfig = await this.expiredUploadConfig(claim);
            if (!currentConfig || cleanupSnapshotHash(currentConfig) !== configHash) throw changedUpload();
            const checkedAt = new Date(), checked: ExpiredUpload = {
              asset: { ...claim.asset, updatedAt: nextVersion(claim.asset.updatedAt, checkedAt) },
              session: { ...claim.session, updatedAt: nextVersion(claim.session.updatedAt, checkedAt) }
            };
            checked.session.cleanupError = expiredReceipt(checked, configHash);
            await this.participants.transaction(tx => this.replaceExpiredUpload(tx, claim, checked));
            claim = checked;
            const key = (asset.metadata as JsonRecord | null)?.fileUploadVersion === 2 ? `${row.storageKey}.pending-upload` : row.storageKey;
            if (ownsDispatch) deleted = await this.participants.deleteObject(config, key, now);
            else {
              const signed = this.participants.presign(config, "HEAD", key, asset.mimeType, new Date(Date.now() + 60_000));
              const response = await this.participants.objectRequest(signed.url, { method: "HEAD", headers: signed.headers });
              deleted = response.status === 404;
            }
          }
        } catch { /* The original claim remains unknown; never persist a provider error. */ }
        const at = new Date();
        const result: ExpiredUpload = { asset: { ...claim.asset, status: "failed", updatedAt: nextVersion(claim.asset.updatedAt, at) },
          session: { ...claim.session, status: "failed", failureReason: "上传会话已过期",
            updatedAt: nextVersion(claim.session.updatedAt, at), cleanupError: null } };
        if (!deleted) result.session.cleanupError = expiredReceipt(result, configHash);
        await this.participants.transaction(tx => this.replaceExpiredUpload(tx, claim, result));
        invalidated += 1;
        if (deleted) deletedObjects += 1;
        else cleanupPending += 1;
      } catch {
        // A lost COMMIT acknowledgement never grants dispatch or a new receipt.
        // Snapshot conflicts leave the other writer's session and asset intact.
        cleanupPending += 1;
      }
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
    const rows = structuredClone(await this.participants.store.fileAsset.findMany({
      where: { tenantId, status: { in: ["delete_pending", "delete_in_progress"] }, ...this.reservedSceneFilter() },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.min(limit, 100))
    }));
    let deleted = 0;
    let pending = 0;
    for (const row of rows) {
      if (this.isReservedScene(row.uploadScene)) continue;
      const ownsDispatch = row.status === "delete_pending";
      const claim = ownsDispatch ? await this.participants.transaction(async tx => {
        const claimed = await tx.fileAsset.updateMany({
          where: { id: row.id, tenantId, status: "delete_pending", updatedAt: row.updatedAt,
            storageKey: row.storageKey, storageProvider: row.storageProvider, uploadScene: row.uploadScene },
          data: { status: "delete_in_progress" }
        });
        if (claimed.count !== 1) return;
        const current = await tx.fileAsset.findFirst({ where: { id: row.id, tenantId } });
        if (!current || current.status !== "delete_in_progress"
          || requestFingerprint({ ...current, status: row.status, updatedAt: row.updatedAt }) !== requestFingerprint(row))
          throw new ConflictException("原文件删除占用依据已变化");
        return structuredClone(current);
      }) : row;
      if (!claim) continue;
      const receipt = { id: claim.id, tenantId, status: "delete_in_progress", updatedAt: claim.updatedAt,
        storageKey: claim.storageKey, storageProvider: claim.storageProvider, uploadScene: claim.uploadScene };
      let dispatched = false;
      try {
        if (claim.storageProvider !== "local_mock") {
          const config = await this.participants.runtimeConfig(tenantId, claim.storageProvider);
          if (!config || config.provider !== claim.storageProvider) throw new ServiceUnavailableException("原文件对象存储配置不可用");
          let absent: boolean;
          if (ownsDispatch) {
            // 只有确认提交本次pending占用的调用方能派发；Boolean失败不证明请求未执行。
            dispatched = true;
            absent = await this.participants.deleteObject(config, claim.storageKey, new Date());
          } else {
            // 同时运行、重启和超时都不能取得第二次DELETE权，只观察原提供方和原对象键。
            const at = new Date();
            const signed = this.participants.presign(config, "HEAD", claim.storageKey, claim.mimeType, new Date(at.getTime() + 60_000));
            const response = await this.participants.objectRequest(signed.url, { method: "HEAD", headers: signed.headers });
            absent = response.status === 404;
          }
          if (!absent) throw new ServiceUnavailableException("原文件删除结果尚未证实");
        }
        const recorded = await this.participants.store.fileAsset.updateMany({ where: receipt, data: { status: "deleted" } });
        deleted += recorded.count;
      } catch {
        // 配置读取等派发前失败可释放本占用；开始DELETE或仅观察原结果后始终保留unknown。
        if (ownsDispatch && !dispatched)
          await this.participants.store.fileAsset.updateMany({ where: receipt, data: { status: "delete_pending" } });
        pending += 1;
      }
    }
    if (deleted || pending) {
      await this.participants.recordAudit?.({ tenantId, action: "file.delete.cleanup", targetType: "file", detail: "核对待删除业务文件", metadata: { scanned: rows.length, deleted, pending } });
    }
    return { scanned: rows.length, deleted, pending };
  }
}
