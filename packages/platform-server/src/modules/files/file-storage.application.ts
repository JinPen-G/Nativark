/** Core可消费的公共文件应用。按受控登记调用真实业务权威，沿原键创建/回读、一次冻结、同事务激活及清理。
 * 宿主供给原身份/业务参加者、配置锁、事务和审计；定时器与租户发现仍由唯一宿主维护。 */
import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import { FileStoragePrimitives } from "./file-storage-primitives";
import { FileStorageRepository } from "./file-storage.repository";
import type { FileStorageOwner, StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";
import { createOriginalFileUploadFacts } from "./file-upload-session";
import { readOriginalFileUploadReceipt } from "./file-upload-receipt";
import { freezeFileUploadContent } from "./file-content-freeze";
import { COMPLETED_STAGING_PENDING, FileStorageCleanup, type FileCleanupParticipants } from "./file-cleanup";
import { issueFileDownloadReference, type FileDownloadAudit } from "./file-download";
import type { FileStorageApplicationTransaction } from "./file-storage.application-store";
import type { FileStorageAuthority, FileStorageBinding, FileUploadAuthorityContext, FileCompletionAuthorityContext } from "./file-storage-authority";

type CleanupAudit = { tenantId: string; action: string; targetType: string; detail: string; metadata: Record<string, number> };
type UploadRows = { asset: StoredFileAsset; session: StoredFileUploadSession };

export interface FileStorageApplicationParticipants<Transaction extends FileStorageApplicationTransaction> {
  /** 根存储只需公共文件能力；业务参加者仍接收调用方的完整原事务。 */
  store: FileStorageApplicationTransaction;
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  runtimeConfig(tenantId: string, provider?: string, options?: { requireLiveTest: false }): Promise<TenantIntegrationRuntimeConfig | undefined>;
  assertEnabled(transaction: Transaction, tenantId: string, config: TenantIntegrationRuntimeConfig): Promise<void>;
  allowSimulation: boolean;
  isUniqueConflict(error: unknown): boolean;
  excludedUploadScene: string | undefined;
  recordAudit?(input: FileDownloadAudit | CleanupAudit): Promise<unknown>;
}

const bindingKey = (binding: FileStorageBinding) => JSON.stringify([
  binding.businessModule.trim(), binding.businessType.trim(), binding.uploadScene.trim()
]);
const reservedMetadata = new Set([
  "fileUploadVersion", "fileContentVersion", "contentHash", "stagingStorageKey", "storageLocationHash", "uploadConfigHash",
  "knowledgeUploadVersion", "knowledgeContentHash", "knowledgeRevision", "uploadMode", "workspaceId", "uploadedByUserId", "enterprisePaymentProof"
]);

export class FileStorageApplication<Owner extends FileStorageOwner, Transaction extends FileStorageApplicationTransaction> extends FileStoragePrimitives {
  private readonly files: FileStorageRepository;
  private readonly authorities = new Map<string, FileStorageAuthority<Owner, Transaction>>();
  readonly cleanup: FileStorageCleanup<Transaction>;

  constructor(private readonly participants: FileStorageApplicationParticipants<Transaction>,
    authorities: readonly FileStorageAuthority<Owner, Transaction>[]) {
    super();
    this.files = new FileStorageRepository(participants.store);
    for (const authority of authorities) {
      const binding = authority.binding;
      if (!binding?.businessModule?.trim() || !binding.businessType?.trim() || !binding.uploadScene?.trim()
        || typeof authority.assertUpload !== "function" || typeof authority.assertAsset !== "function"
        || typeof authority.authorityKey !== "function" || typeof authority.isTenantSharedBinding !== "function")
        throw new ServiceUnavailableException("文件业务权威登记不完整");
      const key = bindingKey(binding);
      if (this.authorities.has(key)) throw new ConflictException("文件业务权威重复登记");
      this.authorities.set(key, authority);
    }
    const cleanup: FileCleanupParticipants<Transaction> = {
      store: participants.store, transaction: work => participants.transaction(work),
      runtimeConfig: (tenantId, provider) => participants.runtimeConfig(tenantId, provider, { requireLiveTest: false }),
      excludedUploadScene: participants.excludedUploadScene,
      deleteObject: (config, key, at) => this.deleteObject(config, key, at),
      presign: (config, method, key, mimeType, expiresAt) => this.presign(config, method, key, mimeType, expiresAt),
      objectRequest: (url, init) => this.objectRequest(url, init),
      ...(participants.recordAudit ? { recordAudit: input => participants.recordAudit!(input) } : {})
    };
    this.cleanup = new FileStorageCleanup(cleanup);
  }

  private authority(tenantId: string, binding: FileStorageBinding) {
    if (!tenantId?.trim()) throw new ConflictException("文件操作缺少当前租户");
    const authority = this.authorities.get(bindingKey(binding));
    if (!authority) throw new ServiceUnavailableException("文件业务类型或场景尚未登记真实权威");
    return authority;
  }

  private assertOwner(asset: { businessType: string; businessId: string | null; uploadScene: string; uploadedBy?: string | null }, owner?: Owner) {
    if (owner && (!this.matchesOwner(asset, owner) || owner.actorUserId && asset.uploadedBy !== owner.actorUserId))
      throw new NotFoundException("文件不存在或不属于当前业务对象");
  }

  async createUploadSession(tenantId: string, request: CreateFileUploadSessionRequest, owner?: Owner): Promise<FileUploadSessionSummary> {
    let context: FileUploadAuthorityContext<Owner> = { tenantId, request: structuredClone(request), owner: structuredClone(owner) };
    this.validateInput(context.request);
    const authority = this.authority(tenantId, context.request);
    const registeredKey = bindingKey(context.request);
    if (authority.prepareUpload) {
      const prepared = await authority.prepareUpload(context);
      if (bindingKey(prepared) !== registeredKey) throw new ConflictException("专用上传不能更换已登记的业务类型或场景");
      context = { ...context, request: structuredClone(prepared) };
    }
    const mimeType = this.validateInput(context.request);
    if (context.owner && !this.matchesOwner(context.request, context.owner)) throw new ConflictException("上传业务对象与当前业务归属不一致");
    const idempotencyKey = context.request.idempotencyKey.trim();
    const replay = async (session: StoredFileUploadSession) => {
      const asset = await this.participants.store.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } });
      if (!asset) throw new NotFoundException("上传会话不存在或不属于当前租户");
      this.assertOwner(asset, context.owner);
      if (asset.businessModule !== context.request.businessModule.trim() || asset.businessType !== context.request.businessType.trim()
        || asset.businessId !== context.request.businessId.trim() || asset.uploadScene !== context.request.uploadScene.trim()
        || asset.fileName !== context.request.fileName.trim() || asset.mimeType !== mimeType || asset.sizeBytes !== context.request.sizeBytes)
        throw new ConflictException("幂等键已用于不同文件上传请求，请更换幂等键");
      authority.assertReplay?.(context, asset);
      await authority.assertUpload(context);
      return this.receipt(context, authority, { asset, session });
    };
    const existing = await this.files.findUploadSession(tenantId, { idempotencyKey });
    if (existing) return replay(existing);
    await authority.assertUpload(context);
    let writeAttempted = false;
    let created: UploadRows;
    try {
      created = await createOriginalFileUploadFacts<Owner, Transaction, UploadRows>(
        { tenantId, request: context.request, owner: context.owner, mimeType }, {
          runtimeConfig: () => this.participants.runtimeConfig(tenantId),
          validateConfiguration: config => authority.validateConfiguration?.(context, config),
          allowSimulation: this.participants.allowSimulation,
          storageKey: (config, currentTenant, assetId, fileName) => this.storageKey(config, currentTenant, assetId, fileName),
          transaction: work => this.participants.transaction(work),
          assertEnabled: (tx, config) => this.participants.assertEnabled(tx, tenantId, config),
          beforePersist: async tx => { await authority.assertUpload(context, tx); writeAttempted = true; },
          persist: (tx, facts, config) => this.files.persistUploadFacts(tx, tenantId, facts, {
            ...Object.fromEntries(Object.entries(context.request.metadata ?? {}).filter(([key]) => !reservedMetadata.has(key))),
            ...authority.uploadMetadata?.(context),
            ...(context.owner?.actorUserId ? { uploadedByUserId: context.owner.actorUserId,
              uploadedByName: context.owner.actorName ?? "", uploadedAt: new Date().toISOString() } : {}),
            ...(context.owner?.workspaceId ? { workspaceId: context.owner.workspaceId } : {}),
            ...(config ? { fileUploadVersion: 2, storageLocationHash: fileStorageLocationHash(config),
              uploadConfigHash: requestFingerprint({ id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials }) } : {}),
            uploadMode: facts.mode
          })
        });
    } catch (error) {
      if (this.participants.isUniqueConflict(error)) {
        const concurrent = await this.files.findUploadSession(tenantId, { idempotencyKey });
        if (concurrent) return replay(concurrent);
      }
      authority.creationFailed?.(error, "persist", writeAttempted);
      throw error;
    }
    try { return await this.receipt(context, authority, created); }
    catch (error) { authority.creationFailed?.(error, "receipt", writeAttempted); throw error; }
  }

  private async receipt(context: FileUploadAuthorityContext<Owner>, authority: FileStorageAuthority<Owner, Transaction>, rows: UploadRows) {
    const { tenantId, owner } = context;
    const { asset, session } = rows;
    if (session.provider === "local_mock" && !this.participants.allowSimulation)
      throw new ServiceUnavailableException("生产环境禁止重放模拟文件上传，请先配置并验证文件存储平台");
    await authority.assertAsset({ tenantId, asset, owner, operation: "receipt" });
    const original = () => readOriginalFileUploadReceipt({ tenantId, asset, session, owner }, {
      isTenantSharedBinding: row => authority.isTenantSharedBinding(row),
      assertBusinessReference: () => authority.assertUpload(context),
      runtimeConfig: () => this.participants.runtimeConfig(tenantId, session.provider, { requireLiveTest: false }),
      readSession: () => this.files.findUploadSession(tenantId, { id: session.id }),
      readAsset: () => this.participants.store.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
      signPendingPut: (config, key, mimeType, expiresAt) => this.presign(config, "PUT", key, mimeType, expiresAt)
    });
    return authority.readReceipt ? authority.readReceipt({ ...context, asset, session }, original) : original();
  }

  async readUploadReceipt(tenantId: string, sessionId: string, owner?: Owner): Promise<FileUploadSessionSummary> {
    if (!tenantId?.trim()) throw new ConflictException("文件操作缺少当前租户");
    owner = structuredClone(owner);
    const session = await this.files.findUploadSession(tenantId, { id: sessionId });
    if (!session) throw new NotFoundException("上传会话不存在");
    const asset = await this.participants.store.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } });
    if (!asset) throw new NotFoundException("上传会话不存在或不属于当前租户");
    const authority = this.authority(tenantId, asset);
    this.assertOwner(asset, owner);
    const context = { tenantId, owner, request: { businessModule: asset.businessModule, businessType: asset.businessType,
      businessId: asset.businessId ?? "", uploadScene: asset.uploadScene, fileName: asset.fileName, mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes, idempotencyKey: session.idempotencyKey ?? "" } };
    await authority.assertUpload(context);
    return this.receipt(context, authority, { asset, session });
  }

  async completeUpload(tenantId: string, sessionId: string, request: CompleteFileUploadRequest, owner?: Owner) {
    request = structuredClone(request); owner = structuredClone(owner);
    if (!tenantId?.trim()) throw new ConflictException("文件操作缺少当前租户");
    let session = structuredClone(await this.files.findUploadSession(tenantId, { id: sessionId }));
    if (!session) throw new NotFoundException("上传会话不存在");
    let asset = structuredClone(await this.participants.store.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } }));
    if (!asset) throw new NotFoundException("上传会话不存在或不属于当前业务对象");
    const authority = this.authority(tenantId, asset);
    this.assertOwner(asset, owner);
    const context = (): FileCompletionAuthorityContext<Owner> => ({ tenantId, asset: asset!, session: session!, owner, request,
      operation: "complete", contentHash: frozen?.checksum });
    let frozen: { storageKey: string; checksum: string; config: TenantIntegrationRuntimeConfig } | undefined;
    await authority.assertAsset(context());
    if (session.fileAssetId !== asset.id || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey)
      throw new ConflictException("原上传会话与文件绑定不一致");
    if (session.status === "completed") {
      if (asset.status !== "active") throw new ConflictException("上传结果不可用");
      if ((asset.metadata as Record<string, unknown> | null)?.fileUploadVersion === 2 && request.checksum?.trim() && request.checksum.trim() !== asset.checksum)
        throw new ConflictException("原完成收据与文件摘要不一致，不能重写内容");
      await authority.afterComplete?.(context());
      return this.assetSummary(asset);
    }
    const resuming = session.status === "freeze_pending" && asset.status === "pending_upload"
      && (asset.metadata as Record<string, unknown> | null)?.fileUploadVersion === 2;
    if (session.status !== "pending_upload" && !resuming) throw new ConflictException("上传会话已失效");
    if (!resuming && session.expiresAt.getTime() <= Date.now()) {
      await this.participants.transaction(async tx => {
        const claim = await tx.fileUploadSession.updateMany({ where: { id: session!.id, tenantId, status: "pending_upload" },
          data: { status: "failed", failureReason: "上传会话已过期", cleanupError: "待执行过期对象清理" } });
        if (claim.count !== 1) throw new ConflictException("上传会话已变化，请读取原结果");
        await tx.fileAsset.updateMany({ where: { id: asset!.id, tenantId, status: "pending_upload" }, data: { status: "failed" } });
      });
      throw new ConflictException("上传会话已过期，请重新上传");
    }
    if (session.provider === "local_mock" && !this.participants.allowSimulation)
      throw new ServiceUnavailableException("生产环境禁止完成模拟文件上传，请先配置并验证文件存储平台");
    if (session.provider !== "local_mock") {
      const config = await this.participants.runtimeConfig(tenantId, session.provider, { requireLiveTest: false });
      if (!config) throw new ConflictException("原上传缺少有效临时对象或文件配置依据，不能确认完成");
      const result = await freezeFileUploadContent<StoredFileAsset, StoredFileUploadSession, Transaction>({ tenantId, asset, session, config, checksum: request.checksum }, {
        transaction: work => this.participants.transaction(work),
        beforeClaim: tx => authority.assertAsset(context(), tx),
        assertConfiguration: (tx, current) => this.participants.assertEnabled(tx, tenantId, current),
        readContent: (current, key, mimeType, sizeBytes) => this.readObjectContent(current, key, mimeType, sizeBytes),
        writeContent: (current, key, mimeType, bytes) => {
          const signed = this.presign(current, "PUT", key, mimeType, new Date(Date.now() + 60_000));
          return this.objectRequest(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(bytes) });
        },
        ...(authority.readPendingContent ? { readPendingContent: () => authority.readPendingContent!(context()) } : {})
      });
      asset = result.asset; session = result.session; frozen = result.frozen;
    }
    const metadata = { ...((asset.metadata ?? {}) as Record<string, unknown>), ...authority.completionMetadata?.(context()),
      completedAt: new Date().toISOString(), ...(frozen ? { fileContentVersion: 1, contentHash: frozen.checksum } : {}),
      ...(request.checksum?.trim() ? { clientChecksum: request.checksum.trim() } : {}) };
    const updated = await this.participants.transaction(async tx => {
      if (frozen) await this.participants.assertEnabled(tx, tenantId, frozen.config);
      const [currentAsset, currentSession] = await Promise.all([
        tx.fileAsset.findFirst({ where: { id: asset!.id, tenantId } }),
        tx.fileUploadSession.findFirst({ where: { id: session!.id, tenantId } })
      ]);
      if (requestFingerprint(currentAsset) !== requestFingerprint(asset) || requestFingerprint(currentSession) !== requestFingerprint(session))
        throw new ConflictException("文件或原上传会话在内容冻结期间已变化");
      await authority.assertAsset(context(), tx);
      await authority.beforeActivate?.(context(), tx);
      const sessionClaim = await tx.fileUploadSession.updateMany({
        where: { id: session!.id, tenantId, status: frozen ? "freeze_pending" : "pending_upload", updatedAt: session!.updatedAt,
          fileAssetId: asset!.id, provider: asset!.storageProvider, storageKey: asset!.storageKey },
        data: { status: "completed", completedAt: new Date(), failureReason: null,
          ...(frozen ? { storageKey: frozen.storageKey, cleanupError: COMPLETED_STAGING_PENDING } : {}) }
      });
      if (sessionClaim.count !== 1) throw new ConflictException("上传会话已失效，请重新上传");
      const assetClaim = await tx.fileAsset.updateMany({
        where: { id: asset!.id, tenantId, status: "pending_upload", updatedAt: asset!.updatedAt,
          storageProvider: asset!.storageProvider, storageKey: asset!.storageKey, uploadedBy: asset!.uploadedBy },
        data: { status: "active", metadata: metadata as { [key: string]: PlatformJsonValue | undefined },
          ...(frozen ? { storageKey: frozen.storageKey, checksum: frozen.checksum } : {}) }
      });
      if (assetClaim.count !== 1) throw new ConflictException("上传文件已失效，请重新上传");
      const current = await tx.fileAsset.findUniqueOrThrow({ where: { id: asset!.id } });
      await authority.afterActivate?.({ ...context(), asset: current }, tx);
      return current;
    });
    await authority.afterComplete?.({ ...context(), asset: updated });
    return this.assetSummary(updated);
  }

  async downloadUrl(tenantId: string, fileAssetId: string, owner?: Owner) {
    if (!tenantId?.trim()) throw new ConflictException("文件操作缺少当前租户");
    owner = structuredClone(owner);
    const asset = await this.participants.store.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } });
    if (!asset) throw new NotFoundException("文件不存在或尚未完成上传");
    const authority = this.authority(tenantId, asset);
    this.assertOwner(asset, owner);
    if (!this.participants.recordAudit) throw new ServiceUnavailableException("文件访问审计未配置");
    return issueFileDownloadReference({ tenantId, fileAssetId, asset }, {
      access: { authorityKey: currentTenant => authority.authorityKey(currentTenant),
        assertRead: (currentTenant, current) => authority.assertAsset({ tenantId: currentTenant, asset: current, owner, operation: "download" }) },
      recordAudit: input => this.participants.recordAudit!(input),
      readAsset: () => this.participants.store.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } }),
      runtimeConfig: () => this.participants.runtimeConfig(tenantId, asset.storageProvider),
      allowSimulation: this.participants.allowSimulation,
      signGet: (config, key, mimeType, expiresAt) => this.presign(config, "GET", key, mimeType, expiresAt)
    });
  }
}
