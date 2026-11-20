/** Rental 原文件兼容编排，保持原合法 module/scene、对象权限、会话、事务与冻结收据。
 * 公共文件原语供给创建、字节、冻结、清理和签名；宿主供给原知识、检查与审计参加者。 */
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { FileStoragePrimitives, FileStorageRepository, freezeFileUploadContent, createOriginalFileUploadFacts,
  readOriginalFileUploadReceipt, FileStorageCleanup, COMPLETED_STAGING_PENDING, issueFileDownloadReference,
  FileStorageApplication, type FileStorageOwner, type FileCleanupTransaction } from "@rental-os/platform-server/files";
import { fetchObjectStorageWithTimeout as fetchWithTimeout } from "@rental-os/platform-server/object-storage";
import { PlatformOperationLogService, type OperationLogInput } from "@rental-os/platform-server/operation-log";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { TenantIntegrationService, TenantIntegrationRuntimeConfig } from "@rental-os/platform-server/tenant-integration";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileUploadCleanupSummary,
  FileDownloadUrlSummary, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import { RentalFileBusinessReferences } from "./file-access";
import type { RentalFileReferenceStorage } from "./file-access-ports";
import type { RentalFileBusinessAccessService } from "./file-business-access";
import { RentalExchangeInspectionFileStorage, type RentalExchangeInspectionStoragePlan } from "./file-application-exchange-inspection";
import { RentalEvidenceFileStorage } from "./file-application-rental-evidence";
import { RentalStaffUploadObservation } from "./file-application-staff-observation";
import { RentalEnterprisePaymentProofFileParticipant } from "./file-application-enterprise-payment-proof";
import { RentalFileApplicationParticipant, RentalStaffFileStorageApplication, isRentalStaffFileBinding, type RentalFileWorkspaceAuthority } from "./file-application-participant";
import { lockRentalBusinessTenant } from "./mysql-business-fence";
import { ENTERPRISE_PAYMENT_PROOF_SCENE } from "./enterprise-workflows";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "./exchange-inspection-preparation";
import type { StaffUploadObservationRequest, StaffUploadObservationResponse } from "./staff-upload-observation";

type JsonRecord = Record<string, unknown>;

/** 本编排使用原知识修订的目标字段；完整修订由宿主原 schema 校验并随 owner 保全。 */
export interface FileKnowledgeRevision {
  expectedRevision: number;
  targetVersion: string;
}

export interface FileBusinessOwner<Revision extends FileKnowledgeRevision = FileKnowledgeRevision> extends FileStorageOwner {
  knowledgeRevision?: Revision;
  /** 专用原业务入口供给的换货影像来源。 */
  exchangeInspectionSourceId?: string;
  /** 专用企业订单入口供给的原回款依据。 */
  enterprisePaymentProof?: { corporateCustomerId: string; orderId: string; objectRevision: string; purpose: "rental_fee" };
}

interface RentalKnowledgeFileParticipant<Revision extends FileKnowledgeRevision> {
  authorizeUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner?: FileBusinessOwner<Revision>): Promise<void>;
  authorizeUploadObservation?(tenantId: string, owner: FileBusinessOwner<Revision>): Promise<void>;
  assertBound(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>,
    target?: { documentVersion: string; expectedRevision: number }): Promise<void>;
  readUploadContent?(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>): Promise<{ bytes: Uint8Array; contentHash: string }>;
  read(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, maxBytes: number,
    signal?: AbortSignal): Promise<{ mediaType: string; bytes: Uint8Array }>;
}

type RentalEvidencePorts = ConstructorParameters<typeof RentalEvidenceFileStorage>[2];
type RentalObservationPorts = ConstructorParameters<typeof RentalStaffUploadObservation>[2];

