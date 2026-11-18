/** Rental专用换货影像的暂存、冻结与原目标恢复。所属业务先裁定订单及来源授权，
 * 本服务使用原事务与受限对象操作核验字节，并保留同一冻结内容和完成收据。 */
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { fileStorageLocationHash, frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import type { CreateFileUploadSessionRequest } from "@rental-os/platform-contracts/files";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { MAX_FILE_BYTES, type FileStorageOwner, type FileStoragePrimitives, type FileStorageRepository, type OriginalFileUploadFacts } from "@rental-os/platform-server/files";
import type { TenantIntegrationRuntimeConfig, TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import type { RentalExchangeInspectionFileProof } from "./exchange-inspection-ports";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "./exchange-inspection-preparation";

type ExchangeInspectionUploadOwner = FileStorageOwner & { exchangeInspectionSourceId?: string };
type ExchangeInspectionFrozenEvidence = Pick<RentalExchangeInspectionFileProof, "sourceId" | "contentHash" | "sizeBytes" | "mimeType" | "width" | "height">;
type JsonRecord = Record<string, unknown>;
const UPLOAD_TTL_SECONDS = 15 * 60;

// Prisma rows include Dates. The request canonicalizer only accepts JSON values.
const fileFactHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export type RentalExchangeInspectionStoragePlan<Owner extends ExchangeInspectionUploadOwner> = OriginalFileUploadFacts<Owner> & {
  config: TenantIntegrationRuntimeConfig;
  configRowHash: string;
  storageLocationHash: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
};

interface RentalExchangeInspectionFilePorts<Owner extends ExchangeInspectionUploadOwner> {
  validateInput: FileStoragePrimitives["validateInput"];
  storageKey: FileStoragePrimitives["storageKey"];
  presign: FileStoragePrimitives["presign"];
  matchesOwner: FileStoragePrimitives["matchesOwner"];
  readObjectContent: FileStoragePrimitives["readObjectContent"];
  objectRequest: FileStoragePrimitives["objectRequest"];
  persistUploadFacts(tx: Prisma.TransactionClient, tenantId: string, facts: OriginalFileUploadFacts<Owner>, config: TenantIntegrationRuntimeConfig): ReturnType<FileStorageRepository["persistUploadFacts"]>;
  readInspectionMedia(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<{
    contentHash: string; sizeBytes: number; mediaType: string; width: number | null; height: number | null;
  }>;
}

export class RentalExchangeInspectionFileStorage<Owner extends ExchangeInspectionUploadOwner> {
  constructor(private readonly prisma: Pick<PrismaClient, "$transaction" | "fileAsset" | "tenantIntegrationConfig">,
    private readonly integrations: Pick<TenantIntegrationService, "runtimeConfig" | "assertEnabledInTransaction">,
    private readonly ports: RentalExchangeInspectionFilePorts<Owner>) {}

  /** Internal plan only: no object request or file write occurs before the caller's transaction. */
  async planExchangeInspectionUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner: Owner): Promise<RentalExchangeInspectionStoragePlan<Owner>> {
    const mimeType = this.ports.validateInput(input);
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
    const storageKey = this.ports.storageKey(config, tenantId, assetId, "blob");
    if (storageKey.length > 380) throw new ConflictException("文件对象定位过长，不能创建安全上传会话");
    const signed = this.ports.presign(config, "PUT", storageKey, mimeType, expiresAt);
    return { input: structuredClone(input), owner: structuredClone(owner), assetId, sessionId, expiresAt, provider: config.provider, storageKey, mimeType, mode: "provider", config,
      configRowHash: fileFactHash(configRow), storageLocationHash: fileStorageLocationHash(config), uploadUrl: signed.url, uploadHeaders: signed.headers };
  }
  async persistExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, plan: RentalExchangeInspectionStoragePlan<Owner>) {
    await this.integrations.assertEnabledInTransaction(tx, tenantId, "file", plan.config.provider, { requireDefault: true });
    const configRow = await tx.tenantIntegrationConfig.findFirst({ where: { id: plan.config.id, tenantId } });
    if (!configRow || fileFactHash(configRow) !== plan.configRowHash || plan.expiresAt.getTime() <= Date.now()) throw new ConflictException("原上传文件配置或会话已变化");
    const input = { ...plan.input, metadata: { exchangeInspectionSourceId: plan.owner!.exchangeInspectionSourceId, storageLocationHash: plan.storageLocationHash } };
    return this.ports.persistUploadFacts(tx, tenantId, { ...plan, input }, plan.config);
  }

  private async exchangeInspectionAsset(tenantId: string, fileAssetId: string, owner: Owner) {
    if (!owner.actorUserId || !owner.workspaceId || !owner.exchangeInspectionSourceId || owner.businessType !== "rental_order"
      || owner.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("专用影像原归属无效");
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    const metadata = asset?.metadata as JsonRecord | null | undefined, session = asset?.uploadSession;
    if (!asset || !this.ports.matchesOwner(asset, owner) || metadata?.workspaceId !== owner.workspaceId || metadata.exchangeInspectionSourceId !== owner.exchangeInspectionSourceId
      || asset.storageProvider === "local_mock" || !session || session.fileAssetId !== asset.id || session.tenantId !== tenantId
      || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey) throw new NotFoundException("专用影像原文件归属不可核验");
    return { asset, session };
  }
  async inspectExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: Owner, configRowHash: string, storageLocationHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    if (asset.status !== "pending_upload" || session.status !== "pending_upload" || !["image/png", "image/jpeg"].includes(asset.mimeType)) throw new ConflictException("原影像只能核对原会话结果");
    const configRow = await this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, provider: asset.storageProvider, capability: "file" } });
    if (!configRow || fileFactHash(configRow) !== configRowHash) throw new ConflictException("原影像存储配置已变化");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || fileStorageLocationHash(config) !== storageLocationHash) throw new ServiceUnavailableException("原影像存储位置不可核验");
    const originalMetadata = asset.metadata as JsonRecord;
    if (originalMetadata.fileUploadVersion !== 2 || asset.storageKey !== this.ports.storageKey(config, tenantId, fileAssetId, "blob")) {
      throw new ConflictException("原影像缺少受控暂存依据，保留原记录待核对");
    }
    // Reuse the original bounded object transport. This invocation's Core claim
    // owns the only staging GET; the validated bytes, not a later mutable copy,
    // are written to a server-only destination under the existing freeze format.
    const bytes = await this.ports.readObjectContent(config, asset.storageKey, asset.mimeType, asset.sizeBytes);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const stream = new ReadableStream<Uint8Array>({ start(reader) { reader.enqueue(new Uint8Array(bytes)); reader.close(); } });
      const content = await this.ports.readInspectionMedia(stream, asset.sizeBytes, controller.signal);
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
      const signed = this.ports.presign(config, "PUT", destination, asset.mimeType, new Date(Date.now() + 60000));
      const written = await this.ports.objectRequest(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(bytes) });
      if (!written.ok) throw new ServiceUnavailableException("原影像内容冻结结果未知，只能核对已登记目标");
      const observed = await this.ports.readObjectContent(config, destination, asset.mimeType, asset.sizeBytes);
      if (createHash("sha256").update(observed).digest("hex") !== evidence.contentHash) throw new ConflictException("原影像冻结字节与已核验内容不同");
      return { ...evidence, assetHash: fileFactHash(claimed.asset), sessionHash: fileFactHash(claimed.session), configRowHash, storageLocationHash };
    } finally { clearTimeout(timer); }
  }

  private exchangeFrozenEvidence(asset: { id: string; tenantId: string; storageProvider: string; storageKey: string; checksum: string | null; metadata: unknown; sizeBytes: number; mimeType: string }, owner: Owner) {
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
  async reconcileExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: Owner, configRowHash: string, storageLocationHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    if (asset.status === "pending_upload" && session.status === "pending_upload") return undefined;
    if (!(asset.status === "pending_upload" && session.status === "freeze_pending" || asset.status === "active" && session.status === "completed")) throw new ConflictException("原影像冻结状态不可核对");
    const evidence = this.exchangeFrozenEvidence(asset, owner);
    const configRow = await this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, provider: asset.storageProvider, capability: "file" } });
    if (!configRow || fileFactHash(configRow) !== configRowHash) throw new ConflictException("原影像冻结配置已变化");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || fileStorageLocationHash(config) !== storageLocationHash || !frozenFileContentHash(asset, config)) throw new ConflictException("原影像冻结位置不可核对");
    const bytes = await this.ports.readObjectContent(config, asset.storageKey, evidence.mimeType, evidence.sizeBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== evidence.contentHash) throw new ConflictException("原影像冻结目标尚未核验，不能另写或重传");
    const after = await this.exchangeInspectionAsset(tenantId, fileAssetId, owner);
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException("原影像冻结依据在核对期间已变化");
    return { ...evidence, assetHash: fileFactHash(asset), sessionHash: fileFactHash(session), configRowHash, storageLocationHash };
  }

  /** Core supplies the verified original preparation's factual owner and hash.
   * Return bounded immutable bytes, never a PUT/GET ticket or storage key. */
  async readFrozenExchangeInspectionEvidence(tenantId: string, fileAssetId: string, owner: Owner, contentHash: string) {
    const before = structuredClone(await this.exchangeInspectionAsset(tenantId, fileAssetId, owner)), { asset, session } = before;
    const evidence = this.exchangeFrozenEvidence(asset, owner);
    if (asset.status !== "active" || session.status !== "completed" || evidence.contentHash !== contentHash
      || (asset.metadata as JsonRecord).exchangeInspectionContentHash !== contentHash) throw new ConflictException("原检查照片尚未正式接受或内容不一致");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config || !frozenFileContentHash(asset, config)) throw new ConflictException("原检查照片存储位置已变化");
    const bytes = await this.ports.readObjectContent(config, asset.storageKey, evidence.mimeType, evidence.sizeBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== contentHash) throw new ConflictException("原检查照片读取字节与同意材料不一致");
    const after = await this.exchangeInspectionAsset(tenantId, fileAssetId, owner);
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException("原检查照片读取期间发生变化");
    return { bytes, mimeType: evidence.mimeType, contentHash, sizeBytes: evidence.sizeBytes };
  }
  async completeExchangeInspectionUpload(tx: Prisma.TransactionClient, tenantId: string, fileAssetId: string, owner: Owner,
    proof: RentalExchangeInspectionFileProof) {
    const asset = await tx.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    const metadata = asset?.metadata as JsonRecord | null | undefined;
    if (!owner.exchangeInspectionSourceId || owner.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE || !asset?.uploadSession || !metadata || !this.ports.matchesOwner(asset, owner)
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
}
