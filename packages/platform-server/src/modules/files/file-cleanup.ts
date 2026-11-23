/** 原每租户文件删除和清理内核，无定时器、租户发现或新的任务执行者。
 * delete_queued只记录尚未派发的意图，确认占用后DELETE一次。旧pending及失应答只HEAD原键。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FileUploadCleanupSummary } from "@rental-os/platform-contracts/files";
import { fileStorageLocationHash, frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import { safeObjectPrefix } from "../integrations/object-storage.provider.service";
import type { StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

type AssetFilter = {
  id?: string | { gt: string };
  tenantId?: string;
  status?: string | { in: string[] };
  uploadScene?: string | { not: string };
  updatedAt?: Date | { gt: Date };
  storageKey?: string;
  storageProvider?: string;
  AND?: AssetFilter[];
  OR?: AssetFilter[];
};
type SessionFilter = {
  id?: string | { gt: string };
  tenantId?: string;
  status?: string;
  expiresAt?: Date | { lte: Date } | { gt: Date };
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
  AND?: SessionFilter[];
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
    findMany(query: { where: AssetFilter & { tenantId: string };
      orderBy: { updatedAt: "asc" } | Array<{ updatedAt?: "asc"; id?: "asc" }>; take: number }): PromiseLike<StoredFileAsset[]>;
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
  /** Stable host-owned lifetime when store wrappers are recreated. This scopes
   * candidate positions only; every object still needs its original authority. */
  schedulingScope?: object;
  /** The original algorithm supplies the exact persisted target. Hosts can fence
   * new cleanup work without re-admitting a result already sent to storage. */
  transaction<T>(work: (transaction: Transaction) => Promise<T>, boundary: FileCleanupBoundary): Promise<T>;
  /** Optional exact-receipt transaction for hosts with additional snapshot locks.
   * Existing public hosts retain their original result CAS without new admission. */
  resultTransaction?<T>(work: (transaction: FileCleanupTransaction) => Promise<T>, boundary: FileCleanupBoundary): Promise<T>;
  runtimeConfig(tenantId: string, provider: string): Promise<TenantIntegrationRuntimeConfig | undefined>;
  /** 所属宿主显式提供原保留场景；公共框架没有Rental场景枚举。 */
  excludedUploadScene: string | undefined;
  deleteObject(config: TenantIntegrationRuntimeConfig, storageKey: string, at: Date): Promise<boolean>;
  presign(config: TenantIntegrationRuntimeConfig, method: "DELETE" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date): {
    url: string;
    headers: Record<string, string>;
  };
  objectRequest(url: string, init: RequestInit): Promise<Response>;
  /** A short host transaction immediately before transport; never holds locks
   * across DELETE/HEAD. This hook does not grant permission to retry DELETE. */
  beforeObjectRequest?(boundary: FileCleanupBoundary, request: {
    method: "DELETE" | "HEAD"; config: TenantIntegrationRuntimeConfig; storageKey: string;
  }): Promise<void>;
  recordAudit?(input: { tenantId: string; action: string; targetType: string; detail: string; metadata: Record<string, number> }): Promise<unknown>;
}

export type FileCleanupTarget =
  | { operation: "expired_upload" | "completed_staging"; asset: StoredFileAsset; session: StoredFileUploadSession }
  | { operation: "pending_delete"; asset: StoredFileAsset; session?: never };
export type FileCleanupBoundary = FileCleanupTarget & {
  /** claim/observe establish this invocation's original receipt; prepare only
   * advances that same claim. result never authorizes a new external effect. */
  phase: "claim" | "observe" | "prepare" | "result";
};