/** 宿主沿原实例供给权限。知识操作按需核定原修订、原键和 unknown 参加者。 */
export interface RentalFileStorageParticipants<Revision extends FileKnowledgeRevision> {
  operationLog?: Pick<PlatformOperationLogService, "record">;
  fileAccess?: Pick<RentalFileBusinessAccessService, "authorityKey" | "assertRead">;
  auth?: RentalFileWorkspaceAuthority;
  knowledgeFiles?: RentalKnowledgeFileParticipant<Revision>;
  inspectionObjectReader?: RentalEvidencePorts["inspectionObjectReader"];
  readInspectionMedia: RentalEvidencePorts["readInspectionMedia"];
  parseStaffUploadObservation: RentalObservationPorts["parseStaffUploadObservation"];
  parseKnowledgeUploadRevision?(value: unknown): { success: true; data: Revision } | { success: false };
  knowledgeUploadKey?(documentId: string, targetVersion?: string): string;
  knowledgeCommitUnknown?(): Error;
}

export type RentalFileRuntimeStorage = RentalFileReferenceStorage
  & Pick<PrismaClient, "fileAsset" | "fileUploadSession" | "tenantIntegrationConfig" | "$transaction">;

type UploadFacts<Revision extends FileKnowledgeRevision> = {
  input: CreateFileUploadSessionRequest; owner?: FileBusinessOwner<Revision>; assetId: string; sessionId: string;
  expiresAt: Date; provider: string; storageKey: string; mode: "provider" | "simulation"; mimeType: string;
};
export type ExchangeInspectionUploadPlan<Revision extends FileKnowledgeRevision = FileKnowledgeRevision>
  = RentalExchangeInspectionStoragePlan<FileBusinessOwner<Revision>>;

export class RentalFileStorageApplication<Revision extends FileKnowledgeRevision = FileKnowledgeRevision> extends FileStoragePrimitives {

  private readonly operationLog?: Pick<PlatformOperationLogService, "record">;
  private readonly knowledgeFiles?: RentalKnowledgeFileParticipant<Revision>;
  private readonly fileAccess?: Pick<RentalFileBusinessAccessService, "authorityKey" | "assertRead">;

  private readonly files: FileStorageRepository;
  private readonly fileReferences: RentalFileBusinessReferences;
  private readonly exchangeInspectionFiles: RentalExchangeInspectionFileStorage<FileBusinessOwner<Revision>>;
  private readonly evidenceFiles: RentalEvidenceFileStorage;
  private readonly staffUploadObservations: RentalStaffUploadObservation;
  private readonly enterprisePaymentProofFiles = new RentalEnterprisePaymentProofFileParticipant();
  private readonly staffFiles?: FileStorageApplication<FileBusinessOwner<Revision>, Prisma.TransactionClient>;

  private requireStaffFiles() {
    if (!this.staffFiles) throw new ServiceUnavailableException("员工文件原认证或文件ACL参加者未配置");
    return this.staffFiles;
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
    owner?: FileBusinessOwner<Revision>
  ): Promise<FileUploadSessionSummary> {
    if (isRentalStaffFileBinding(tenantId, input)) return this.requireStaffFiles().createUploadSession(tenantId, input, owner);
    input = structuredClone(input); owner = structuredClone(owner);
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("换货检查影像必须经专用原业务入口上传");
    input = this.enterprisePaymentProofFiles.prepareUpload(input, owner);
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
    let knowledgeCommitUnknown: (() => Error) | undefined;
    if (input.businessType === 'ai_knowledge_document') {
      const factory = this.native.knowledgeCommitUnknown;
      if (typeof factory !== 'function') throw new ServiceUnavailableException('知识上传提交参加者未配置');
      // 写入前固定原错误工厂与宿主绑定，提交失应答仍能表达原操作的 unknown。
      knowledgeCommitUnknown = factory.bind(this.native);
      await this.authorizeKnowledgeUpload(tenantId, input, owner);
    } else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId);

