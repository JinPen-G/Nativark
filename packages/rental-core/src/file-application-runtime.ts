/** Rental 原文件兼容适配，核原合法 module/scene、对象权限、知识、检查和企业凭证。
 * 普通PUT回执在原权限、配置与文件锁内复验。创建、完成/失败、删除及清理委托公共流程。
 * 原宿主供给同一业务事务、审计及专用参加者。 */
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { FileStoragePrimitives, FileStorageRepository, freezeFileUploadContent, createOriginalFileUploadFacts,
  readOriginalFileUploadReceipt, FileStorageCleanup, issueFileDownloadReference,
  createOriginalFileUploadSession, completeOriginalFileUpload, activateOriginalFileUpload, failOriginalFileUpload,
  uploadOriginalFileBuffer, assertOriginalFileUploadSnapshot, createOriginalFileCleanupTransactions,
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
import { assertRentalBusinessTenantAccessAfterLock, lockRentalBusinessTenant } from "./mysql-business-fence";
import { ENTERPRISE_PAYMENT_PROOF_SCENE } from "./enterprise-workflows";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "./exchange-inspection-preparation";
import type { StaffUploadObservationRequest, StaffUploadObservationResponse } from "./staff-upload-observation";
import type { RentalFileCleanupAuthority } from "./application-file-cleanup-authority";

type JsonRecord = Record<string, unknown>;
const CLEANUP_TENANT_BATCH_SIZE = 1000;

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
  /** Only the original all-tenant worker consumes this trusted system port.
   * Selected hosts require it at composition; the old host retains its own mode. */
  cleanupAuthority?: RentalFileCleanupAuthority;
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
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE)
      throw new BadRequestException("换货检查影像必须经专用原业务入口上传");
    input = this.enterprisePaymentProofFiles.prepareUpload(input, owner);
    const mimeType = this.validateInput(input);
    const idempotencyKey = input.idempotencyKey.trim();
    if (owner && !this.matchesOwner(input, owner)) throw new BadRequestException("上传业务对象与当前业务归属不一致");
    let knowledgeCommitUnknown: (() => Error) | undefined;
    let knowledgeWriteAttempted = false;
    return createOriginalFileUploadSession({
      findOriginal: async () => {
        const session = await this.files.findUploadSession(tenantId, { idempotencyKey });
        return session ? { session, asset: await this.prisma.fileAsset.findUniqueOrThrow({ where: { id: session.fileAssetId } }) } : undefined;
      },
      replay: (rows, source) => this.replayUploadSession(tenantId, input, mimeType, rows, owner, source),
      authorizeCreation: async () => {
        if (input.businessType === "ai_knowledge_document") {
          const factory = this.native.knowledgeCommitUnknown;
          if (typeof factory !== "function") throw new ServiceUnavailableException("知识上传提交参加者未配置");
          // 写入前固定原错误工厂与宿主绑定，提交失应答仍表达原操作的unknown。
          knowledgeCommitUnknown = factory.bind(this.native);
          await this.authorizeKnowledgeUpload(tenantId, input, owner);
        } else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId);
      },
      createFacts: () => createOriginalFileUploadFacts<FileBusinessOwner<Revision>, Prisma.TransactionClient, {
        asset: Prisma.FileAssetGetPayload<object>; session: Prisma.FileUploadSessionGetPayload<object>;
      }>({ tenantId, request: input, owner, mimeType }, {
        runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId),
        validateConfiguration: config => {
          if (input.businessType === "ai_knowledge_document" && config?.provider !== "s3_compatible")
            throw new ServiceUnavailableException("知识首建需要可读取的受控存储");
        },
        allowSimulation: process.env.NODE_ENV !== "production",
        storageKey: (config, currentTenant, assetId, fileName) => this.storageKey(config, currentTenant, assetId, fileName),
        transaction: work => this.businessTransaction(tenantId, work),
        assertEnabled: (tx, config) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
          { configRevision: config.revision }),
        beforePersist: async tx => {
          if (input.businessType === "ai_knowledge_document") {
            await this.authorizeKnowledgeUpload(tenantId, input, owner);
            knowledgeWriteAttempted = true;
          } else await this.assertBusinessReference(tenantId, input.businessType, input.businessId, owner?.workspaceId, tx);
        },
        persist: (tx, facts, config) => this.persistUploadFacts(tx, tenantId, facts, config)
      }),
      readCreatedReceipt: ({ asset, session }) => input.businessType === "ai_knowledge_document"
        ? this.knowledgeUploadSummary(tenantId, input, session, asset, owner)
        : this.originalUploadSummary(tenantId, session, asset, owner),
      isUniqueConflict: error => error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === "P2002",
      creationFailed: (_error, stage) => {
        if (input.businessType === "ai_knowledge_document" && (knowledgeWriteAttempted || stage === "receipt"))
          throw knowledgeCommitUnknown!();
      }
    });
  }

  /** 原重放仍核租户、上传者、请求描述及领域归属，知识沿其原版本与unknown入口读取。 */
  private async replayUploadSession(tenantId: string, input: CreateFileUploadSessionRequest, mimeType: string,
    rows: { asset: Prisma.FileAssetGetPayload<object>; session: Prisma.FileUploadSessionGetPayload<object> },
    owner: FileBusinessOwner<Revision> | undefined, source: "existing" | "unique_conflict") {
    const { asset, session } = rows;
    if (asset.tenantId !== tenantId) throw new NotFoundException("上传会话不存在或不属于当前租户");
    if (owner && !this.matchesOwner(asset, owner)) throw new ConflictException("幂等键已被其他业务对象使用，请更换幂等键");
    if (owner?.actorUserId && asset.uploadedBy !== owner.actorUserId)
      throw new ConflictException("上传幂等键已由其他员工使用，请重新选择文件");
    if (!this.matchesUploadRequest(asset, input, mimeType))
      throw new ConflictException("幂等键已用于不同文件上传请求，请更换幂等键");
    if (input.businessType === "ai_knowledge_document") return this.knowledgeUploadSummary(tenantId, input, session, asset, owner);
    await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId);
    // 原首次命中与唯一键竞争沿各自的兼容重放分支。
    if (source === "existing" && session.provider === "local_mock" && process.env.NODE_ENV === "production")
      throw new ServiceUnavailableException("生产环境禁止重放模拟文件上传，请先配置并验证文件存储平台");
    return this.originalUploadSummary(tenantId, session, asset, owner);
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
  async uploadBuffer(tenantId: string, input: CreateFileUploadSessionRequest, content: Buffer,
    owner?: FileBusinessOwner<Revision>) {
    return uploadOriginalFileBuffer(input, content, {
      createUpload: () => this.createUploadSession(tenantId, input, owner),
      assertDispatch: session => this.assertUploadDispatch(tenantId, session.sessionId, session.fileAssetId, owner, undefined,
        { url: session.uploadUrl!, expiresAt: session.expiresAt, request: input }),
      put: (session, bytes) => fetchWithTimeout(session.uploadUrl!, { method: "PUT",
        headers: session.uploadHeaders ?? { "Content-Type": input.mimeType }, body: new Uint8Array(bytes) }),
      fail: (sessionId, reason, resultOnly) => this.failSession(tenantId, sessionId, reason, resultOnly),
      complete: (sessionId, checksum) => this.completeUpload(tenantId, sessionId, { checksum }, owner)
    });
  }

  /** 原业务对象与当前权限参加删除事务，排队、占用和原键恢复由公共文件内核办理。 */
  async deleteFileAsset(tenantId: string, fileAssetId: string, owner?: FileBusinessOwner<Revision>) {
    owner = structuredClone(owner);
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId } });
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new ServiceUnavailableException("专用换货影像保留原引用，不使用通用删除");
    if (asset?.businessType === 'ai_knowledge_document') throw new ServiceUnavailableException('知识附件保留原上传证据；文档删除走知识生命周期');
    if (!asset || (owner && !this.matchesOwner(asset, owner))
      || !["active", "delete_queued", "delete_pending", "delete_in_progress", "deleted"].includes(asset.status)) {
      throw new NotFoundException("文件不存在或不属于当前业务对象");
    }
    if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    if (asset.status === "deleted") return { fileAssetId, status: "deleted" as const };

    try {
      await this.cleanupForTenant(tenantId, false, { fileAssetId, owner }).deleteFileAsset(tenantId, asset);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        await this.operationLog?.record({ tenantId, action: "file.delete.pending", targetType: "file", targetId: fileAssetId,
          detail: "原文件删除结果待核对", metadata: { provider: asset.storageProvider } });
      }
      throw error;
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
   * 上传会话表按稳定租户游标分批读取；每个租户仍由原清理参加者再次带 tenantId
   * 查询和抢占，不能因为某个租户的 provider 配置异常而影响其他租户。
   */
  async cleanupExpiredUploadSessionsForAllTenants(limitPerTenant = 50): Promise<FileUploadCleanupSummary> {
    const summary: FileUploadCleanupSummary = {
      scanned: 0,
      invalidated: 0,
      deletedObjects: 0,
      cleanupPending: 0,
      sessionIds: []
    };
    let afterTenantId: string | undefined;
    for (;;) {
      const tenants = await this.prisma.fileUploadSession.groupBy({
        by: ["tenantId"],
        where: afterTenantId ? { tenantId: { gt: afterTenantId } } : undefined,
        orderBy: { tenantId: "asc" },
        take: CLEANUP_TENANT_BATCH_SIZE
      });
      for (const tenant of tenants) {
        try {
          const current = await this.cleanupForTenant(tenant.tenantId, true).cleanupExpiredUploadSessions(tenant.tenantId, limitPerTenant);
          summary.scanned += current.scanned;
          summary.invalidated += current.invalidated;
          summary.deletedObjects += current.deletedObjects;
          summary.cleanupPending += current.cleanupPending;
          summary.sessionIds.push(...current.sessionIds);
        } catch {
          // 单租户配置/网络异常只保留该租户会话待下一轮处理，不能停掉全局清理循环。
        }
      }
      if (tenants.length < CLEANUP_TENANT_BATCH_SIZE) break;
      // 清理可能移除当前页记录，按原租户值继续，不依赖偏移量或游标行仍存在。
      afterTenantId = tenants[tenants.length - 1].tenantId;
    }
    return summary;
  }

  /** 删除业务记录已经从页面移除、但 provider 暂时不可达的文件。 */
  async cleanupPendingFileAssetDeletes(tenantId: string, limit = 50) {
    return this.cleanupForTenant(tenantId).cleanupPendingFileAssetDeletes(tenantId, limit);
  }

  async cleanupPendingFileAssetDeletesForAllTenants(limitPerTenant = 50) {
    let scanned = 0;
    let deleted = 0;
    let pending = 0;
    let afterTenantId: string | undefined;
    for (;;) {
      const tenants = await this.prisma.fileAsset.groupBy({
        by: ["tenantId"],
        where: {
          status: { in: ["delete_queued", "delete_pending", "delete_in_progress"] },
          tenantId: afterTenantId ? { gt: afterTenantId } : undefined
        },
        orderBy: { tenantId: "asc" },
        take: CLEANUP_TENANT_BATCH_SIZE
      });
      for (const tenant of tenants) {
        try {
          const result = await this.cleanupForTenant(tenant.tenantId, true).cleanupPendingFileAssetDeletes(tenant.tenantId, limitPerTenant);
          scanned += result.scanned;
          deleted += result.deleted;
          pending += result.pending;
        } catch {
          // 一个租户的 provider 配置异常不能阻断其他租户的文件清理。
        }
      }
      if (tenants.length < CLEANUP_TENANT_BATCH_SIZE) break;
      afterTenantId = tenants[tenants.length - 1].tenantId;
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
    const authorize = () => this.authorizeKnowledgeUpload(tenantId, input, boundOwner);
    const changed = () => new ConflictException('知识上传观察期间已变化');
    await assertOriginalFileUploadSnapshot(before, load, authorize, changed);
    await assertOriginalFileUploadSnapshot(before, load, authorize, changed);
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
    await assertOriginalFileUploadSnapshot(before, load, authorize, () => new ConflictException('原知识上传观察期间已变化'));
    await authorize();
    return before ? this.sessionSummary(before.session, before.asset, 'provider') : null;
  }

  async completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest,
    owner?: FileBusinessOwner<Revision>) {
    input = structuredClone(input); owner = structuredClone(owner);
    const session = structuredClone(await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } }));
    if (!session) throw new NotFoundException("上传会话不存在");
    const asset = structuredClone(await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } }));
    if (asset && isRentalStaffFileBinding(tenantId, asset)) return this.requireStaffFiles().completeUpload(tenantId, sessionId, input, owner);
    if (asset?.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE)
      throw new BadRequestException("专用换货影像只能核验原业务完成入口");
    this.enterprisePaymentProofFiles.assertComplete(asset, owner);
    if (!asset || owner && (!this.matchesOwner(asset, owner) || owner.actorUserId && asset.uploadedBy !== owner.actorUserId))
      throw new NotFoundException("上传会话不存在或不属于当前业务对象");
    const knowledgeInput: CreateFileUploadSessionRequest | undefined = asset.businessType === "ai_knowledge_document" ? {
      businessModule: asset.businessModule, businessType: asset.businessType, businessId: asset.businessId ?? "", uploadScene: asset.uploadScene,
      fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, idempotencyKey: session.idempotencyKey ?? "" } : undefined;
    if (knowledgeInput) {
      owner = structuredClone(owner);
      this.assertKnowledgeUploadAsset(asset, owner);
      if (session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey || session.fileAssetId !== asset.id)
        throw new ConflictException("知识上传绑定已变化");
      await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
    } else if (owner) await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner.workspaceId);
    const updated = await completeOriginalFileUpload({ asset, session, request: input }, {
      allowSimulation: process.env.NODE_ENV !== "production",
      runtimeConfig: provider => this.integrations.runtimeConfig("file", tenantId, provider as never, { requireLiveTest: false }),
      expireUpload: original => this.failSession(tenantId, original.id, "上传会话已过期"),
      freeze: (snapshot, config) => freezeFileUploadContent<
        Prisma.FileAssetGetPayload<object>, Prisma.FileUploadSessionGetPayload<object>, Prisma.TransactionClient
      >({ tenantId, asset: snapshot.asset, session: snapshot.session, config, checksum: input.checksum }, {
        transaction: work => this.businessTransaction(tenantId, work),
        beforeClaim: async tx => {
          if (knowledgeInput) await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
          else await this.assertBusinessReference(tenantId, snapshot.asset.businessType, snapshot.asset.businessId ?? "", owner?.workspaceId, tx);
        },
        assertConfiguration: (tx, current) => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", current.provider,
          { configRevision: current.revision }),
        readContent: (current, key, mimeType, sizeBytes) => this.readObjectContent(current, key, mimeType, sizeBytes),
        writeContent: async (current, key, mimeType, bytes) => {
          await this.assertUploadDispatch(tenantId, snapshot.session.id, snapshot.asset.id, owner, { storageKey: key, config: current });
          const signed = this.presign(current, "PUT", key, mimeType, new Date(Date.now() + 60_000));
          return this.objectRequest(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(bytes) });
        },
        ...(knowledgeInput ? { readPendingContent: async () => {
          const content = await this.knowledgeFiles?.readUploadContent?.(tenantId, snapshot.asset.id, owner!);
          if (!content || !(content.bytes instanceof Uint8Array) || content.bytes.byteLength !== snapshot.asset.sizeBytes)
            throw new ServiceUnavailableException("知识上传原字节读取未配置或不可用");
          return content;
        } } : {})
      }),
      completionMetadata: snapshot => {
        if (!knowledgeInput) return {};
        if (!snapshot.frozen) throw new ServiceUnavailableException("知识上传正式内容冻结证据未配置");
        return { knowledgeContentHash: snapshot.frozen.checksum };
      },
      activate: (snapshot, metadata) => {
        const { asset: currentAsset, session: currentSession, frozen } = snapshot;
        return activateOriginalFileUpload<Prisma.FileAssetGetPayload<object>, Prisma.TransactionClient>({
          tenantId, assetId: currentAsset.id, sessionId: currentSession.id, metadata, frozen,
          ...(knowledgeInput || frozen ? {
            sessionVersion: { updatedAt: currentSession.updatedAt, fileAssetId: currentAsset.id,
              provider: currentAsset.storageProvider, storageKey: currentAsset.storageKey },
            assetVersion: { updatedAt: currentAsset.updatedAt, storageProvider: currentAsset.storageProvider,
              storageKey: currentAsset.storageKey, uploadedBy: currentAsset.uploadedBy }
          } : {})
        }, {
          transaction: work => this.prisma.$transaction(async tx => {
            // 已派发的冻结结果只收口原文件收据，模拟仍按原新写入锁租户。
            if (!frozen) await lockRentalBusinessTenant(tx, tenantId);
            return work(tx);
          }),
          beforeActivate: async tx => {
            if (frozen) {
              await assertOriginalFileUploadSnapshot({ asset: currentAsset, session: currentSession }, async () => {
                const [latestAsset, latestSession] = await Promise.all([
                  tx.fileAsset.findFirst({ where: { id: currentAsset.id, tenantId } }),
                  tx.fileUploadSession.findFirst({ where: { id: currentSession.id, tenantId } })
                ]);
                return { asset: latestAsset, session: latestSession };
              }, () => this.integrations.assertEnabledInTransaction(tx, tenantId, "file", frozen.config.provider,
                { configRevision: frozen.config.revision }),
              () => new ConflictException("文件或原上传会话在内容冻结期间已变化"));
              if (!knowledgeInput) await this.assertBusinessReference(tenantId, currentAsset.businessType, currentAsset.businessId ?? "", owner?.workspaceId, tx);
            }
            if (knowledgeInput) {
              await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
              const [latestAsset, latestSession] = await Promise.all([
                tx.fileAsset.findFirst({ where: { id: currentAsset.id, tenantId } }),
                tx.fileUploadSession.findFirst({ where: { id: currentSession.id, tenantId } })
              ]);
              if (JSON.stringify(latestAsset) !== JSON.stringify(currentAsset) || JSON.stringify(latestSession) !== JSON.stringify(currentSession))
                throw new ConflictException("知识上传绑定在读取正文后已变化");
            }
          }
        });
      },
      afterComplete: async (snapshot, originallyCompleted) => {
        if (!knowledgeInput) return;
        if (!originallyCompleted) await this.authorizeKnowledgeUpload(tenantId, knowledgeInput, owner);
        await this.assertKnowledgeBinding(tenantId, snapshot.asset.id, owner!, owner?.knowledgeRevision ? {
          documentVersion: owner.knowledgeRevision.targetVersion, expectedRevision: owner.knowledgeRevision.expectedRevision } : undefined);
      }
    });
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
    const snapshot = structuredClone({ session, asset, config });
    const authorize = () => this.authorizeKnowledgeUpload(tenantId, input, owner);
    const changed = () => new ConflictException('知识原上传在签发期间已变化');
    await this.businessTransaction(tenantId, async tx => {
      await this.integrations.assertEnabledInTransaction(tx, tenantId, 'file', config.provider, { configRevision: config.revision });
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM file_upload_sessions WHERE tenantId=${tenantId} AND id=${session.id} FOR UPDATE`);
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM FileAsset WHERE tenantId=${tenantId} AND id=${asset.id} FOR UPDATE`);
      const currentConfig = await this.integrations.runtimeConfig('file', tenantId, session.provider as never);
      const readSnapshot = async () => {
        const [currentSession, currentAsset] = await Promise.all([
          tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }),
          tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } })
        ]);
        return { session: currentSession, asset: currentAsset, config: currentConfig };
      };
      // 配置读取后的授权等待先于末次文件读取，Date变化由这次快照捕获。
      // 原锁覆盖比较后的授权复验，读取让出执行后仍须核对当前ACL。
      await assertOriginalFileUploadSnapshot(snapshot, readSnapshot, authorize, changed);
      await authorize();
    });
    if (session.expiresAt.getTime() <= Date.now()) throw changed();
    return { ...this.sessionSummary(session, asset, 'provider'), uploadUrl: signed.url, uploadHeaders: signed.headers };
  }

  /** Recover only the original still-pending upload grant. Terminal observations
   * never issue PUT credentials, and config changes cannot rebind an old key. */
  private async originalUploadSummary(tenantId: string, session: Prisma.FileUploadSessionGetPayload<object>,
    asset: Prisma.FileAssetGetPayload<object>, owner?: FileBusinessOwner<Revision>) {
    session = structuredClone(session); asset = structuredClone(asset);
    const receipt = await readOriginalFileUploadReceipt({ tenantId, session, asset, owner }, {
      isTenantSharedBinding: file => ["customer", "customer_profile", "membership_review"].includes(file.businessType),
      assertBusinessReference: () => this.businessTransaction(tenantId, tx =>
        this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId, tx)),
      runtimeConfig: () => this.integrations.runtimeConfig("file", tenantId, session.provider as never, { requireLiveTest: false }),
      readSession: () => this.prisma.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }),
      readAsset: () => this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
      signPendingPut: (config, storageKey, mimeType, expiresAt) => this.presign(config, "PUT", storageKey, mimeType, expiresAt)
    });
    if (!receipt.uploadUrl) return receipt;
    const changed = () => new ConflictException("原上传会话在续签期间已变化");
    // helper的末次配置读取已经让出执行，返PUT前沿原同事务权威核当前主体/Core及原文件。
    await this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const config = await this.integrations.runtimeConfig("file", tenantId, session.provider as never, { requireLiveTest: false });
      if (!config || (asset.metadata as JsonRecord | null)?.uploadConfigHash !== requestFingerprint({
        id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials
      })) throw changed();
      await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", config.provider,
        { configRevision: config.revision, requireLiveTest: false });
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM file_upload_sessions WHERE tenantId=${tenantId} AND id=${session.id} FOR UPDATE`);
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM FileAsset WHERE tenantId=${tenantId} AND id=${asset.id} FOR UPDATE`);
      const readSnapshot = async () => {
        const [currentSession, currentAsset] = await Promise.all([
          tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }),
          tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } })
        ]);
        return { session: currentSession, asset: currentAsset };
      };
      await assertOriginalFileUploadSnapshot({ session, asset }, readSnapshot,
        () => this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", owner?.workspaceId, tx), changed);
      // 配置和文件锁覆盖读取后的末次会话/角色/Core复验，沿同一租约核对当前权限。
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted });
    if (session.expiresAt.getTime() <= Date.now()) throw changed();
    return receipt;
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

  /** Only an acknowledged original claim can dispatch DELETE. The worker's
   * system authority is separate from HTTP Auth; neither can replace the other.
   * Result CAS and an already-admitted HEAD never re-enter new business admission. */
  private cleanupForTenant(tenantId: string, worker = false,
    deletion?: { fileAssetId: string; owner?: FileBusinessOwner<Revision> }) {
    const prisma = this.prisma;
    const authority = worker ? this.native.cleanupAuthority : undefined;
    const transactions = createOriginalFileCleanupTransactions<Prisma.TransactionClient>(tenantId, {
      transaction: work => prisma.$transaction(work, {
        isolationLevel: prismaRuntime.TransactionIsolationLevel.ReadCommitted
      }),
      authorize: async (tx, boundary, beforeFileLocks) => {
        if (authority) {
          await authority.assert(tx, boundary, beforeFileLocks);
        } else {
          await lockRentalBusinessTenant(tx, tenantId);
          if (deletion) {
            const asset = boundary.asset;
            if (boundary.operation !== "pending_delete" || asset.id !== deletion.fileAssetId
              || deletion.owner && !this.matchesOwner(asset, deletion.owner)) {
              throw new ConflictException("原删除文件业务归属已变化");
            }
            await this.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? "", deletion.owner?.workspaceId, tx);
          }
          await beforeFileLocks?.();
        }
      },
      assertConfiguration: (tx, config) => this.integrations.assertEnabledInTransaction(
        tx, tenantId, "file", config.provider, { configRevision: config.revision, requireLiveTest: false }
      ),
      assertObjectBinding: (boundary, request) => {
        const metadata = boundary.asset.metadata as JsonRecord | null;
        if ((authority || deletion) && metadata?.storageLocationHash !== fileStorageLocationHash(request.config)) {
          throw new ConflictException("原文件清理占用、对象或运输依据已变化");
        }
      }
    });
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
      ...transactions,
      runtimeConfig: (currentTenant, provider) => this.integrations.runtimeConfig(
        "file", currentTenant, provider as never, { requireLiveTest: false }
      ),
      excludedUploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
      deleteObject: (config, storageKey, at) => this.deleteObject(config, storageKey, at),
      presign: (config, method, storageKey, mimeType, expiresAt) => this.presign(config, method, storageKey, mimeType, expiresAt),
      objectRequest: (url, init) => this.objectRequest(url, init),
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
      await failOriginalFileUpload(tx, tenantId, sessionId, reason);
    });
  }
  constructor(private readonly prisma: RentalFileRuntimeStorage,
    private readonly integrations: Pick<TenantIntegrationService, "runtimeConfig" | "assertEnabledInTransaction">,
    private readonly native: RentalFileStorageParticipants<Revision>) {
    super();
    if (native.cleanupAuthority !== undefined && typeof native.cleanupAuthority.assert !== "function")
      throw new ServiceUnavailableException("Rental 文件清理系统权威未配置");
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