export const COMPLETED_STAGING_PENDING = "completed_staging_pending";
export const COMPLETED_STAGING_UNKNOWN = "completed_staging_unknown";
type JsonRecord = Record<string, unknown>;
type ExpiredUpload = { asset: StoredFileAsset; session: StoredFileUploadSession };
type CleanupPosition = { at: Date; id: string };
type CleanupSchedule = { after?: CleanupPosition };
const cleanupPositions = new WeakMap<object, Map<string, CleanupSchedule>>();
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

  private async cleanupBatch<Row extends { id: string }>(tenantId: string, operation: FileCleanupTarget["operation"],
    limit: number, read: (after?: CleanupPosition) => PromiseLike<Row[]>, position: (row: Row) => Date): Promise<Row[]> {
    const scope = this.participants.schedulingScope ?? this.participants.store;
    let positions = cleanupPositions.get(scope);
    if (!positions) {
      positions = new Map();
      cleanupPositions.set(scope, positions);
    }
    const key = JSON.stringify([tenantId, operation, this.participants.excludedUploadScene ?? null]);
    const previous = positions.get(key);
    const after = previous?.after;
    let rows = structuredClone(await read(after));
    // A removed tail or an exhausted queue wraps on this call, still selecting
    // at most the original batch. Read failures leave the prior position intact.
    if (!rows.length && after) rows = structuredClone(await read());
    // A concurrent older selection must not overwrite another batch's progress.
    if (positions.get(key) === previous) {
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        positions.set(key, { after: { at: new Date(position(last).getTime()), id: last.id } });
      } else if (previous || rows.length) positions.set(key, {});
    }
    return rows;
  }

  private result<T>(work: (transaction: FileCleanupTransaction) => Promise<T>, boundary: FileCleanupBoundary) {
    return this.participants.resultTransaction?.(work, boundary) ?? work(this.participants.store);
  }

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
    const batchSize = Math.max(1, Math.min(limit, 100));
    const rows = await this.cleanupBatch(tenantId, "completed_staging", batchSize,
      after => this.participants.store.fileUploadSession.findMany({
        where: {
          tenantId, status: "completed", expiresAt: { lte: now },
          OR: [
            { cleanupError: COMPLETED_STAGING_PENDING },
            { cleanupError: COMPLETED_STAGING_UNKNOWN, lastCleanupAt: { lte: staleBefore } }
          ],
          AND: after ? [{ OR: [
            { expiresAt: { gt: after.at } }, { expiresAt: after.at, id: { gt: after.id } }
          ] }] : undefined
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: batchSize
      }), row => row.expiresAt);
    const summary: FileUploadCleanupSummary = { scanned: rows.length, invalidated: 0, deletedObjects: 0, cleanupPending: 0, sessionIds: [] };
    for (const row of rows) {
      try {
        const asset = await this.participants.store.fileAsset.findFirst({ where: { id: row.fileAssetId, tenantId } });
        const config = await this.participants.runtimeConfig(tenantId, row.provider);
        const metadata = asset?.metadata as JsonRecord | null;
        const staging = metadata?.stagingStorageKey;
        if (!asset || !config || row.provider === "local_mock" || config.provider !== row.provider
          || asset.storageProvider !== row.provider || asset.storageKey !== row.storageKey
          || !["active", "delete_queued", "delete_pending", "delete_in_progress", "deleted"].includes(asset.status)
          || !row.completedAt || typeof staging !== "string" || !frozenFileContentHash(asset, config)) {
          throw new ConflictException("已完成上传缺少原临时对象与存储位置依据，不能清理");
        }
        // Persist uncertainty before external DELETE. A lost claim acknowledgement
        // must not become a second DELETE; later owners only observe this key.
        const claimed = await this.participants.transaction(async tx => {
          const current = await tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } });
          if (!current || requestFingerprint(current) !== requestFingerprint(asset)) throw new ConflictException("原文件清理依据已变化");
          const changed = await tx.fileUploadSession.updateMany({ where: { id: row.id, tenantId, status: "completed",
            updatedAt: row.updatedAt, storageKey: row.storageKey, provider: row.provider, fileAssetId: asset.id,
            cleanupError: row.cleanupError, expiresAt: row.expiresAt, completedAt: row.completedAt },
            data: { cleanupError: COMPLETED_STAGING_UNKNOWN, cleanupAttempts: { increment: 1 }, lastCleanupAt: now } });
          if (changed.count !== 1) return;
          const sessions = await tx.fileUploadSession.findMany({ where: { id: row.id, tenantId }, orderBy: { expiresAt: "asc" }, take: 2 });
          if (sessions.length !== 1) throw changedUpload();
          return { asset: structuredClone(current), session: structuredClone(sessions[0]) };
        }, { operation: "completed_staging", phase: row.cleanupError === COMPLETED_STAGING_PENDING ? "claim" : "observe", asset, session: row });
        if (!claimed) continue;
        summary.sessionIds.push(row.id);
        const key = `${staging}.pending-upload`;
        const method = row.cleanupError === COMPLETED_STAGING_PENDING ? "DELETE" : "HEAD";
        const signed = this.participants.presign(config, method, key, "application/octet-stream", new Date(now.getTime() + 60_000));
        await this.participants.beforeObjectRequest?.({ operation: "completed_staging", phase: "prepare", ...claimed },
          { method, config, storageKey: key });
        const response = await this.participants.objectRequest(signed.url, { method, headers: signed.headers });
        const absent = method === "DELETE" ? response.ok || response.status === 404 : response.status === 404;
        if (!absent) throw new ServiceUnavailableException("原临时对象清理结果尚未证实");
        const recorded = await this.result(tx => Promise.resolve(tx.fileUploadSession.updateMany({ where: { id: row.id, tenantId, status: "completed",
          storageKey: row.storageKey, fileAssetId: asset.id, cleanupError: COMPLETED_STAGING_UNKNOWN,
          lastCleanupAt: now, updatedAt: claimed.session.updatedAt, provider: row.provider }, data: { cleanupError: null } })),
          { operation: "completed_staging", phase: "result", ...claimed });
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
    const batchSize = Math.max(1, Math.min(limit, 100));
    const rows = await this.cleanupBatch(tenantId, "expired_upload", batchSize,
      after => this.participants.store.fileUploadSession.findMany({
        where: {
          tenantId,
          expiresAt: { lte: now },
          fileAsset: { is: { ...this.reservedSceneFilter() } },
          OR: [
            { status: "pending_upload" },
            { status: "failed", cleanupError: { not: null } },
            { status: "cleanup_in_progress", lastCleanupAt: { lte: staleCleanupBefore } }
          ],
          AND: after ? [{ OR: [
            { expiresAt: { gt: after.at } }, { expiresAt: after.at, id: { gt: after.id } }
          ] }] : undefined
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize
      }), row => row.expiresAt);
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
        await this.participants.transaction(tx => this.replaceExpiredUpload(tx, before, claim),
          { operation: "expired_upload", phase: ownsDispatch ? "claim" : "observe", ...before });
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
            await this.participants.transaction(tx => this.replaceExpiredUpload(tx, claim, checked),
              { operation: "expired_upload", phase: "prepare", ...claim });
            claim = checked;
            const key = (asset.metadata as JsonRecord | null)?.fileUploadVersion === 2 ? `${row.storageKey}.pending-upload` : row.storageKey;
            await this.participants.beforeObjectRequest?.({ operation: "expired_upload", phase: "prepare", ...claim },
              { method: ownsDispatch ? "DELETE" : "HEAD", config, storageKey: key });
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
        await this.participants.transaction(tx => this.replaceExpiredUpload(tx, claim, result),
          { operation: "expired_upload", phase: "result", ...claim });
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

  /** 所属业务先授权原文件，排队提交失应答不会派发。恢复沿相同文件和提供者处理。 */
  async deleteFileAsset(tenantId: string, value: StoredFileAsset) {
    let asset = structuredClone(value);
    if (!tenantId || asset.tenantId !== tenantId || this.isReservedScene(asset.uploadScene)
      || !["active", "delete_queued", "delete_pending", "delete_in_progress", "deleted"].includes(asset.status)) {
      throw new ConflictException("原删除文件或当前业务依据不可用");
    }
    if (asset.status === "deleted") return { fileAssetId: asset.id, status: "deleted" as const };
    if (asset.status === "active") {
      const original = asset;
      asset = await this.participants.transaction(async tx => {
        const queued = await tx.fileAsset.updateMany({
          where: { id: original.id, tenantId, status: "active", updatedAt: original.updatedAt,
            storageKey: original.storageKey, storageProvider: original.storageProvider, uploadScene: original.uploadScene },
          data: { status: "delete_queued", updatedAt: nextVersion(original.updatedAt, new Date()) }
        });
        if (queued.count !== 1) throw changedUpload();
        const current = await tx.fileAsset.findFirst({ where: { id: original.id, tenantId } });
        if (!current || current.status !== "delete_queued"
          || cleanupSnapshotHash({ ...current, status: original.status, updatedAt: original.updatedAt }) !== cleanupSnapshotHash(original)) {
          throw changedUpload();
        }
        return structuredClone(current);
      }, { operation: "pending_delete", phase: "claim", asset: original });
    }
    const result = await this.deleteFileAssets(tenantId, [asset]);
    if (result.deleted !== 1) throw new ServiceUnavailableException("原文件删除结果尚未证实，请核对原文件");
    return { fileAssetId: asset.id, status: "deleted" as const };
  }

  async cleanupPendingFileAssetDeletes(tenantId: string, limit = 50) {
    if (!tenantId) throw new ConflictException("文件清理缺少当前租户");
    const batchSize = Math.max(1, Math.min(limit, 100));
    const rows = await this.cleanupBatch(tenantId, "pending_delete", batchSize,
      after => this.participants.store.fileAsset.findMany({
        where: {
          tenantId, status: { in: ["delete_queued", "delete_pending", "delete_in_progress"] }, ...this.reservedSceneFilter(),
          AND: after ? [{ OR: [
            { updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }
          ] }] : undefined
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: batchSize
      }), row => row.updatedAt);
    const result = await this.deleteFileAssets(tenantId, rows);
    if (result.deleted || result.pending) {
      await this.participants.recordAudit?.({ tenantId, action: "file.delete.cleanup", targetType: "file",
        detail: "核对待删除业务文件", metadata: result });
    }
    return result;
  }

  private async deleteFileAssets(tenantId: string, rows: StoredFileAsset[]) {
    let deleted = 0;
    let pending = 0;
    for (const row of rows) {
      if (this.isReservedScene(row.uploadScene)) continue;
      // 旧delete_pending混合了未派发与失应答来源，不能据状态或缺日志取得DELETE权。
      const ownsDispatch = row.status === "delete_queued";
      let claim: StoredFileAsset | undefined;
      try { claim = ownsDispatch ? await this.participants.transaction(async tx => {
        const claimed = await tx.fileAsset.updateMany({
          where: { id: row.id, tenantId, status: "delete_queued", updatedAt: row.updatedAt,
            storageKey: row.storageKey, storageProvider: row.storageProvider, uploadScene: row.uploadScene },
          data: { status: "delete_in_progress", updatedAt: nextVersion(row.updatedAt, new Date()) }
        });
        if (claimed.count !== 1) return;
        const current = await tx.fileAsset.findFirst({ where: { id: row.id, tenantId } });
        if (!current || current.status !== "delete_in_progress"
          || cleanupSnapshotHash({ ...current, status: row.status, updatedAt: row.updatedAt }) !== cleanupSnapshotHash(row))
          throw new ConflictException("原文件删除占用依据已变化");
        return structuredClone(current);
      }, { operation: "pending_delete", phase: "claim", asset: row }) : await this.participants.transaction(async tx => {
        const current = await tx.fileAsset.findFirst({ where: { id: row.id, tenantId } });
        if (!current || cleanupSnapshotHash(current) !== cleanupSnapshotHash(row)) throw changedUpload();
        return structuredClone(current);
      }, { operation: "pending_delete", phase: "observe", asset: row }); }
      catch { pending += 1; continue; }
      if (!claim) continue;
      const receipt = { id: claim.id, tenantId, status: claim.status, updatedAt: claim.updatedAt,
        storageKey: claim.storageKey, storageProvider: claim.storageProvider, uploadScene: claim.uploadScene };
      let dispatched = false;
      try {
        if (claim.storageProvider !== "local_mock") {
          const config = await this.participants.runtimeConfig(tenantId, claim.storageProvider);
          if (!config || config.provider !== claim.storageProvider) throw new ServiceUnavailableException("原文件对象存储配置不可用");
          let absent: boolean;
          if (ownsDispatch) {
            // 只有确认提交本次排队占用的调用方能派发，Boolean失败不证明请求未执行。
            await this.participants.beforeObjectRequest?.({ operation: "pending_delete", phase: "prepare", asset: claim },
              { method: "DELETE", config, storageKey: claim.storageKey });
            dispatched = true;
            absent = await this.participants.deleteObject(config, claim.storageKey, new Date());
          } else {
            // 同时运行、重启和超时都不能取得第二次DELETE权，只观察原提供方和原对象键。
            const at = new Date();
            const signed = this.participants.presign(config, "HEAD", claim.storageKey, claim.mimeType, new Date(at.getTime() + 60_000));
            await this.participants.beforeObjectRequest?.({ operation: "pending_delete", phase: "observe", asset: claim },
              { method: "HEAD", config, storageKey: claim.storageKey });
            const response = await this.participants.objectRequest(signed.url, { method: "HEAD", headers: signed.headers });
            absent = response.status === 404;
          }
          if (!absent) throw new ServiceUnavailableException("原文件删除结果尚未证实");
        }
        const recorded = await this.result(tx => Promise.resolve(tx.fileAsset.updateMany({ where: receipt, data: { status: "deleted" } })),
          { operation: "pending_delete", phase: "result", asset: claim });
        deleted += recorded.count;
      } catch {
        // 配置读取等派发前失败可释放本占用；开始DELETE或仅观察原结果后始终保留unknown。
        if (ownsDispatch && !dispatched) {
          try {
            await this.result(tx => Promise.resolve(tx.fileAsset.updateMany({ where: receipt, data: { status: "delete_queued" } })),
              { operation: "pending_delete", phase: "result", asset: claim });
          } catch { /* A conflicting/lost release stays an original pending observation, never a fresh DELETE. */ }
        }
        pending += 1;
      }
    }
    return { scanned: rows.length, deleted, pending };
  }
}
