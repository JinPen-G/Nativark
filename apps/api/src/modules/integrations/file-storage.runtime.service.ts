/** 原组合文件编排。公共创建、原回执、字节、内容冻结、按租户清理、读取签名和文件表由platform-server维护，Rental引用与ACL由Rental包提供。
 * 专用检查、知识与企业证据沿原入口和原冻结/unknown收据，不以通用存储替代业务授权。 */
import { FileStoragePrimitives, FileStorageRepository, MAX_FILE_BYTES, freezeFileUploadContent, createOriginalFileUploadFacts, readOriginalFileUploadReceipt, FileStorageCleanup, COMPLETED_STAGING_PENDING, issueFileDownloadReference, FileStorageApplication } from "@rental-os/platform-server/files";
import { RentalFileBusinessReferences } from "@rental-os/rental-core/file-access";
import { RentalExchangeInspectionFileStorage, type RentalExchangeInspectionStoragePlan } from "@rental-os/rental-core/file-application-exchange-inspection";
import { RentalEvidenceFileStorage } from "@rental-os/rental-core/file-application-rental-evidence";
import { RentalStaffUploadObservation } from "@rental-os/rental-core/file-application-staff-observation";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Optional, ServiceUnavailableException } from "@nestjs/common";
import { INSPECTION_OBJECT_READER, readInspectionMedia, type InspectionObjectReader } from "../ai-native/inspection-assist/inspection-media.reader";
import { KNOWLEDGE_FILE_ACCESS, type KnowledgeFileAccess } from "../ai-native/knowledge/knowledge-file-access";
import type { KnowledgeUploadRevision } from "../ai-native/knowledge/knowledge.ports";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { ENTERPRISE_PAYMENT_PROOF_SCENE, RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "@rental-os/shared";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  CompleteFileUploadRequest,
  CreateFileUploadSessionRequest,
  FileAssetSummary,
  FileUploadCleanupSummary,
  FileDownloadUrlSummary,
  FileUploadSessionSummary,
  StaffUploadObservationRequest, StaffUploadObservationResponse
} from "@rental-os/shared";
import { parseStaffUploadObservation } from './file-upload.dto';
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { FileBusinessAccessService } from "../files/file-business-access.service";
import { OperationLogService } from "../../common/operation-log.service";
import { getRequestIdentity } from "../../common/request-identity";
import { fetchObjectStorageWithTimeout as fetchWithTimeout } from "@rental-os/platform-server/object-storage";
import { fileStorageLocationHash } from "./file-content-binding";
import { aiRetentionObjectHash } from "../ai-native/privacy/retention-binding";
import { AI_RETENTION_POLICY } from "../ai-native/privacy/retention-policy";
import { KnowledgeCommitUnknownError } from '../ai-native/knowledge/knowledge-errors';
import { knowledgeUploadRevisionSchema, knowledgeUploadKey } from '../ai-native/knowledge/human-knowledge-upload.service';
import { RENTAL_FILE_AUTHORITY, RentalFileApplicationParticipant, isRentalStaffFileBinding, type RentalFileWorkspaceAuthority } from "./rental-file-application.participant";

type JsonRecord = Record<string, unknown>;
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
export type ExchangeInspectionUploadPlan = RentalExchangeInspectionStoragePlan<FileBusinessOwner>;

