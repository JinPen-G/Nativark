/** 原组合文件编排。公共创建、原回执、字节、内容冻结、按租户清理、读取签名和文件表由platform-server维护，Rental引用与ACL由Rental包提供。
 * 专用检查、知识与企业证据沿原入口和原冻结/unknown收据，不以通用存储替代业务授权。 */
import { FileStoragePrimitives, FileStorageRepository, MAX_FILE_BYTES, freezeFileUploadContent, createOriginalFileUploadFacts, readOriginalFileUploadReceipt, FileStorageCleanup, COMPLETED_STAGING_PENDING, issueFileDownloadReference } from "@rental-os/platform-server/files";
import { RentalFileBusinessReferences } from "@rental-os/rental-core/file-access";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Optional, ServiceUnavailableException } from "@nestjs/common";
import { INSPECTION_OBJECT_READER, readInspectionMedia, type InspectionObjectReader } from "../ai-native/inspection-assist/inspection-media.reader";
import { KNOWLEDGE_FILE_ACCESS, type KnowledgeFileAccess } from "../ai-native/knowledge/knowledge-file-access";
import type { KnowledgeUploadRevision } from "../ai-native/knowledge/knowledge.ports";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { ENTERPRISE_PAYMENT_PROOF_SCENE, RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "@rental-os/shared";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  CompleteFileUploadRequest,
  CreateFileUploadSessionRequest,
  FileAssetSummary,
  FileUploadCleanupSummary,
  FileDownloadUrlSummary,
  FileUploadSessionSummary,
  StaffUploadObservationRequest, StaffUploadObservationResponse, StaffUploadObservedSession
} from "@rental-os/shared";
import { parseStaffUploadObservation } from './file-upload.dto';
import { assertOutboundUrl } from "../../common/outbound-url";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { FileBusinessAccessService } from "../files/file-business-access.service";
import { OperationLogService } from "../../common/operation-log.service";
import { getRequestIdentity } from "../../common/request-identity";
import { fetchObjectStorageWithTimeout as fetchWithTimeout } from "@rental-os/platform-server/object-storage";
import { fileStorageLocationHash, frozenFileContentHash } from "./file-content-binding";
import { aiRetentionObjectHash } from "../ai-native/privacy/retention-binding";
import { AI_RETENTION_POLICY } from "../ai-native/privacy/retention-policy";
import { KnowledgeCommitUnknownError } from '../ai-native/knowledge/knowledge-errors';
import { knowledgeUploadRevisionSchema, knowledgeUploadKey } from '../ai-native/knowledge/human-knowledge-upload.service';

type JsonRecord = Record<string, unknown>;
type ExchangeInspectionFrozenEvidence = { sourceId: string; contentHash: string; sizeBytes: number; mimeType: "image/png" | "image/jpeg"; width: number; height: number };
// Prisma rows carry Date objects; the request canonicalizer expects JSON values.
const fileFactHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export interface FileBusinessOwner {
  knowledgeRevision?: KnowledgeUploadRevision;
  businessType?: string;
  businessId?: string;
  uploadScene?: string;
  /** 订单、型号等空间业务必须带当前空间；客户资料和资质按租户共享。 */
  workspaceId?: string;
  /** 员工上传时由已验证会话补入；绝不从客户端 metadata 读取操作者。 */
  actorUserId?: string;
  actorName?: string;
  /** Internal dedicated source id; never accepted by the generic HTTP upload DTO. */
  exchangeInspectionSourceId?: string;
  /** Supplied by the dedicated enterprise controller after original-order admission. */
  enterprisePaymentProof?: { corporateCustomerId: string; orderId: string; objectRevision: string; purpose: "rental_fee" };
}

type UploadFacts = { input: CreateFileUploadSessionRequest; owner?: FileBusinessOwner; assetId: string; sessionId: string;
  expiresAt: Date; provider: string; storageKey: string; mode: "provider" | "simulation"; mimeType: string };
export type ExchangeInspectionUploadPlan = UploadFacts & { config: TenantIntegrationRuntimeConfig; configRowHash: string;
  storageLocationHash: string; uploadUrl: string; uploadHeaders: Record<string, string> };

const UPLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class FileStorageRuntimeService extends FileStoragePrimitives implements OnApplicationBootstrap, OnApplicationShutdown {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly files: FileStorageRepository;
  private readonly fileReferences: RentalFileBusinessReferences;
  private readonly cleanup: FileStorageCleanup<Prisma.TransactionClient>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationService,
    @Optional() private readonly operationLog?: OperationLogService,
    @Optional() @Inject(INSPECTION_OBJECT_READER) private readonly inspectionObjectReader?: InspectionObjectReader,
    @Optional() @Inject(KNOWLEDGE_FILE_ACCESS) private readonly knowledgeFiles?: KnowledgeFileAccess,
    @Optional() private readonly fileAccess?: FileBusinessAccessService
  ) {
    super();
    this.files = new FileStorageRepository(prisma);
    this.fileReferences = new RentalFileBusinessReferences(prisma);
    this.cleanup = new FileStorageCleanup<Prisma.TransactionClient>({
      store: prisma,
      transaction: work => prisma.$transaction(work),
      runtimeConfig: (tenantId, provider) => this.integrations.runtimeConfig("file", tenantId, provider as never, { requireLiveTest: false }),
      excludedUploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
      deleteObject: (config, storageKey, at) => this.deleteObject(config, storageKey, at),
      presign: (config, method, storageKey, mimeType, expiresAt) => this.presign(config, method, storageKey, mimeType, expiresAt),
      objectRequest: (url, init) => this.objectRequest(url, init),
      ...(operationLog ? { recordAudit: input => operationLog.record(input) } : {})
    });
  }

  onApplicationBootstrap() {
    // 多实例部署也可以各自运行：每个会话先用条件更新抢占，重复扫描不会重复删对象。
    // 测试进程不启动定时器；FILE_UPLOAD_CLEANUP_INTERVAL_MS 只允许调慢，避免误配成忙循环。
    if (process.env.NODE_ENV === "test" || process.env.FILE_UPLOAD_CLEANUP_DISABLED === "true") return;
    const configured = Number(process.env.FILE_UPLOAD_CLEANUP_INTERVAL_MS ?? 5 * 60 * 1000);
    const intervalMs = Number.isFinite(configured) ? Math.max(configured, 60 * 1000) : 5 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredUploadSessionsForAllTenants().catch(() => undefined);
      void this.cleanupPendingFileAssetDeletesForAllTenants().catch(() => undefined);
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  onApplicationShutdown() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  /** 只返回是否存在已启用的文件平台，不返回配置内容或凭据。 */
  async hasEnabledProvider(tenantId: string) {
    const row = await this.prisma.tenantIntegrationConfig.findFirst({
      where: { tenantId, capability: "file", enabled: true },
      select: { id: true }
    });
    return Boolean(row);
  }

  async createUploadSession(
    tenantId: string,
    input: CreateFileUploadSessionRequest,
    owner?: FileBusinessOwner
  ): Promise<FileUploadSessionSummary> {
    input = structuredClone(input); owner = structuredClone(owner);
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("换货检查影像必须经专用原业务入口上传");
    if (input.uploadScene?.trim() === ENTERPRISE_PAYMENT_PROOF_SCENE) {
      if (!owner?.enterprisePaymentProof || owner.enterprisePaymentProof.purpose !== "rental_fee" || owner.enterprisePaymentProof.orderId !== input.businessId
        || !owner.workspaceId || !owner.actorUserId || input.businessModule !== "enterprise" || input.businessType !== "rental_order"
        || owner.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE) throw new BadRequestException("费用回款凭证须经原企业订单专用入口上传");
      input.metadata = { ...input.metadata, enterprisePaymentProof: { ...owner.enterprisePaymentProof } };
    }
    const mimeType = this.validateInput(input);
    const idempotencyKey = input.idempotencyKey.trim();
    if (owner && !this.matchesOwner({ businessType: input.businessType, businessId: input.businessId, uploadScene: input.uploadScene }, owner)) {
      throw new BadRequestException("上传业务对象与当前业务归属不一致");
    }
    const existing = await this.files.findUploadSession(tenantId, { idempotencyKey });
    if (existing) {
      const existingAsset = await this.prisma.fileAsset.findUniqueOrThrow({ where: { id: existing.fileAssetId } });
      if (existingAsset.tenantId !== tenantId) throw new NotFoundException("上传会话不存在或不属于当前租户");
      if (owner && !this.matchesOwner(existingAsset, owner)) throw new ConflictException("幂等键已被其他业务对象使用，请更换幂等键");
      if (owner?.actorUserId && existingAsset.uploadedBy !== owner.actorUserId) throw new ConflictException("上传幂等键已由其他员工使用，请重新选择文件");
      if (!this.matchesUploadRequest(existingAsset, input, mimeType)) {
        throw new ConflictException("幂等键已用于不同文件上传请求，请更换幂等键");
      }
      // 幂等重放仍重新验证业务归属：客户资料在租户内共享，订单等事实按空间隔离。
      // owner 的客户 ID / 上传场景匹配不能因重放而跳过。
      if (input.businessType === 'ai_knowledge_document') return this.knowledgeUploadSummary(tenantId, input, existing, existingAsset, owner);
      await this.assertBusinessReference(tenantId, existingAsset.businessType, existingAsset.businessId ?? "", owner?.workspaceId);
      if (existing.provider === "local_mock" && process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("生产环境禁止重放模拟文件上传，请先配置并验证文件存储平台");
      }
      return this.originalUploadSummary(tenantId, existing, existingAsset, owner);
    }
    if (input.businessType === 'ai_knowledge_document') await this.authorizeKnowledgeUpload(tenantId, input, owner);
    else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId);

    let knowledgeWriteAttempted = false;
    let created: {
      asset: Prisma.FileAssetGetPayload<object>;
      session: Prisma.FileUploadSessionGetPayload<object>;
    };
    try {
      created = await createOriginalFileUploadFacts<FileBusinessOwner, Prisma.TransactionClient, typeof created>(
        { tenantId, request: input, owner, mimeType }, {
          runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId),
          validateConfiguration: config => {
            if (input.businessType === 'ai_knowledge_document' && config?.provider !== 's3_compatible')
              throw new ServiceUnavailableException('知识首建需要可读取的受控存储');
          },
          allowSimulation: process.env.NODE_ENV !== "production",
          storageKey: (config, currentTenantId, assetId, fileName) => this.storageKey(config, currentTenantId, assetId, fileName),
          transaction: work => this.prisma.$transaction(work),
          assertEnabled: (tx, config) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
            { configRevision: config.revision }),
          beforePersist: async () => {
            if (input.businessType === 'ai_knowledge_document') await this.authorizeKnowledgeUpload(tenantId, input, owner);
            // 配置读取会让出执行，建立上传事实前再次核原业务引用及空间归属。
            else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId);
            if (input.businessType === 'ai_knowledge_document') knowledgeWriteAttempted = true;
          },
          persist: (tx, facts, config) => this.persistUploadFacts(tx, tenantId, facts, config)
        }
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await this.files.findUploadSession(tenantId, { idempotencyKey });
        if (concurrent) {
          const concurrentAsset = await this.prisma.fileAsset.findUniqueOrThrow({ where: { id: concurrent.fileAssetId } });
          if (concurrentAsset.tenantId !== tenantId) throw new NotFoundException("上传会话不存在或不属于当前租户");
          if (owner && !this.matchesOwner(concurrentAsset, owner)) throw new ConflictException("幂等键已被其他业务对象使用，请更换幂等键");
          if (owner?.actorUserId && concurrentAsset.uploadedBy !== owner.actorUserId) throw new ConflictException("上传幂等键已由其他员工使用，请重新选择文件");
          if (!this.matchesUploadRequest(concurrentAsset, input, mimeType)) {
            throw new ConflictException("幂等键已用于不同文件上传请求，请更换幂等键");
          }
          if (input.businessType === 'ai_knowledge_document') return this.knowledgeUploadSummary(tenantId, input, concurrent, concurrentAsset, owner);
          await this.assertBusinessReference(tenantId, concurrentAsset.businessType, concurrentAsset.businessId ?? "", owner?.workspaceId);
          return this.originalUploadSummary(tenantId, concurrent, concurrentAsset, owner);
        }
      }
      if (knowledgeWriteAttempted) throw new KnowledgeCommitUnknownError();
      throw error;
    }

    if (input.businessType === 'ai_knowledge_document') {
      try { return await this.knowledgeUploadSummary(tenantId, input, created.session, created.asset, owner); }
      catch { throw new KnowledgeCommitUnknownError(); }
    }
    return this.originalUploadSummary(tenantId, created.session, created.asset, owner);
  }

  private async persistUploadFacts(tx: Prisma.TransactionClient, tenantId: string, facts: UploadFacts, configured?: TenantIntegrationRuntimeConfig) {
    const { input, owner, mode } = facts;
    return this.files.persistUploadFacts(tx, tenantId, facts, {
              ...Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([key]) => ![
                "fileUploadVersion", "fileContentVersion", "contentHash", "stagingStorageKey", "storageLocationHash", "uploadConfigHash",
                "knowledgeUploadVersion", "knowledgeContentHash", "knowledgeRevision", "uploadMode", "workspaceId", "uploadedByUserId", "enterprisePaymentProof"
              ].includes(key))),
              ...(owner?.actorUserId ? {
                uploadedByUserId: owner.actorUserId,
                uploadedByName: owner.actorName ?? "",
                uploadedAt: new Date().toISOString()
              } : {}),
              ...(owner?.workspaceId ? { workspaceId: owner.workspaceId } : {}),
              ...(owner?.enterprisePaymentProof ? { enterprisePaymentProof: { ...owner.enterprisePaymentProof } } : {}),
              ...(configured ? { fileUploadVersion: 2,
                storageLocationHash: this.retentionLocationHash(configured),
                uploadConfigHash: requestFingerprint({ id: configured.id, provider: configured.provider, settings: configured.settings, credentials: configured.credentials }) } : {}),
              ...(input.businessType === 'ai_knowledge_document' ? { knowledgeUploadVersion: 1,
                ...(configured ? { storageLocationHash: this.retentionLocationHash(configured) } : {}),
                ...(owner?.knowledgeRevision ? { knowledgeRevision: { ...owner.knowledgeRevision } } : {}) } : {}),
              uploadMode: mode
            });
  }

  /** Internal plan only: no object request or file write occurs before the caller's transaction. */
  async planExchangeInspectionUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner: FileBusinessOwner): Promise<ExchangeInspectionUploadPlan> {
    const mimeType = this.validateInput(input);
    if (input.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE || input.businessModule !== "rental-core" || input.businessType !== "rental_order"
      || !owner.workspaceId || !owner.actorUserId || !owner.exchangeInspectionSourceId || input.metadata !== undefined
      || !["image/jpeg", "image/png"].includes(mimeType)) throw new BadRequestException("专用换货影像归属或类型无效");
    const configBefore = await this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, capability: "file", enabled: true, isDefault: true, lastTestStatus: "passed", lastTestMode: "live" } });
    const config = await this.integrations.runtimeConfig("file", tenantId);
    if (!config || !["s3_compatible", "aliyun_oss", "tencent_cos"].includes(config.provider)) throw new ServiceUnavailableException("换货影像需要已验证的真实文件存储");
    const configRow = await this.prisma.tenantIntegrationConfig.findFirst({ where: { id: config.id, tenantId, enabled: true, isDefault: true, lastTestStatus: "passed", lastTestMode: "live" } });
    if (!configBefore || !configRow || fileFactHash(configBefore) !== fileFactHash(configRow)
      || requestFingerprint(configRow.settings) !== requestFingerprint(config.settings)) throw new ConflictException("文件配置已变化");
    const assetId = `file_${randomUUID().replace(/-/g, "")}`, sessionId = randomUUID(), expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
    // Share the original v2 staging layout so committed evidence has one
    // validator. The display filename remains a file fact, never the object key.
    const storageKey = this.storageKey(config, tenantId, assetId, "blob");
    if (storageKey.length > 380) throw new ConflictException("文件对象定位过长，不能创建安全上传会话");
    const signed = this.presign(config, "PUT", storageKey, mimeType, expiresAt);
    return { input: structuredClone(input), owner: structuredClone(owner), assetId, sessionId, expiresAt, provider: config.provider, storageKey, mimeType, mode: "provider", config,
      configRowHash: fileFactHash(configRow), storageLocationHash: this.retentionLocationHash(config), uploadUrl: signed.url, uploadHeaders: signed.headers };
  }
  async persistExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, plan: ExchangeInspectionUploadPlan) {
    await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", plan.config.provider, { requireDefault: true });
    const configRow = await tx.tenantIntegrationConfig.findFirst({ where: { id: plan.config.id, tenantId } });
    if (!configRow || fileFactHash(configRow) !== plan.configRowHash || plan.expiresAt.getTime() <= Date.now()) throw new ConflictException("原上传文件配置或会话已变化");
    const input = { ...plan.input, metadata: { exchangeInspectionSourceId: plan.owner!.exchangeInspectionSourceId, storageLocationHash: plan.storageLocationHash } };
    return this.persistUploadFacts(tx, tenantId, { ...plan, input }, plan.config);
  }

  private async exchangeInspectionAsset(tenantId: string, fileAssetId: string, owner: FileBusinessOwner) {
    if (!owner.actorUserId || !owner.workspaceId || !owner.exchangeInspectionSourceId || owner.businessType !== "rental_order"
      || owner.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("专用影像原归属无效");
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    const metadata = asset?.metadata as JsonRecord | null | undefined, session = asset?.uploadSession;
    if (!asset || !this.matchesOwner(asset, owner) || metadata?.workspaceId !== owner.workspaceId || metadata.exchangeInspectionSourceId !== owner.exchangeInspectionSourceId
      || asset.storageProvider === "local_mock" || !session || session.fileAssetId !== asset.id || session.tenantId !== tenantId
      || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey) throw new NotFoundException("专用影像原文件归属不可核验");
    return { asset, session };
  }
  async inspectExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, configRowHash: string, storageLocationHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    if (asset.status !== "pending_upload" || session.status !== "pending_upload" || !["image/png", "image/jpeg"].includes(asset.mimeType)) throw new ConflictException("原影像只能核对原会话结果");
    const configRow = await this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, provider: asset.storageProvider, capability: "file" } });
    if (!configRow || fileFactHash(configRow) !== configRowHash) throw new ConflictException("原影像存储配置已变化");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || this.retentionLocationHash(config) !== storageLocationHash) throw new ServiceUnavailableException("原影像存储位置不可核验");
    const originalMetadata = asset.metadata as JsonRecord;
    if (originalMetadata.fileUploadVersion !== 2 || asset.storageKey !== this.storageKey(config, tenantId, fileAssetId, "blob")) {
      throw new ConflictException("原影像缺少受控暂存依据，保留原记录待核对");
    }
    // Reuse the original bounded object transport. This invocation's Core claim
    // owns the only staging GET; the validated bytes, not a later mutable copy,
    // are written to a server-only destination under the existing freeze format.
    const bytes = await this.readObjectContent(config, asset.storageKey, asset.mimeType, asset.sizeBytes);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const stream = new ReadableStream<Uint8Array>({ start(reader) { reader.enqueue(new Uint8Array(bytes)); reader.close(); } });
      const content = await readInspectionMedia(stream, asset.sizeBytes, controller.signal);
      if (content.sizeBytes !== asset.sizeBytes || content.mediaType !== asset.mimeType || !content.width || !content.height
        || !["image/png", "image/jpeg"].includes(content.mediaType)) throw new BadRequestException("原影像实际格式或大小不匹配");
      const after = await this.exchangeInspectionAsset(tenantId, fileAssetId, owner);
      if (fileFactHash(after) !== fileFactHash(before)) throw new ConflictException("原影像在读取期间已变化");
      const evidence: ExchangeInspectionFrozenEvidence = { sourceId: owner.exchangeInspectionSourceId!, contentHash: content.contentHash,
        sizeBytes: content.sizeBytes, mimeType: content.mediaType as "image/png" | "image/jpeg", width: content.width, height: content.height };
      const destination = `${asset.storageKey}.committed/${randomUUID()}/${content.contentHash}`;
      const claimed = await this.prisma.$transaction(async tx => {
        await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider);
        const currentConfig = await tx.tenantIntegrationConfig.findFirst({ where: { tenantId, capability: "file", provider: asset.storageProvider } });
        const currentAsset = await tx.fileAsset.findFirst({ where: { id: fileAssetId, tenantId }, include: { uploadSession: true } });
        if (!currentConfig || fileFactHash(currentConfig) !== configRowHash || !currentAsset?.uploadSession
          || fileFactHash({ asset: currentAsset, session: currentAsset.uploadSession }) !== fileFactHash(before)) throw new ConflictException("原影像冻结前绑定或配置已变化");
        const sessionClaim = await tx.fileUploadSession.updateMany({ where: { id: session.id, tenantId, status: "pending_upload",
          fileAssetId, updatedAt: session.updatedAt, storageKey: asset.storageKey }, data: { status: "freeze_pending", storageKey: destination } });
        const assetClaim = await tx.fileAsset.updateMany({ where: { id: fileAssetId, tenantId, status: "pending_upload", uploadedBy: owner.actorUserId,
          updatedAt: asset.updatedAt, storageProvider: asset.storageProvider, storageKey: asset.storageKey }, data: { storageKey: destination, checksum: content.contentHash,
          metadata: { ...originalMetadata, fileContentVersion: 1, contentHash: content.contentHash, stagingStorageKey: asset.storageKey,
            exchangeInspectionFrozenEvidence: evidence } as Prisma.InputJsonValue } });
        if (sessionClaim.count !== 1 || assetClaim.count !== 1) throw new ConflictException("原影像冻结已被占用，只能核对原目标");
        const frozenAsset = await tx.fileAsset.findFirst({ where: { id: fileAssetId, tenantId }, include: { uploadSession: true } });
        if (!frozenAsset?.uploadSession) throw new ConflictException("原影像冻结记录缺失");
        return { asset: frozenAsset, session: frozenAsset.uploadSession };
      });
      // The exact destination is durable before PUT. A lost acknowledgement is
      // reconciled there; never allocate another destination or reread staging.
      const signed = this.presign(config, "PUT", destination, asset.mimeType, new Date(Date.now() + 60000));
      const written = await this.objectRequest(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(bytes) });
      if (!written.ok) throw new ServiceUnavailableException("原影像内容冻结结果未知，只能核对已登记目标");
      const observed = await this.readObjectContent(config, destination, asset.mimeType, asset.sizeBytes);
      if (createHash("sha256").update(observed).digest("hex") !== evidence.contentHash) throw new ConflictException("原影像冻结字节与已核验内容不同");
      return { ...evidence, assetHash: fileFactHash(claimed.asset), sessionHash: fileFactHash(claimed.session), configRowHash, storageLocationHash };
    } finally { clearTimeout(timer); }
  }

  private exchangeFrozenEvidence(asset: { id: string; tenantId: string; storageProvider: string; storageKey: string; checksum: string | null; metadata: unknown; sizeBytes: number; mimeType: string }, owner: FileBusinessOwner) {
    const metadata = asset.metadata as JsonRecord | null, value = metadata?.exchangeInspectionFrozenEvidence as ExchangeInspectionFrozenEvidence | undefined;
    if (!value || value.sourceId !== owner.exchangeInspectionSourceId || value.contentHash !== frozenFileContentHash(asset)
      || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > MAX_FILE_BYTES || !["image/png", "image/jpeg"].includes(value.mimeType)
      || value.sizeBytes !== asset.sizeBytes || value.mimeType !== asset.mimeType
      || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1
      || value.width > 16384 || value.height > 16384 || value.width * value.height > 40000000) throw new ConflictException("原影像冻结内容证据缺失或不一致");
    return value;
  }

  /** Observe only a previously persisted destination. No staging read or PUT;
   * a missing original freeze intent remains unknown, including after expiry. */
  async reconcileExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, configRowHash: string, storageLocationHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    if (asset.status === "pending_upload" && session.status === "pending_upload") return undefined;
    if (!(asset.status === "pending_upload" && session.status === "freeze_pending" || asset.status === "active" && session.status === "completed")) throw new ConflictException("原影像冻结状态不可核对");
    const evidence = this.exchangeFrozenEvidence(asset, owner);
    const configRow = await this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, provider: asset.storageProvider, capability: "file" } });
    if (!configRow || fileFactHash(configRow) !== configRowHash) throw new ConflictException("原影像冻结配置已变化");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || this.retentionLocationHash(config) !== storageLocationHash || !frozenFileContentHash(asset, config)) throw new ConflictException("原影像冻结位置不可核对");
    const bytes = await this.readObjectContent(config, asset.storageKey, evidence.mimeType, evidence.sizeBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== evidence.contentHash) throw new ConflictException("原影像冻结目标尚未核验，不能另写或重传");
    const after = await this.exchangeInspectionAsset(tenantId, fileAssetId, owner);
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException("原影像冻结依据在核对期间已变化");
    return { ...evidence, assetHash: fileFactHash(asset), sessionHash: fileFactHash(session), configRowHash, storageLocationHash };
  }

  /** Core supplies the verified original preparation's factual owner and hash.
   * Return bounded immutable bytes, never a PUT/GET ticket or storage key. */
  async readFrozenExchangeInspectionEvidence(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, contentHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    const evidence = this.exchangeFrozenEvidence(asset, owner);
    if (asset.status !== "active" || session.status !== "completed" || evidence.contentHash !== contentHash
      || (asset.metadata as JsonRecord).exchangeInspectionContentHash !== contentHash) throw new ConflictException("原检查照片尚未正式接受或内容不一致");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || !frozenFileContentHash(asset, config)) throw new ConflictException("原检查照片存储位置已变化");
    const bytes = await this.readObjectContent(config, asset.storageKey, evidence.mimeType, evidence.sizeBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== contentHash) throw new ConflictException("原检查照片读取字节与同意材料不一致");
    const after = await this.exchangeInspectionAsset(tenantId, fileAssetId, owner);
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException("原检查照片读取期间发生变化");
    return { bytes, mimeType: evidence.mimeType, contentHash, sizeBytes: evidence.sizeBytes };
  }
  async completeExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, fileAssetId: string, owner: FileBusinessOwner,
    proof: Awaited<ReturnType<FileStorageRuntimeService["inspectExchangeInspectionUpload"]>>) {
    const asset = await tx.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    const metadata = asset?.metadata as JsonRecord | null | undefined;
    if (!owner.exchangeInspectionSourceId || owner.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE || !asset?.uploadSession || !metadata || !this.matchesOwner(asset, owner)
      || metadata.workspaceId !== owner.workspaceId || metadata.exchangeInspectionSourceId !== owner.exchangeInspectionSourceId
      || metadata.storageLocationHash !== proof.storageLocationHash || fileFactHash(asset) !== proof.assetHash
      || fileFactHash(asset.uploadSession) !== proof.sessionHash) throw new ConflictException("原影像完成绑定已变化");
    const evidence = this.exchangeFrozenEvidence(asset, owner);
    if (fileFactHash(evidence) !== fileFactHash({ sourceId: owner.exchangeInspectionSourceId, contentHash: proof.contentHash, sizeBytes: proof.sizeBytes,
      mimeType: proof.mimeType, width: proof.width, height: proof.height })) throw new ConflictException("原影像完成不属于已核验的冻结内容");
    await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", asset.storageProvider as never);
    const configRow = await tx.tenantIntegrationConfig.findFirst({ where: { tenantId, capability: "file", provider: asset.storageProvider } });
    if (!configRow || fileFactHash(configRow) !== proof.configRowHash) throw new ConflictException("原影像文件配置已变化");
    if (asset.status === "active" && asset.uploadSession.status === "completed" && asset.uploadSession.completedAt
      && metadata.exchangeInspectionContentHash === proof.contentHash) {
      return { contentHash: proof.contentHash, sizeBytes: proof.sizeBytes, mimeType: proof.mimeType, width: proof.width, height: proof.height,
        completedAt: asset.uploadSession.completedAt.toISOString() };
    }
    if (asset.status !== "pending_upload" || asset.uploadSession.status !== "freeze_pending") throw new ConflictException("原影像尚未完成内容冻结");
    const completedAt = new Date();
    const sessionClaim = await tx.fileUploadSession.updateMany({ where: { id: asset.uploadSession.id, tenantId, status: "freeze_pending", updatedAt: asset.uploadSession.updatedAt,
      fileAssetId, provider: asset.storageProvider, storageKey: asset.storageKey }, data: { status: "completed", completedAt, failureReason: null } });
    const assetClaim = await tx.fileAsset.updateMany({ where: { id: fileAssetId, tenantId, status: "pending_upload", updatedAt: asset.updatedAt, uploadedBy: owner.actorUserId,
      storageProvider: asset.storageProvider, storageKey: asset.storageKey }, data: { status: "active", checksum: proof.contentHash,
      metadata: { ...(asset.metadata as JsonRecord), completedAt: completedAt.toISOString(), exchangeInspectionContentHash: proof.contentHash } as Prisma.InputJsonValue } });
    if (sessionClaim.count !== 1 || assetClaim.count !== 1) throw new ConflictException("原影像完成需核对原结果");
    return { contentHash: proof.contentHash, sizeBytes: proof.sizeBytes, mimeType: proof.mimeType, width: proof.width, height: proof.height, completedAt: completedAt.toISOString() };
  }

  /**
   * 服务端已有完整文件内容时使用的上传入口（例如型号图片）。
   * 仍然复用上传会话、幂等键、对象存在性校验和完成状态机，不允许业务模块
   * 自己拿租户密钥直连对象存储。该入口只接受已配置的真实 provider；没有配置
   * 时由调用方决定是否保留开发环境的本地模拟路径。
   */
  async uploadBuffer(
    tenantId: string,
    input: CreateFileUploadSessionRequest,
    content: Buffer,
    owner?: FileBusinessOwner
  ) {
    if (!Buffer.isBuffer(content) || content.length !== input.sizeBytes) {
      throw new ConflictException("上传文件内容与声明大小不一致");
    }
    const checksum = createHash("sha256").update(content).digest("hex");
    const session = await this.createUploadSession(tenantId, input, owner);
    if (session.status === "completed" || session.status === "freeze_pending") return this.completeUpload(tenantId, session.sessionId, { checksum }, owner);
    if (session.mode !== "provider" || !session.uploadUrl) {
      await this.failSession(tenantId, session.sessionId, "文件平台未返回可用上传地址");
      throw new ServiceUnavailableException("文件平台未返回可用上传地址");
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(session.uploadUrl, {
        method: "PUT",
        headers: session.uploadHeaders ?? { "Content-Type": input.mimeType },
        body: new Uint8Array(content)
      });
    } catch {
      await this.failSession(tenantId, session.sessionId, "上传到对象存储失败");
      throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
    }
    if (!response.ok) {
      await this.failSession(tenantId, session.sessionId, `对象存储返回 HTTP ${response.status}`);
      throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
    }
    return this.completeUpload(tenantId, session.sessionId, { checksum }, owner);
  }

  /**
   * 删除业务文件时使用。先在 provider 侧确认删除，再把 FileAsset 标为 deleted；
   * provider 暂不可用时标记 delete_pending，避免把一个实际上仍存在的对象伪装成
   * 已删除。后台清理循环会继续重试 pending 状态。
   */
  async deleteFileAsset(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId } });
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new ServiceUnavailableException("专用换货影像保留原引用，不使用通用删除");
    if (asset?.businessType === 'ai_knowledge_document') throw new ServiceUnavailableException('知识附件保留原上传证据；文档删除走知识生命周期');
    if (!asset || (owner && !this.matchesOwner(asset, owner)) || !["active", "delete_pending", "deleted"].includes(asset.status)) {
      throw new NotFoundException("文件不存在或不属于当前业务对象");
    }
    if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    if (asset.status === "deleted") return { fileAssetId, status: "deleted" as const };

    if (asset.storageProvider !== "local_mock") {
      try {
        const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never, { requireLiveTest: false });
        if (!config || !(await this.deleteObject(config, asset.storageKey, new Date()))) throw new ServiceUnavailableException("对象存储未确认删除文件");
      } catch {
        await this.prisma.fileAsset.updateMany({
          where: { id: fileAssetId, tenantId, status: { in: ["active", "delete_pending"] } },
          data: { status: "delete_pending" }
        });
        await this.operationLog?.record({ tenantId, action: "file.delete.pending", targetType: "file", targetId: fileAssetId, detail: "对象存储删除待重试", metadata: { provider: asset.storageProvider } });
        throw new ServiceUnavailableException("对象存储暂不可用，文件删除已进入重试队列");
      }
    }
    await this.prisma.fileAsset.updateMany({
      where: { id: fileAssetId, tenantId, status: { in: ["active", "delete_pending"] } },
      data: { status: "deleted" }
    });
    await this.operationLog?.record({ tenantId, action: "file.delete", targetType: "file", targetId: fileAssetId, detail: "删除业务文件", metadata: { provider: asset.storageProvider } });
    return { fileAssetId, status: "deleted" as const };
  }

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
        confirmed = await this.deleteObject(config, asset.storageKey, new Date());
      } else {
        const signed = this.presign(config, 'HEAD', asset.storageKey, asset.mimeType, new Date(Date.now() + 60000));
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

  /** Reclaim only the staging object proved by a completed freeze receipt.
   * cleanupError holds the fixed pending/unknown marker; the upload remains
   * completed and its active evidence is never invalidated by cleanup failure. */
  private async cleanupCompletedStagingObjects(tenantId: string, limit: number): Promise<FileUploadCleanupSummary> {
    return this.cleanup.cleanupCompletedStagingObjects(tenantId, limit);
  }

  /**
   * 未完成的过期上传先抢占 cleanup_in_progress，再删临时对象并标记 failed。
   * 已完成上传另读原冻结收据回收临时对象，保持 completed/正式证据不变；
   * freeze_pending 不进入任何过期清理，未知冻结仍只能核对原结果。
   */
  async cleanupExpiredUploadSessions(tenantId: string, limit = 50): Promise<FileUploadCleanupSummary> {
    return this.cleanup.cleanupExpiredUploadSessions(tenantId, limit);
  }

  /**
   * 常驻进程的跨租户清理入口。它不接受请求传入的租户范围，租户集合只从
   * 上传会话表读取；每个租户仍由 cleanupExpiredUploadSessions 再次带 tenantId
   * 查询和抢占，不能因为某个租户的 provider 配置异常而影响其他租户。
   */
  async cleanupExpiredUploadSessionsForAllTenants(limitPerTenant = 50): Promise<FileUploadCleanupSummary> {
    const tenants = await this.prisma.fileUploadSession.findMany({
      select: { tenantId: true },
      distinct: ["tenantId"],
      orderBy: { tenantId: "asc" },
      take: 1000
    });
    const summary: FileUploadCleanupSummary = {
      scanned: 0,
      invalidated: 0,
      deletedObjects: 0,
      cleanupPending: 0,
      sessionIds: []
    };
    for (const tenant of tenants) {
      try {
        const current = await this.cleanupExpiredUploadSessions(tenant.tenantId, limitPerTenant);
        summary.scanned += current.scanned;
        summary.invalidated += current.invalidated;
        summary.deletedObjects += current.deletedObjects;
        summary.cleanupPending += current.cleanupPending;
        summary.sessionIds.push(...current.sessionIds);
      } catch {
        // 单租户配置/网络异常只保留该租户会话待下一轮处理，不能停掉全局清理循环。
      }
    }
    return summary;
  }

  /** 删除业务记录已经从页面移除、但 provider 暂时不可达的文件。 */
  async cleanupPendingFileAssetDeletes(tenantId: string, limit = 50) {
    return this.cleanup.cleanupPendingFileAssetDeletes(tenantId, limit);
  }

  async cleanupPendingFileAssetDeletesForAllTenants(limitPerTenant = 50) {
    const tenants = await this.prisma.fileAsset.findMany({
      where: { status: { in: ["delete_pending", "delete_in_progress"] } },
      select: { tenantId: true },
      distinct: ["tenantId"],
      orderBy: { tenantId: "asc" },
      take: 1000
    });
    let scanned = 0;
    let deleted = 0;
    let pending = 0;
    for (const tenant of tenants) {
      try {
        const result = await this.cleanupPendingFileAssetDeletes(tenant.tenantId, limitPerTenant);
        scanned += result.scanned;
        deleted += result.deleted;
        pending += result.pending;
      } catch {
        // 一个租户的 provider 配置异常不能阻断其他租户的文件清理。
      }
    }
    return { scanned, deleted, pending };
  }

  /** Original employee upload metadata under the existing file/business ACL.
   * Expiry or absence never grants another PUT, completion, or changed key.
   * No provider configuration, object request, signing or mutation is used. */
  async observeStaffUpload(tenantId: string, value: StaffUploadObservationRequest,
    valueOwner: FileBusinessOwner): Promise<StaffUploadObservationResponse> {
    const input = parseStaffUploadObservation(value), owner = structuredClone(valueOwner), access = this.fileAccess;
    const file = { ...input.file, fileName: input.file.fileName.trim(), mimeType: input.file.mimeType.trim().toLowerCase() };
    if (!access || !owner?.workspaceId || !owner.actorUserId || owner.businessType !== file.businessType
      || owner.businessId !== file.businessId || owner.uploadScene !== file.uploadScene
      || (file.uploadScene === 'work-order-evidence') !== (file.businessType === 'rental_work_order')) {
      throw new ForbiddenException('原员工上传观察归属不可用');
    }
    const currentOwner = () => {
      const identity = getRequestIdentity();
      if (!identity || identity.isSaasAdmin || identity.audience !== 'staff' || identity.staffApi !== true
        || identity.tenantId !== tenantId || identity.workspaceId !== owner.workspaceId || identity.userId !== owner.actorUserId) {
        throw new ForbiddenException('原员工上传观察身份已变化');
      }
      return access.authorityKey(tenantId);
    };
    const authority = currentOwner();
    const current = () => { if (currentOwner() !== authority) throw new ForbiddenException('原员工上传观察权限已变化'); };
    const load = async () => {
      current();
      const session = await this.prisma.fileUploadSession.findFirst({ where: 'sessionId' in input.reference
        ? { tenantId, id: input.reference.sessionId } : { tenantId, idempotencyKey: input.reference.idempotencyKey } });
      if (!session) return null;
      const asset = await this.prisma.fileAsset.findFirst({ where: { tenantId, id: session.fileAssetId } });
      const metadata = asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
        ? asset.metadata as JsonRecord : null;
      // A tenant-wide unique-key hit must not disclose another employee's or
      // workspace's upload, even when its business object is otherwise visible.
      if (!asset || !metadata || asset.uploadedBy !== owner.actorUserId || metadata.workspaceId !== owner.workspaceId
        || metadata.source !== 'staff-miniprogram') return null;
      const mimeType = this.validateInput({ ...file, idempotencyKey: session.idempotencyKey ?? '' });
      if (!this.matchesOwner(asset, owner) || !this.matchesUploadRequest(asset, { ...file, idempotencyKey: session.idempotencyKey ?? '' }, mimeType)
        || session.tenantId !== tenantId || asset.tenantId !== tenantId || session.fileAssetId !== asset.id
        || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey
        || ('sessionId' in input.reference ? session.id !== input.reference.sessionId : session.idempotencyKey !== input.reference.idempotencyKey)) {
        throw new ConflictException('原上传会话与文件描述不一致');
      }
      if (['pickup-evidence', 'return-evidence', 'handover-signature'].includes(file.uploadScene)) {
        const stage = file.uploadScene === 'pickup-evidence' ? 'pickup' : file.uploadScene === 'return-evidence' ? 'return' : file.metadata?.handoverStage;
        if (!stage || !file.metadata?.handoverBatchId || metadata.handoverStage !== stage
          || metadata.handoverBatchId !== file.metadata.handoverBatchId
          || file.metadata.handoverStage !== undefined && file.metadata.handoverStage !== stage) {
          throw new ConflictException('原上传交接阶段或批次不一致');
        }
      }
      if (!['pending_upload', 'freeze_pending', 'completed', 'failed'].includes(session.status)
        || !['pending_upload', 'active', 'failed', 'delete_pending', 'deleted'].includes(asset.status)
        || ['pending_upload', 'freeze_pending'].includes(session.status) && asset.status !== 'pending_upload'
        || session.status === 'completed' && !['active', 'delete_pending', 'deleted'].includes(asset.status)
        || session.status === 'failed' && !['failed', 'deleted'].includes(asset.status)
        || !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime())
        || session.completedAt != null && (!(session.completedAt instanceof Date) || !Number.isFinite(session.completedAt.getTime()))) {
        throw new ServiceUnavailableException('原上传状态暂不可核对');
      }
      return { session, asset };
    };
    const before = structuredClone(await load());
    if (before) await access.assertRead(tenantId, before.asset);
    current();
    const after = await load();
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException('原上传观察期间记录已变化');
    if (after) await access.assertRead(tenantId, after.asset);
    current();
    const semantics = { reference: structuredClone(input.reference), descriptionHash: requestFingerprint(file),
      observation: 'stored_metadata_not_transfer_proof' as const, retryable: false as const,
      uploadGrant: 'not_provided' as const, nextAction: 'read_original_upload' as const };
    if (!before) return { ...semantics, state: 'not_observed', session: null };
    return { ...semantics, state: 'observed', session: {
      sessionId: before.session.id, fileAssetId: before.asset.id,
      status: before.session.status as StaffUploadObservedSession['status'],
      fileStatus: before.asset.status as StaffUploadObservedSession['fileStatus'],
      mode: before.session.provider === 'local_mock' ? 'simulation' : 'provider',
      expiresAt: before.session.expiresAt.toISOString(), completedAt: before.session.completedAt?.toISOString() ?? null,
    } };
  }

  /** Current-authorized observation of the original knowledge upload only.
   * Never creates a session, signs a URL, checks object storage, or completes it. */
  async readKnowledgeUpload(tenantId: string, sessionId: string, owner: FileBusinessOwner): Promise<FileUploadSessionSummary> {
    const boundOwner = structuredClone(owner);
    if (boundOwner?.businessType !== 'ai_knowledge_document' || !boundOwner.actorUserId || !boundOwner.workspaceId)
      throw new NotFoundException('知识上传归属不可用');
    const load = async () => {
      const session = await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
      const asset = session && await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } });
      if (!session || !asset || !this.matchesOwner(asset, boundOwner)) throw new NotFoundException('知识上传会话不可用');
      this.assertKnowledgeUploadAsset(asset, boundOwner);
      if (asset.businessModule !== 'ai-native' || session.fileAssetId !== asset.id || session.provider !== asset.storageProvider
        || session.storageKey !== asset.storageKey || session.tenantId !== tenantId)
        throw new ConflictException('知识上传关联已变化');
      if (!(['pending_upload', 'freeze_pending'].includes(session.status) && asset.status === 'pending_upload'
        || session.status === 'completed' && asset.status === 'active'
        || session.status === 'failed' && asset.status === 'failed')) throw new ConflictException('知识上传状态不可用');
      return { session, asset };
    };
    const before = structuredClone(await load());
    const input: CreateFileUploadSessionRequest = { businessModule: before.asset.businessModule,
      businessType: before.asset.businessType, businessId: before.asset.businessId ?? '', uploadScene: before.asset.uploadScene,
      fileName: before.asset.fileName, mimeType: before.asset.mimeType, sizeBytes: before.asset.sizeBytes,
      idempotencyKey: before.session.idempotencyKey ?? '' };
    await this.authorizeKnowledgeUpload(tenantId, input, boundOwner);
    if (requestFingerprint(before) !== requestFingerprint(await load())) throw new ConflictException('知识上传观察期间已变化');
    await this.authorizeKnowledgeUpload(tenantId, input, boundOwner);
    if (requestFingerprint(before) !== requestFingerprint(await load())) throw new ConflictException('知识上传观察期间已变化');
    return this.sessionSummary(before.session, before.asset, 'provider');
  }

  /** Exact original upload lookup after a lost first response, including after
   * its intent expires or the document is created/revised. No new URL, storage
   * access or re-upload grant; a missing row is only an unknown observation. */
  async findKnowledgeUpload(tenantId: string, value: CreateFileUploadSessionRequest, valueOwner: FileBusinessOwner,
    revision?: { expectedRevision: number; targetVersion: string }): Promise<FileUploadSessionSummary | null> {
    const input = structuredClone(value), owner = structuredClone(valueOwner), selected = structuredClone(revision);
    if (input.businessModule !== 'ai-native' || input.businessType !== 'ai_knowledge_document' || input.uploadScene !== 'ai-knowledge'
      || !input.idempotencyKey || owner?.businessId !== input.businessId || owner.businessType !== input.businessType
      || owner.uploadScene !== input.uploadScene || !owner.workspaceId || !owner.actorUserId
      || !this.knowledgeFiles?.authorizeUploadObservation) throw new NotFoundException('知识上传观察权威不可用');
    if (input.idempotencyKey !== knowledgeUploadKey(input.businessId, selected?.targetVersion)) throw new BadRequestException('原知识上传键不匹配');
    const mimeType = this.validateInput(input);
    const authorize = () => this.knowledgeFiles!.authorizeUploadObservation!(tenantId, structuredClone(owner));
    await authorize();
    const load = async () => {
      // This is the existing tenant/idempotency unique key, not a latest-upload
      // scan. Request values never select a foreign tenant, actor or workspace.
      const session = await this.prisma.fileUploadSession.findFirst({ where: { tenantId, idempotencyKey: input.idempotencyKey } });
      if (!session) return null;
      const asset = await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } });
      const metadata = asset?.metadata as JsonRecord | null | undefined;
      // A tenant-wide key hit is not evidence the current owner may learn that
      // another actor/workspace has an upload. Do not expose its existence.
      if (!asset || asset.uploadedBy !== owner.actorUserId || metadata?.workspaceId !== owner.workspaceId) return null;
      if (!asset || !this.matchesOwner(asset, owner) || !this.matchesUploadRequest(asset, input, mimeType)
        || session.tenantId !== tenantId || session.idempotencyKey !== input.idempotencyKey
        || session.fileAssetId !== asset.id || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey)
        throw new ConflictException('原知识上传请求不匹配');
      const parsed = metadata?.knowledgeRevision === undefined ? undefined : knowledgeUploadRevisionSchema.safeParse(metadata.knowledgeRevision);
      if (selected ? !parsed?.success || parsed.data.expectedRevision !== selected.expectedRevision || parsed.data.targetVersion !== selected.targetVersion
        : parsed !== undefined) throw new ConflictException('原知识上传版本不匹配');
      this.assertKnowledgeUploadAsset(asset, { ...owner, ...(parsed?.success ? { knowledgeRevision: parsed.data } : {}) });
      if (!(['pending_upload', 'freeze_pending'].includes(session.status) && asset.status === 'pending_upload' || session.status === 'completed' && asset.status === 'active'
        || session.status === 'failed' && asset.status === 'failed')) throw new ConflictException('原知识上传状态不可用');
      return { session, asset };
    };
    const before = structuredClone(await load());
    await authorize();
    if (requestFingerprint(before) !== requestFingerprint(await load())) throw new ConflictException('原知识上传观察期间已变化');
    await authorize();
    return before ? this.sessionSummary(before.session, before.asset, 'provider') : null;
  }

  async completeUpload(
    tenantId: string,
    sessionId: string,
    input: CompleteFileUploadRequest,
    owner?: FileBusinessOwner
  ) {
    input = structuredClone(input); owner = structuredClone(owner);
    let session = structuredClone(await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } }));
    if (!session) throw new NotFoundException("上传会话不存在");
    let asset = structuredClone(await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } }));
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("专用换货影像只能核验原业务完成入口");
    if (asset?.uploadScene === ENTERPRISE_PAYMENT_PROOF_SCENE && (!owner?.enterprisePaymentProof || owner.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE
      || (asset.metadata as JsonRecord | null)?.workspaceId !== owner.workspaceId
      || fileFactHash((asset.metadata as JsonRecord | null)?.enterprisePaymentProof ?? null) !== fileFactHash(owner.enterprisePaymentProof))) {
      throw new BadRequestException("费用回款凭证只能经原企业订单入口核验归档");
    }
    if (!asset || (owner && (!this.matchesOwner(asset, owner) || (owner.actorUserId && asset.uploadedBy !== owner.actorUserId)))) throw new NotFoundException("上传会话不存在或不属于当前业务对象");
    const knowledgeInput: CreateFileUploadSessionRequest | undefined = asset.businessType === 'ai_knowledge_document' ? {
      businessModule: asset.businessModule, businessType: asset.businessType, businessId: asset.businessId ?? '', uploadScene: asset.uploadScene,
      fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, idempotencyKey: session.idempotencyKey ?? '' } : undefined;
    if (knowledgeInput) {
      owner = structuredClone(owner);
      this.assertKnowledgeUploadAsset(asset, owner);
      if (session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey || session.fileAssetId !== asset.id) throw new ConflictException('知识上传绑定已变化');
      await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
    } else if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    if (session.status === "completed") {
      if (asset.status !== 'active') throw new ConflictException('上传结果不可用');
      if (session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey) throw new ConflictException("原已完成文件绑定不一致");
      if ((asset.metadata as JsonRecord | null)?.fileUploadVersion === 2 && input.checksum?.trim() && input.checksum.trim() !== asset.checksum) {
        throw new ConflictException("原完成收据与文件摘要不一致，不能重写内容");
      }
      if (knowledgeInput) await this.assertKnowledgeBinding(tenantId, asset.id, owner!, owner?.knowledgeRevision ? {
        documentVersion: owner.knowledgeRevision.targetVersion, expectedRevision: owner.knowledgeRevision.expectedRevision } : undefined);
      return this.assetSummary(asset);
    }
    const resumingFreeze = session.status === "freeze_pending" && asset.status === "pending_upload"
      && (asset.metadata as JsonRecord | null)?.fileUploadVersion === 2;
    if (session.status !== "pending_upload" && !resumingFreeze) throw new ConflictException("上传会话已失效");
    if (!resumingFreeze && session.expiresAt.getTime() <= Date.now()) {
      await this.failSession(tenantId, session.id, "上传会话已过期");
      throw new ConflictException("上传会话已过期，请重新上传");
    }
    if (session.provider === "local_mock" && process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("生产环境禁止完成模拟文件上传，请先配置并验证文件存储平台");
    }
    // The client receives only a staging PUT. Read those actual bounded bytes,
    // then write a fresh server-only destination; no original PUT can alter it.
    let frozen: { storageKey: string; checksum: string; config: TenantIntegrationRuntimeConfig } | undefined;
    if (session.provider !== "local_mock") {
      const config = await this.integrations.runtimeConfig("file", tenantId, session.provider as never, { requireLiveTest: false });
      if (!config) throw new ConflictException("原上传缺少有效临时对象或文件配置依据，不能确认完成");
      const pendingAsset = asset;
      const result = await freezeFileUploadContent<
        Prisma.FileAssetGetPayload<object>, Prisma.FileUploadSessionGetPayload<object>, Prisma.TransactionClient
      >({ tenantId, asset, session, config, checksum: input.checksum }, {
        transaction: work => this.prisma.$transaction(work),
        beforeClaim: async () => {
          if (knowledgeInput) await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
        },
        assertConfiguration: (tx, currentConfig) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", currentConfig.provider,
          { configRevision: currentConfig.revision }),
        readContent: (currentConfig, storageKey, mimeType, sizeBytes) => this.readObjectContent(currentConfig, storageKey, mimeType, sizeBytes),
        writeContent: (currentConfig, storageKey, mimeType, bytes) => {
          const signed = this.presign(currentConfig, "PUT", storageKey, mimeType, new Date(Date.now() + 60_000));
          return this.objectRequest(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(bytes) });
        },
        ...(knowledgeInput ? { readPendingContent: async () => {
          const content = await this.knowledgeFiles?.readUploadContent?.(tenantId, pendingAsset.id, owner!);
          if (!content || !(content.bytes instanceof Uint8Array) || content.bytes.byteLength !== pendingAsset.sizeBytes)
            throw new ServiceUnavailableException("知识上传原字节读取未配置或不可用");
          return content;
        } } : {})
      });
      asset = result.asset;
      session = result.session;
      frozen = result.frozen;
    }
    let knowledgeContentHash: string | undefined;
    if (knowledgeInput) {
      if (!frozen) throw new ServiceUnavailableException('知识上传正式内容冻结证据未配置');
      knowledgeContentHash = frozen.checksum;
    }
    const metadata = {
      ...((asset.metadata ?? {}) as JsonRecord),
      completedAt: new Date().toISOString(),
      ...(knowledgeContentHash ? { knowledgeContentHash } : {}),
      ...(frozen ? { fileContentVersion: 1, contentHash: frozen.checksum } : {}),
      ...(input.checksum?.trim() ? { clientChecksum: input.checksum.trim() } : {})
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      if (frozen) {
        await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", frozen.config.provider, { configRevision: frozen.config.revision });
        const [currentAsset, currentSession] = await Promise.all([
          tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
          tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } })
        ]);
        if (requestFingerprint(currentAsset) !== requestFingerprint(asset) || requestFingerprint(currentSession) !== requestFingerprint(session)) {
          throw new ConflictException("文件或原上传会话在内容冻结期间已变化");
        }
        if (!knowledgeInput) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId);
      }
      if (knowledgeInput) {
        await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
        const [currentAsset, currentSession] = await Promise.all([
          tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
          tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } })
        ]);
        const stable = (row: unknown) => JSON.stringify(row);
        if (stable(currentAsset) !== stable(asset) || stable(currentSession) !== stable(session))
          throw new ConflictException('知识上传绑定在读取正文后已变化');
      }
      const sessionClaim = await tx.fileUploadSession.updateMany({
        where: { id: session.id, tenantId, status: frozen ? "freeze_pending" : "pending_upload",
          ...(knowledgeInput || frozen ? { updatedAt: session.updatedAt, fileAssetId: asset.id,
            provider: asset.storageProvider, storageKey: asset.storageKey } : {}) },
        data: { status: "completed", completedAt: new Date(), failureReason: null,
          ...(frozen ? { storageKey: frozen.storageKey, cleanupError: COMPLETED_STAGING_PENDING } : {}) }
      });
      if (sessionClaim.count !== 1) throw new ConflictException("上传会话已失效，请重新上传");
      const assetClaim = await tx.fileAsset.updateMany({
        where: { id: asset.id, tenantId, status: "pending_upload",
          ...(knowledgeInput || frozen ? { updatedAt: asset.updatedAt, storageProvider: asset.storageProvider,
            storageKey: asset.storageKey, uploadedBy: asset.uploadedBy } : {}) },
        data: { status: "active", metadata: metadata as Prisma.InputJsonValue,
          ...(frozen ? { storageKey: frozen.storageKey, checksum: frozen.checksum } : {}) }
      });
      if (assetClaim.count !== 1) throw new ConflictException("上传文件已失效，请重新上传");
      return tx.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    });
    if (knowledgeInput) {
      await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
      await this.assertKnowledgeBinding(tenantId, asset.id, owner!, owner?.knowledgeRevision ? {
        documentVersion: owner.knowledgeRevision.targetVersion, expectedRevision: owner.knowledgeRevision.expectedRevision } : undefined);
    }
    return this.assetSummary(updated);
  }

  /** Merchant application evidence is read through the authenticated controller,
   * not a reusable bearer download URL. The controller rechecks its reviewer. */
  async readAuthorityBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string) {
    return this.readEnterpriseEvidenceBytes(tenantId, fileAssetId, applicantCustomerId, { businessType: "customer", businessId: applicantCustomerId, uploadScene: "enterprise-authority" });
  }

  async readPaymentProofBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, orderId: string, workspaceId: string, contentHash: string) {
    if (!workspaceId || !orderId || !/^[a-f0-9]{64}$/u.test(contentHash)) throw new BadRequestException("原费用回款凭证字节绑定无效");
    return this.readEnterpriseEvidenceBytes(tenantId, fileAssetId, applicantCustomerId,
      { businessType: "rental_order", businessId: orderId, workspaceId, uploadScene: ENTERPRISE_PAYMENT_PROOF_SCENE }, contentHash);
  }

  private async readEnterpriseEvidenceBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, owner: FileBusinessOwner, contentHash?: string) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { tenantId, id: fileAssetId, businessType: owner.businessType, businessId: owner.businessId, uploadedBy: applicantCustomerId, uploadScene: owner.uploadScene, status: "active" }, include: { uploadSession: true } });
    if (!asset || asset.storageProvider === "local_mock" || asset.uploadSession?.status !== "completed" || !asset.uploadSession.completedAt
      || !["application/pdf", "image/png", "image/jpeg"].includes(asset.mimeType) || asset.sizeBytes < 1 || asset.sizeBytes > MAX_FILE_BYTES) throw new NotFoundException("授权材料未真实归档或不属于当前申请");
    if (owner.uploadScene === ENTERPRISE_PAYMENT_PROOF_SCENE && (asset.businessModule !== "enterprise" || asset.checksum !== contentHash
      || (asset.metadata as JsonRecord | null)?.workspaceId !== owner.workspaceId || (asset.metadata as JsonRecord | null)?.fileUploadVersion !== 2
      || (asset.metadata as JsonRecord | null)?.fileContentVersion !== 1 || (asset.metadata as JsonRecord | null)?.contentHash !== contentHash
      || asset.uploadSession.provider !== asset.storageProvider || asset.uploadSession.storageKey !== asset.storageKey)) throw new ConflictException("原费用回款凭证冻结内容不可核对");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config) throw new ServiceUnavailableException("授权材料存储不可用");
    if (contentHash && (asset.metadata as JsonRecord | null)?.storageLocationHash !== this.retentionLocationHash(config)) throw new ConflictException("原费用回款凭证存储位置已变化");
    const signed = this.presign(config, "GET", asset.storageKey, asset.mimeType, new Date(Date.now() + 60000));
    const target = await assertOutboundUrl(signed.url, "授权材料存储地址", { allowQuery: true });
    const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) throw new ServiceUnavailableException("授权材料读取失败");
    const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > asset.sizeBytes || size > MAX_FILE_BYTES) throw new BadRequestException("授权材料超过登记大小");
        chunks.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const after = await this.prisma.fileAsset.findFirst({ where: { tenantId, id: asset.id, status: "active", updatedAt: asset.updatedAt, storageKey: asset.storageKey } });
    if (!after || size !== asset.sizeBytes) throw new ConflictException("读取期间授权材料已变化或不完整");
    const content = Buffer.concat(chunks);
    if (contentHash && createHash("sha256").update(content).digest("hex") !== contentHash) throw new ConflictException("原费用回款凭证读取字节与冻结摘要不一致");
    const signatures = asset.mimeType === "application/pdf" ? content.subarray(0, 5).toString("ascii") === "%PDF-"
      : asset.mimeType === "image/png" ? content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : content[0] === 255 && content[1] === 216 && content[2] === 255;
    if (!signatures) throw new BadRequestException("授权材料格式与登记类型不匹配");
    return { mimeType: asset.mimeType, content };
  }

  async downloadUrl(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner): Promise<FileDownloadUrlSummary> {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } });
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new ServiceUnavailableException("专用换货影像必须按原业务权限和内容指纹读取，不签发下载URL");
    if (asset?.businessType === 'ai_knowledge_document') throw new ServiceUnavailableException('知识附件必须经当前文档权限读取，不签发下载URL');
    if (asset?.uploadScene === 'enterprise-authority') throw new ServiceUnavailableException('企业授权材料必须经当前申请及审核权限读取，不签发可复用下载URL');
    if (asset?.uploadScene === ENTERPRISE_PAYMENT_PROOF_SCENE) throw new ServiceUnavailableException('费用回款凭证须经原申请与当前财务权限读取');
    if (asset && owner && (!this.matchesOwner(asset, owner) || (owner.actorUserId && asset.uploadedBy !== owner.actorUserId))) throw new NotFoundException("文件不存在或不属于当前业务对象");
    if (!asset) throw new NotFoundException("文件不存在或尚未完成上传");
    if (asset.businessType === "customer" && asset.uploadScene === "identity-verification"
      && (owner?.businessType !== "customer" || !owner.businessId || owner.uploadScene !== "identity-verification")) {
      throw new NotFoundException("文件不存在或不属于当前授权的客户实名核验资料");
    }
    if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    if (!this.fileAccess || !this.operationLog) throw new ServiceUnavailableException("文件业务读取权威或访问审计未配置");
    return issueFileDownloadReference({ tenantId, fileAssetId, asset }, {
      access: this.fileAccess,
      recordAudit: input => this.operationLog!.record(input),
      readAsset: () => this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } }),
      runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never),
      allowSimulation: process.env.NODE_ENV !== "production",
      signGet: (config, storageKey, mimeType, expiresAt) => this.presign(config, "GET", storageKey, mimeType, expiresAt)
    });
  }

  async readKnowledgeBytes(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, maxBytes: number, signal?: AbortSignal) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('非URL受控知识文件读取未配置');
    return this.knowledgeFiles.read(tenantId, fileAssetId, owner, maxBytes, signal);
  }

  async readInspectionBytes(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, maxBytes: number, signal: AbortSignal) {
    if (!owner.workspaceId || !owner.actorUserId || owner.businessType !== 'rental_order' || !owner.businessId
      || !['pickup-evidence', 'return-evidence'].includes(owner.uploadScene ?? '')
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) throw new BadRequestException('检查证据读取参数无效');
    if (!this.inspectionObjectReader) throw new ServiceUnavailableException('非URL受控检查存储读取未配置');
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: 'active', uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    if (!asset || !this.matchesOwner(asset, owner) || asset.uploadSession?.status !== 'completed' || !asset.uploadSession.completedAt
      || asset.uploadSession.tenantId !== tenantId || asset.uploadSession.storageKey !== asset.storageKey) throw new NotFoundException('检查附件不属于当前业务或未完成上传');
    await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? '', owner.workspaceId);
    if (asset.storageProvider === 'local_mock' || !await this.integrations.runtimeConfig('file', tenantId, asset.storageProvider as never, { requireLiveTest: false })) {
      throw new ServiceUnavailableException('检查附件没有可用的持久存储配置');
    }
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 8000);
    try {
      if (signal.aborted) controller.abort();
      if (controller.signal.aborted) throw new ServiceUnavailableException('检查读取已取消');
      let rejectOpening: () => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectOpening = () => reject(new ServiceUnavailableException('检查读取已取消'));
        controller.signal.addEventListener('abort', rejectOpening, { once: true });
      });
      const opening = this.inspectionObjectReader.open({ tenantId, workspaceId: owner.workspaceId, fileAssetId,
        provider: asset.storageProvider, storageKey: asset.storageKey }, controller.signal).then(async stream => {
        if (controller.signal.aborted) { await stream.cancel().catch(() => undefined); throw new ServiceUnavailableException('检查读取已取消'); }
        return stream;
      });
      let stream: ReadableStream<Uint8Array>;
      try { stream = await Promise.race([opening, aborted]); }
      finally { controller.signal.removeEventListener('abort', rejectOpening); }
      const result = await readInspectionMedia(stream, maxBytes, controller.signal);
      if (result.mediaType !== asset.mimeType.split(';', 1)[0].trim().toLowerCase()) throw new BadRequestException('检查附件实际格式与登记类型不同');
      const after = await this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId, status: 'active', updatedAt: asset.updatedAt, uploadedBy: owner.actorUserId } });
      if (!after || after.storageKey !== asset.storageKey) throw new ConflictException('读取期间附件已变化');
      if (controller.signal.aborted) throw new ServiceUnavailableException('检查读取已取消');
      return result;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }

  async assertKnowledgeBinding(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, target?: { documentVersion: string; expectedRevision: number }) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('知识文件绑定权威未配置');
    return this.knowledgeFiles.assertBound(tenantId, fileAssetId, owner, target);
  }

  private async authorizeKnowledgeUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner?: FileBusinessOwner) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('知识首建上传权威未配置');
    await this.knowledgeFiles.authorizeUpload(tenantId, input, owner);
  }

  private assertKnowledgeUploadAsset(asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner) {
    const metadata = asset.metadata;
    if (!owner?.actorUserId || !owner.workspaceId || asset.uploadedBy !== owner.actorUserId || asset.storageProvider === 'local_mock'
      || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.workspaceId !== owner.workspaceId
      || metadata.knowledgeUploadVersion !== 1
      || requestFingerprint(metadata.knowledgeRevision ?? null) !== requestFingerprint(owner.knowledgeRevision ?? null)) throw new NotFoundException('知识上传不属于当前主体和空间');
  }

  private async knowledgeUploadSummary(tenantId: string, input: CreateFileUploadSessionRequest,
    session: Prisma.FileUploadSessionGetPayload<object>, asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner) {
    session = structuredClone(session); asset = structuredClone(asset);
    this.assertKnowledgeUploadAsset(asset, owner);
    await this.authorizeKnowledgeUpload(tenantId, input, owner);
    if (session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey || session.fileAssetId !== asset.id
      || session.tenantId !== tenantId || session.idempotencyKey !== input.idempotencyKey) throw new ConflictException('知识上传绑定已变化');
    if (session.status === 'completed' && asset.status === 'active' || session.status === 'freeze_pending' && asset.status === 'pending_upload') {
      return this.sessionSummary(session, asset, 'provider');
    }
    if (session.status !== 'pending_upload' || asset.status !== 'pending_upload' || session.expiresAt.getTime() <= Date.now()) throw new ConflictException('知识上传需按原会话核对');
    const config = await this.integrations.runtimeConfig('file', tenantId, session.provider as never);
    if (!config || (asset.metadata as JsonRecord | null)?.fileUploadVersion !== 2
      || (asset.metadata as JsonRecord | null)?.uploadConfigHash !== requestFingerprint({ id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials })) {
      throw new ServiceUnavailableException('知识文件原临时对象或配置依据不可用');
    }
    await this.authorizeKnowledgeUpload(tenantId, input, owner);
    const signed = this.presign(config, 'PUT', this.pendingObjectKey(asset.storageKey), asset.mimeType, session.expiresAt);
    await this.authorizeKnowledgeUpload(tenantId, input, owner);
    const [currentSession, currentAsset, currentConfig] = await Promise.all([
      this.prisma.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }),
      this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
      this.integrations.runtimeConfig('file', tenantId, session.provider as never)
    ]);
    if (requestFingerprint(currentSession) !== requestFingerprint(session) || requestFingerprint(currentAsset) !== requestFingerprint(asset)
      || !currentConfig || requestFingerprint(currentConfig) !== requestFingerprint(config) || session.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('知识原上传在签发期间已变化');
    }
    return { ...this.sessionSummary(session, asset, 'provider'), uploadUrl: signed.url, uploadHeaders: signed.headers };
  }

  /** Recover only the original still-pending upload grant. Terminal observations
   * never issue PUT credentials, and config changes cannot rebind an old key. */
  private async originalUploadSummary(tenantId: string, session: Prisma.FileUploadSessionGetPayload<object>,
    asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner) {
    session = structuredClone(session); asset = structuredClone(asset);
    return readOriginalFileUploadReceipt({ tenantId, session, asset, owner }, {
      isTenantSharedBinding: file => ["customer", "customer_profile", "membership_review"].includes(file.businessType),
      assertBusinessReference: () => this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId),
      runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId, session.provider as never, { requireLiveTest: false }),
      readSession: () => this.prisma.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }),
      readAsset: () => this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
      signPendingPut: (config, storageKey, mimeType, expiresAt) => this.presign(config, "PUT", storageKey, mimeType, expiresAt)
    });
  }

  private matchesUploadRequest(
    asset: { businessModule: string; businessType: string; businessId: string | null; fileName: string; mimeType: string; sizeBytes: number; uploadScene: string; metadata?: unknown },
    input: CreateFileUploadSessionRequest,
    mimeType: string
  ) {
    return asset.businessModule === input.businessModule.trim()
      && asset.businessType === input.businessType.trim()
      && asset.businessId === input.businessId.trim()
      && asset.fileName === input.fileName.trim()
      && asset.mimeType === mimeType
      && asset.sizeBytes === input.sizeBytes
      && asset.uploadScene === input.uploadScene.trim()
      && (asset.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE
        || fileFactHash((asset.metadata as JsonRecord | null)?.enterprisePaymentProof ?? null) === fileFactHash(input.metadata?.enterprisePaymentProof ?? null));
  }

  private async assertBusinessReference(tenantId: string, businessType: string, businessId: string, workspaceId?: string) {
    return this.fileReferences.assertExists(tenantId, businessType, businessId, workspaceId);
  }

  private async failSession(tenantId: string, sessionId: string, reason: string) {
    await this.prisma.$transaction([
      this.prisma.fileUploadSession.updateMany({ where: { id: sessionId, tenantId, status: "pending_upload" }, data: { status: "failed", failureReason: reason, cleanupError: "待执行过期对象清理" } }),
      this.prisma.fileAsset.updateMany({ where: { tenantId, uploadSession: { is: { id: sessionId } }, status: "pending_upload" }, data: { status: "failed" } })
    ]);
  }
}