    let knowledgeWriteAttempted = false;
    let created: {
      asset: Prisma.FileAssetGetPayload<object>;
      session: Prisma.FileUploadSessionGetPayload<object>;
    };
    try {
      created = await createOriginalFileUploadFacts<FileBusinessOwner<Revision>, Prisma.TransactionClient, typeof created>(
        { tenantId, request: input, owner, mimeType }, {
          runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId),
          validateConfiguration: config => {
            if (input.businessType === 'ai_knowledge_document' && config?.provider !== 's3_compatible')
              throw new ServiceUnavailableException('知识首建需要可读取的受控存储');
          },
          allowSimulation: process.env.NODE_ENV !== "production",
          storageKey: (config, currentTenantId, assetId, fileName) => this.storageKey(config, currentTenantId, assetId, fileName),
          transaction: work => this.businessTransaction(tenantId, work),
          assertEnabled: (tx, config) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
            { configRevision: config.revision }),
          beforePersist: async tx => {
            if (input.businessType === 'ai_knowledge_document') await this.authorizeKnowledgeUpload(tenantId, input, owner);
            // 配置读取会让出执行，建立上传事实前再次核原业务引用及空间归属。
            else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId, tx);
            if (input.businessType === 'ai_knowledge_document') knowledgeWriteAttempted = true;
          },
          persist: (tx, facts, config) => this.persistUploadFacts(tx, tenantId, facts, config)
        }
      );
    } catch (error) {
      if (error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === "P2002") {
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
      if (knowledgeWriteAttempted) throw knowledgeCommitUnknown!();
      throw error;
    }

    if (input.businessType === 'ai_knowledge_document') {
      try { return await this.knowledgeUploadSummary(tenantId, input, created.session, created.asset, owner); }
      catch { throw knowledgeCommitUnknown!(); }
    }
    return this.originalUploadSummary(tenantId, created.session, created.asset, owner);
  }

  private async persistUploadFacts(tx: Prisma.TransactionClient, tenantId: string, facts: UploadFacts<Revision>, configured?: TenantIntegrationRuntimeConfig) {
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
              ...this.enterprisePaymentProofFiles.uploadMetadata(owner),
              ...(configured ? { fileUploadVersion: 2,
                storageLocationHash: this.retentionLocationHash(configured),
                uploadConfigHash: requestFingerprint({ id: configured.id, provider: configured.provider, settings: configured.settings, credentials: configured.credentials }) } : {}),
              ...(input.businessType === 'ai_knowledge_document' ? { knowledgeUploadVersion: 1,
                ...(configured ? { storageLocationHash: this.retentionLocationHash(configured) } : {}),
                ...(owner?.knowledgeRevision ? { knowledgeRevision: { ...owner.knowledgeRevision } } : {}) } : {}),
              uploadMode: mode
            });
  }

  async planExchangeInspectionUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner: FileBusinessOwner<Revision>): Promise<ExchangeInspectionUploadPlan<Revision>> {
    return this.exchangeInspectionFiles.planExchangeInspectionUpload(tenantId, input, owner);
  }

  async persistExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, plan: ExchangeInspectionUploadPlan<Revision>) {
    return this.exchangeInspectionFiles.persistExchangeInspectionUpload(tx, tenantId, plan);
  }

  async inspectExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, configRowHash: string, storageLocationHash: string) {
    return this.exchangeInspectionFiles.inspectExchangeInspectionUpload(tenantId, fileAssetId, owner, configRowHash, storageLocationHash);
  }

  async reconcileExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, configRowHash: string, storageLocationHash: string) {
    return this.exchangeInspectionFiles.reconcileExchangeInspectionUpload(tenantId, fileAssetId, owner, configRowHash, storageLocationHash);
  }

  async readFrozenExchangeInspectionEvidence(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, contentHash: string) {
    return this.exchangeInspectionFiles.readFrozenExchangeInspectionEvidence(tenantId, fileAssetId, owner, contentHash);
  }

  async completeExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>,
    proof: Awaited<ReturnType<RentalFileStorageApplication<Revision>["inspectExchangeInspectionUpload"]>>) {
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
    owner?: FileBusinessOwner<Revision>
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

    await this.assertUploadDispatch(tenantId, session.sessionId, session.fileAssetId, owner, undefined,
      { url: session.uploadUrl, expiresAt: session.expiresAt, request: input });
    let response: Response;
    try {
      response = await fetchWithTimeout(session.uploadUrl, {
        method: "PUT",
        headers: session.uploadHeaders ?? { "Content-Type": input.mimeType },
        body: new Uint8Array(content)
      });
    } catch {
      await this.failSession(tenantId, session.sessionId, "上传到对象存储失败", true);
      throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
    }
    if (!response.ok) {
      await this.failSession(tenantId, session.sessionId, `对象存储返回 HTTP ${response.status}`, true);
      throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
    }
    return this.completeUpload(tenantId, session.sessionId, { checksum }, owner);
  }

  /**
   * 删除业务文件时使用。先在 provider 侧确认删除，再把 FileAsset 标为 deleted；
   * provider 暂不可用时标记 delete_pending，避免把一个实际上仍存在的对象伪装成
   * 已删除。后台清理循环会继续重试 pending 状态。
   */
  async deleteFileAsset(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner<Revision>) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId } });
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new ServiceUnavailableException("专用换货影像保留原引用，不使用通用删除");
    if (asset?.businessType === 'ai_knowledge_document') throw new ServiceUnavailableException('知识附件保留原上传证据；文档删除走知识生命周期');
    if (!asset || (owner && !this.matchesOwner(asset, owner)) || !["active", "delete_pending", "deleted"].includes(asset.status)) {
      throw new NotFoundException("文件不存在或不属于当前业务对象");
    }
    if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    if (asset.status === "deleted") return { fileAssetId, status: "deleted" as const };

    let config: TenantIntegrationRuntimeConfig | undefined, configurationError: unknown;
    if (asset.storageProvider !== "local_mock") {
      try { config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never, { requireLiveTest: false }); }
      catch (error) { configurationError = error; }
    }
    const original = { id: fileAssetId, tenantId, status: { in: ["active", "delete_pending"] },
      updatedAt: asset.updatedAt, storageKey: asset.storageKey, storageProvider: asset.storageProvider,
      businessType: asset.businessType, businessId: asset.businessId };
    await this.businessTransaction(tenantId, async tx => {
      const current = await tx.fileAsset.findFirst({ where: original });
      if (!current) throw new ConflictException("原删除文件绑定已变化");
      if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId, tx);
      if (config) await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider, { configRevision: config.revision });
      if (asset.storageProvider === "local_mock") {
        const changed = await tx.fileAsset.updateMany({ where: original, data: { status: "deleted" } });
        if (changed.count !== 1) throw new ConflictException("原删除文件绑定已变化");
      }
    });
    if (asset.storageProvider !== "local_mock") {
      try {
        if (configurationError) throw configurationError;
        if (!config || !(await this.deleteObject(config, asset.storageKey, new Date()))) throw new ServiceUnavailableException("对象存储未确认删除文件");
      } catch {
        await this.prisma.fileAsset.updateMany({
          where: original,
          data: { status: "delete_pending" }
        });
        await this.operationLog?.record({ tenantId, action: "file.delete.pending", targetType: "file", targetId: fileAssetId, detail: "对象存储删除待重试", metadata: { provider: asset.storageProvider } });
        throw new ServiceUnavailableException("对象存储暂不可用，文件删除已进入重试队列");
      }
    }
    // 已派发删除的原结果只以原定位CAS收口；撤权不改写实际外部效果。
    if (asset.storageProvider !== "local_mock") {
      const changed = await this.prisma.fileAsset.updateMany({ where: original, data: { status: "deleted" } });
      if (changed.count !== 1) throw new ConflictException("原文件删除收据已变化，请核对原对象");
    }
    await this.operationLog?.record({ tenantId, action: "file.delete", targetType: "file", targetId: fileAssetId, detail: "删除业务文件", metadata: { provider: asset.storageProvider } });
    return { fileAssetId, status: "deleted" as const };
  }

  private retentionLocationHash(config: TenantIntegrationRuntimeConfig) {
    return fileStorageLocationHash(config);
  }

  /** Reclaim only the staging object proved by a completed freeze receipt.
   * cleanupError holds the fixed pending/unknown marker; the upload remains
   * completed and its active evidence is never invalidated by cleanup failure. */
  private async cleanupCompletedStagingObjects(tenantId: string, limit: number): Promise<FileUploadCleanupSummary> {
    return this.cleanupForTenant(tenantId).cleanupCompletedStagingObjects(tenantId, limit);
  }

  /**
   * 未完成的过期上传先抢占 cleanup_in_progress，再删临时对象并标记 failed。
   * 已完成上传另读原冻结收据回收临时对象，保持 completed/正式证据不变；
   * freeze_pending 不进入任何过期清理，未知冻结仍只能核对原结果。
   */
  async cleanupExpiredUploadSessions(tenantId: string, limit = 50): Promise<FileUploadCleanupSummary> {
    return this.cleanupForTenant(tenantId).cleanupExpiredUploadSessions(tenantId, limit);
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
    return this.cleanupForTenant(tenantId).cleanupPendingFileAssetDeletes(tenantId, limit);
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
    valueOwner: FileBusinessOwner<Revision>): Promise<StaffUploadObservationResponse> {
    return this.staffUploadObservations.observeStaffUpload(tenantId, value, valueOwner);
  }

  /** Current-authorized observation of the original knowledge upload only.
   * Never creates a session, signs a URL, checks object storage, or completes it. */
  async readKnowledgeUpload(tenantId: string, sessionId: string, owner: FileBusinessOwner<Revision>): Promise<FileUploadSessionSummary> {
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
  async findKnowledgeUpload(tenantId: string, value: CreateFileUploadSessionRequest, valueOwner: FileBusinessOwner<Revision>,
    revision?: { expectedRevision: number; targetVersion: string }): Promise<FileUploadSessionSummary | null> {
    const input = structuredClone(value), owner = structuredClone(valueOwner), selected = structuredClone(revision);
    if (input.businessModule !== 'ai-native' || input.businessType !== 'ai_knowledge_document' || input.uploadScene !== 'ai-knowledge'
      || !input.idempotencyKey || owner?.businessId !== input.businessId || owner.businessType !== input.businessType
      || owner.uploadScene !== input.uploadScene || !owner.workspaceId || !owner.actorUserId
      || !this.knowledgeFiles?.authorizeUploadObservation) throw new NotFoundException('知识上传观察权威不可用');
    const knowledgeUploadKey = this.native.knowledgeUploadKey;
    const parseKnowledgeUploadRevision = this.native.parseKnowledgeUploadRevision;
    if (typeof knowledgeUploadKey !== 'function' || typeof parseKnowledgeUploadRevision !== 'function')
      throw new ServiceUnavailableException('知识上传观察参加者未配置');
    if (input.idempotencyKey !== knowledgeUploadKey.call(this.native, input.businessId, selected?.targetVersion)) throw new BadRequestException('原知识上传键不匹配');
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
      const parsed = metadata?.knowledgeRevision === undefined ? undefined : parseKnowledgeUploadRevision.call(this.native, metadata.knowledgeRevision);
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
    owner?: FileBusinessOwner<Revision>
  ) {
    input = structuredClone(input); owner = structuredClone(owner);
    let session = structuredClone(await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } }));
    if (!session) throw new NotFoundException("上传会话不存在");
    let asset = structuredClone(await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } }));
    if (asset && isRentalStaffFileBinding(tenantId, asset)) return this.requireStaffFiles().completeUpload(tenantId, sessionId, input, owner);
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("专用换货影像只能核验原业务完成入口");
    this.enterprisePaymentProofFiles.assertComplete(asset, owner);
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
        transaction: work => this.businessTransaction(tenantId, work),
        beforeClaim: async tx => {
          if (knowledgeInput) await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
          else await this.assertBusinessReference(tenantId, asset!.businessType, asset!.businessId ?? "", owner?.workspaceId, tx);
        },
        assertConfiguration: (tx, currentConfig) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", currentConfig.provider,
          { configRevision: currentConfig.revision }),
        readContent: (currentConfig, storageKey, mimeType, sizeBytes) => this.readObjectContent(currentConfig, storageKey, mimeType, sizeBytes),
        writeContent: async (currentConfig, storageKey, mimeType, bytes) => {
          await this.assertUploadDispatch(tenantId, session!.id, pendingAsset.id, owner, { storageKey, config: currentConfig });
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
      // 已派发的冻结内容只按原收据完成文件结果；本地模拟没有外部结果，仍是新写入。
      if (!frozen) await lockRentalBusinessTenant(tx, tenantId);
      if (frozen) {
        await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", frozen.config.provider, { configRevision: frozen.config.revision });
        const [currentAsset, currentSession] = await Promise.all([
          tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
          tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } })
        ]);
        if (requestFingerprint(currentAsset) !== requestFingerprint(asset) || requestFingerprint(currentSession) !== requestFingerprint(session)) {
          throw new ConflictException("文件或原上传会话在内容冻结期间已变化");
        }
        if (!knowledgeInput) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId, tx);
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

  async downloadUrl(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner<Revision>): Promise<FileDownloadUrlSummary> {
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
      recordAudit: input => this.recordDownloadAudit(input, asset),
      readAsset: () => this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } }),
      runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never),
      allowSimulation: process.env.NODE_ENV !== "production",
      signGet: (config, storageKey, mimeType, expiresAt) => this.presign(config, "GET", storageKey, mimeType, expiresAt)
    });
  }

  async readKnowledgeBytes(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, maxBytes: number, signal?: AbortSignal) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('非URL受控知识文件读取未配置');
    return this.knowledgeFiles.read(tenantId, fileAssetId, owner, maxBytes, signal);
  }

  async readInspectionBytes(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, maxBytes: number, signal: AbortSignal) {
    return this.evidenceFiles.readInspectionBytes(tenantId, fileAssetId, owner, maxBytes, signal);
  }

  async assertKnowledgeBinding(tenantId: string, fileAssetId: string, owner: FileBusinessOwner<Revision>, target?: { documentVersion: string; expectedRevision: number }) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('知识文件绑定权威未配置');
    return this.knowledgeFiles.assertBound(tenantId, fileAssetId, owner, target);
  }

  private async authorizeKnowledgeUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner?: FileBusinessOwner<Revision>) {
    if (!this.knowledgeFiles) throw new ServiceUnavailableException('知识首建上传权威未配置');
    await this.knowledgeFiles.authorizeUpload(tenantId, input, owner);
  }

  private assertKnowledgeUploadAsset(asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner<Revision>) {
    const metadata = asset.metadata;
    if (!owner?.actorUserId || !owner.workspaceId || asset.uploadedBy !== owner.actorUserId || asset.storageProvider === 'local_mock'
      || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.workspaceId !== owner.workspaceId
      || metadata.knowledgeUploadVersion !== 1
      || requestFingerprint(metadata.knowledgeRevision ?? null) !== requestFingerprint(owner.knowledgeRevision ?? null)) throw new NotFoundException('知识上传不属于当前主体和空间');
  }

  private async knowledgeUploadSummary(tenantId: string, input: CreateFileUploadSessionRequest,
    session: Prisma.FileUploadSessionGetPayload<object>, asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner<Revision>) {
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
    asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner<Revision>) {
    session = structuredClone(session); asset = structuredClone(asset);
    return readOriginalFileUploadReceipt({ tenantId, session, asset, owner }, {
      isTenantSharedBinding: file => ["customer", "customer_profile", "membership_review"].includes(file.businessType),
      assertBusinessReference: () => this.businessTransaction(tenantId, tx =>
        this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId, tx)),
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
      && this.enterprisePaymentProofFiles.matchesUploadRequest(asset, input);
  }

  private async assertBusinessReference(tenantId: string, businessType: string, businessId: string, workspaceId?: string,
    tx?: Prisma.TransactionClient) {
    return (tx ? new RentalFileBusinessReferences(tx) : this.fileReferences).assertExists(tenantId, businessType, businessId, workspaceId);
  }

  private businessTransaction<T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      return work(tx);
    });
  }

  /** 只适配原清理参加者的新占用和DELETE派发；结果CAS、HEAD核对及审计仍记录原已发生效果。 */
  private cleanupForTenant(tenantId: string) {
    const prisma = this.prisma;
    const store: FileCleanupTransaction = {
      fileAsset: {
        findFirst: input => prisma.fileAsset.findFirst(input),
        findMany: input => prisma.fileAsset.findMany(input),
        updateMany: input => input.data.status === "delete_in_progress"
          ? this.businessTransaction(tenantId, async tx => tx.fileAsset.updateMany(input)) : prisma.fileAsset.updateMany(input)
      },
      fileUploadSession: {
        findMany: input => prisma.fileUploadSession.findMany(input),
        update: input => prisma.fileUploadSession.update(input),
        updateMany: input => input.data.status === "cleanup_in_progress"
          ? this.businessTransaction(tenantId, async tx => tx.fileUploadSession.updateMany(input)) : prisma.fileUploadSession.updateMany(input)
      }
    };
    return new FileStorageCleanup<Prisma.TransactionClient>({
      store,
      transaction: work => this.businessTransaction(tenantId, work),
      runtimeConfig: (currentTenant, provider) => this.integrations.runtimeConfig("file", currentTenant, provider as never, { requireLiveTest: false }),
      excludedUploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
      deleteObject: async (config, storageKey, at) => {
        await this.businessTransaction(tenantId, tx => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
          { configRevision: config.revision }));
        return this.deleteObject(config, storageKey, at);
      },
      presign: (config, method, storageKey, mimeType, expiresAt) => this.presign(config, method, storageKey, mimeType, expiresAt),
      objectRequest: async (url, init) => {
        if (init.method === "DELETE") await this.businessTransaction(tenantId, async () => undefined);
        return this.objectRequest(url, init);
      },
      ...(this.operationLog ? { recordAudit: (input: OperationLogInput) => this.operationLog!.record(input) } : {})
    });
  }

  /** 新运输在短事务核原目标与配置，事务结束后才派发。拒绝不重写冻结意图或已有结果。 */
  private async assertUploadDispatch(tenantId: string, sessionId: string, fileAssetId: string,
    owner?: FileBusinessOwner<Revision>, frozen?: { storageKey: string; config: TenantIntegrationRuntimeConfig },
    pending?: { url: string; expiresAt: string; request: CreateFileUploadSessionRequest }) {
    const original = !frozen && await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
    const config = frozen?.config ?? (original
      ? await this.integrations.runtimeConfig("file", tenantId, original.provider as never, { requireLiveTest: false }) : undefined);
    await this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const session = await tx.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
      const asset = await tx.fileAsset.findFirst({ where: { id: fileAssetId, tenantId } });
      const metadata = asset?.metadata as JsonRecord | null;
      if (!session || !asset || session.fileAssetId !== asset.id || session.provider !== asset.storageProvider
        || session.storageKey !== asset.storageKey || asset.status !== "pending_upload"
        || session.status !== (frozen ? "freeze_pending" : "pending_upload")
        || frozen && asset.storageKey !== frozen.storageKey || !frozen && session.expiresAt.getTime() <= Date.now()
        || owner && (!this.matchesOwner(asset, owner) || owner.actorUserId && asset.uploadedBy !== owner.actorUserId))
        throw new ConflictException("原上传派发目标已变化，只能核对原会话");
      if (!config || config.provider !== asset.storageProvider || metadata?.uploadConfigHash !== requestFingerprint({
        id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials }))
        throw new ConflictException("原上传配置已变化，不能派发旧对象请求");
      if (pending) {
        const target = new URL(this.presign(config, "PUT", this.pendingObjectKey(asset.storageKey), asset.mimeType, session.expiresAt).url);
        const originalTarget = new URL(pending.url);
        if (target.origin !== originalTarget.origin || target.pathname !== originalTarget.pathname
          || session.expiresAt.toISOString() !== pending.expiresAt || !this.matchesUploadRequest(asset, pending.request, pending.request.mimeType.trim().toLowerCase()))
          throw new ConflictException("原上传派发定位已变化，不能发送到旧对象");
      }
      await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider, { configRevision: config.revision });
      if (asset.businessType !== "ai_knowledge_document")
        await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId, tx);
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted });
  }

  private async recordDownloadAudit(input: OperationLogInput, expected: Prisma.FileAssetGetPayload<object>) {
    if (!this.fileAccess || !this.operationLog || input.tenantId !== expected.tenantId || input.targetId !== expected.id)
      throw new ServiceUnavailableException("文件业务读取权威或访问审计未配置");
    const access = this.fileAccess;
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, expected.tenantId);
      const asset = await tx.fileAsset.findFirst({ where: { id: expected.id, tenantId: expected.tenantId, status: "active" } });
      const stable = (row: unknown) => requestFingerprint(JSON.parse(JSON.stringify(row)));
      if (!asset || stable(asset) !== stable(expected)) throw new ConflictException("文件或读取授权已变化");
      await access.assertRead(expected.tenantId, asset, false, tx);
      await new PlatformOperationLogService(tx).record(input);
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted });
  }

  private async failSession(tenantId: string, sessionId: string, reason: string, resultOnly = false) {
    await this.prisma.$transaction(async tx => {
      if (!resultOnly) await lockRentalBusinessTenant(tx, tenantId);
      const session = await tx.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
      if (!session || session.status !== "pending_upload") return;
      const claimed = await tx.fileUploadSession.updateMany({ where: { id: sessionId, tenantId, status: "pending_upload",
        updatedAt: session.updatedAt, fileAssetId: session.fileAssetId, storageKey: session.storageKey },
        data: { status: "failed", failureReason: reason, cleanupError: "待执行过期对象清理" } });
      // 迟到的运输失败不能把另一完成者已占用的冻结文件改成failed。
      if (claimed.count !== 1) return;
      await tx.fileAsset.updateMany({ where: { id: session.fileAssetId, tenantId, storageKey: session.storageKey,
        status: "pending_upload" }, data: { status: "failed" } });
    });
  }
  constructor(private readonly prisma: RentalFileRuntimeStorage,
    private readonly integrations: Pick<TenantIntegrationService, "runtimeConfig" | "assertEnabledInTransaction">,
    private readonly native: RentalFileStorageParticipants<Revision>) {
    super();
    this.operationLog = native.operationLog;
    this.knowledgeFiles = native.knowledgeFiles;
    this.fileAccess = native.fileAccess;
    const { operationLog, inspectionObjectReader, fileAccess, auth } = native;
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
      readInspectionMedia: native.readInspectionMedia
    });
    this.evidenceFiles = new RentalEvidenceFileStorage(prisma, integrations, {
      presign: (...args) => this.presign(...args),
      matchesOwner: (...args) => this.matchesOwner(...args),
      assertBusinessReference: (...args) => this.assertBusinessReference(...args),
      inspectionObjectReader,
      readInspectionMedia: native.readInspectionMedia
    });
    this.staffUploadObservations = new RentalStaffUploadObservation(prisma, fileAccess, {
      parseStaffUploadObservation: native.parseStaffUploadObservation,
      validateInput: input => this.validateInput(input),
      matchesOwner: (...args) => this.matchesOwner(...args),
      matchesUploadRequest: (...args) => this.matchesUploadRequest(...args)
    });
    if (auth && fileAccess) {
      const staff = new RentalFileApplicationParticipant(prisma, auth, fileAccess);
      this.staffFiles = new RentalStaffFileStorageApplication<FileBusinessOwner<Revision>>({
        store: prisma,
        transaction: work => staff.transaction(work),
        runtimeConfig: (tenantId, provider, options) => this.integrations.runtimeConfig("file", tenantId, provider as never, options),
        assertEnabled: (tx, tenantId, config) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
          { configRevision: config.revision }),
        allowSimulation: process.env.NODE_ENV !== "production",
        isUniqueConflict: error => error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === "P2002",
        excludedUploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
        ...(operationLog ? { recordAudit: input => staff.recordAudit(input) } : {})
      }, staff);
    }
  }
}