@Injectable()
export class FileStorageRuntimeService extends FileStoragePrimitives implements OnApplicationBootstrap, OnApplicationShutdown {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly files: FileStorageRepository;
  private readonly fileReferences: RentalFileBusinessReferences;
  private readonly cleanup: FileStorageCleanup<Prisma.TransactionClient>;
  private readonly exchangeInspectionFiles: RentalExchangeInspectionFileStorage<FileBusinessOwner>;
  private readonly evidenceFiles: RentalEvidenceFileStorage;
  private readonly staffUploadObservations: RentalStaffUploadObservation;
  private readonly staffFiles?: FileStorageApplication<FileBusinessOwner, Prisma.TransactionClient>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationService,
    @Optional() private readonly operationLog?: OperationLogService,
    @Optional() @Inject(INSPECTION_OBJECT_READER) inspectionObjectReader?: InspectionObjectReader,
    @Optional() @Inject(KNOWLEDGE_FILE_ACCESS) private readonly knowledgeFiles?: KnowledgeFileAccess,
    @Optional() private readonly fileAccess?: FileBusinessAccessService,
    @Optional() @Inject(RENTAL_FILE_AUTHORITY) auth?: RentalFileWorkspaceAuthority
  ) {
    super();
    this.files = new FileStorageRepository(prisma);
    this.fileReferences = new RentalFileBusinessReferences(prisma);
    this.exchangeInspectionFiles = new RentalExchangeInspectionFileStorage(prisma, integrations, {
      validateInput: input => this.validateInput(input),
      storageKey: (...args) => this.storageKey(...args),
      presign: (...args) => this.presign(...args),
      matchesOwner: (...args) => this.matchesOwner(...args),
      readObjectContent: (...args) => this.readObjectContent(...args),
      objectRequest: (...args) => this.objectRequest(...args),
      persistUploadFacts: (...args) => this.persistUploadFacts(...args),
      readInspectionMedia
    });
    this.evidenceFiles = new RentalEvidenceFileStorage(prisma, integrations, {
      presign: (...args) => this.presign(...args),
      matchesOwner: (...args) => this.matchesOwner(...args),
      assertBusinessReference: (...args) => this.assertBusinessReference(...args),
      inspectionObjectReader,
      readInspectionMedia
    });
    this.staffUploadObservations = new RentalStaffUploadObservation(prisma, fileAccess, {
      parseStaffUploadObservation,
      validateInput: input => this.validateInput(input),
      matchesOwner: (...args) => this.matchesOwner(...args),
      matchesUploadRequest: (...args) => this.matchesUploadRequest(...args)
    });
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
    if (auth && fileAccess) {
      const staff = new RentalFileApplicationParticipant(prisma, auth, fileAccess);
      this.staffFiles = new FileStorageApplication<FileBusinessOwner, Prisma.TransactionClient>({
        store: prisma,
        transaction: work => staff.transaction(work),
        runtimeConfig: (tenantId, provider, options) => this.integrations.runtimeConfig("file", tenantId, provider as never, options),
        assertEnabled: (tx, tenantId, config) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
          { configRevision: config.revision }),
        allowSimulation: process.env.NODE_ENV !== "production",
        isUniqueConflict: error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
        excludedUploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
        ...(operationLog ? { recordAudit: input => operationLog.record(input) } : {})
      }, staff.authorities);
    }
  }

  private requireStaffFiles() {
    if (!this.staffFiles) throw new ServiceUnavailableException("员工文件原认证或文件ACL参加者未配置");
    return this.staffFiles;
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
    if (isRentalStaffFileBinding(tenantId, input)) return this.requireStaffFiles().createUploadSession(tenantId, input, owner);
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

  async planExchangeInspectionUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner: FileBusinessOwner): Promise<ExchangeInspectionUploadPlan> {
    return this.exchangeInspectionFiles.planExchangeInspectionUpload(tenantId, input, owner);
  }

  async persistExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, plan: ExchangeInspectionUploadPlan) {
    return this.exchangeInspectionFiles.persistExchangeInspectionUpload(tx, tenantId, plan);
  }

  async inspectExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, configRowHash: string, storageLocationHash: string) {
    return this.exchangeInspectionFiles.inspectExchangeInspectionUpload(tenantId, fileAssetId, owner, configRowHash, storageLocationHash);
  }

  async reconcileExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, configRowHash: string, storageLocationHash: string) {
    return this.exchangeInspectionFiles.reconcileExchangeInspectionUpload(tenantId, fileAssetId, owner, configRowHash, storageLocationHash);
  }

  async readFrozenExchangeInspectionEvidence(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, contentHash: string) {
    return this.exchangeInspectionFiles.readFrozenExchangeInspectionEvidence(tenantId, fileAssetId, owner, contentHash);
  }

  async completeExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, fileAssetId: string, owner: FileBusinessOwner,
    proof: Awaited<ReturnType<FileStorageRuntimeService["inspectExchangeInspectionUpload"]>>) {
    return this.exchangeInspectionFiles.completeExchangeInspectionUpload(tx, tenantId, fileAssetId, owner, proof);
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
    return this.staffUploadObservations.observeStaffUpload(tenantId, value, valueOwner);
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
    if (asset && isRentalStaffFileBinding(tenantId, asset)) return this.requireStaffFiles().completeUpload(tenantId, sessionId, input, owner);
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
    return this.evidenceFiles.readAuthorityBytes(tenantId, fileAssetId, applicantCustomerId);
  }

  async readPaymentProofBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, orderId: string, workspaceId: string, contentHash: string) {
    return this.evidenceFiles.readPaymentProofBytes(tenantId, fileAssetId, applicantCustomerId, orderId, workspaceId, contentHash);
  }

  async downloadUrl(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner): Promise<FileDownloadUrlSummary> {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } });
    if (asset && isRentalStaffFileBinding(tenantId, asset)) return this.requireStaffFiles().downloadUrl(tenantId, fileAssetId, owner);
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
    return this.evidenceFiles.readInspectionBytes(tenantId, fileAssetId, owner, maxBytes, signal);
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
