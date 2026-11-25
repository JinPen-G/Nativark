/** Rental企业原凭证与检查附件字节读取，沿原绑定、冻结摘要和读取后复验。实际媒体解码由宿主原检查参加者提供。 */
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import { MAX_FILE_BYTES, type FileStorageOwner, type FileStoragePrimitives } from "@rental-os/platform-server/files";
import { assertOutboundUrl } from "@rental-os/platform-server/outbound-url";
import type { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { ENTERPRISE_PAYMENT_PROOF_SCENE } from "./enterprise-workflows";

type JsonRecord = Record<string, unknown>;

interface RentalEvidenceFilePorts {
  presign: FileStoragePrimitives["presign"];
  matchesOwner: FileStoragePrimitives["matchesOwner"];
  assertBusinessReference(tenantId: string, businessType: string, businessId: string, workspaceId?: string): Promise<void>;
  inspectionObjectReader?: {
    open(reference: { tenantId: string; workspaceId: string; fileAssetId: string; provider: string; storageKey: string },
      signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  };
  readInspectionMedia(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<{
    bytes: Buffer; sizeBytes: number; contentHash: string; mediaType: string;
    width: number | null; height: number | null; durationMs: number | null;
  }>;
}

export class RentalEvidenceFileStorage {
  constructor(private readonly prisma: Pick<PrismaClient, "fileAsset">,
    private readonly integrations: Pick<TenantIntegrationService, "runtimeConfig">,
    private readonly ports: RentalEvidenceFilePorts) {}

  async readAuthorityBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string) {
    return this.readEnterpriseEvidenceBytes(tenantId, fileAssetId, applicantCustomerId, { businessType: "customer", businessId: applicantCustomerId, uploadScene: "enterprise-authority" });
  }

  async readPaymentProofBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, orderId: string, workspaceId: string, contentHash: string) {
    if (!workspaceId || !orderId || !/^[a-f0-9]{64}$/u.test(contentHash)) throw new BadRequestException("原费用回款凭证字节绑定无效");
    return this.readEnterpriseEvidenceBytes(tenantId, fileAssetId, applicantCustomerId,
      { businessType: "rental_order", businessId: orderId, workspaceId, uploadScene: ENTERPRISE_PAYMENT_PROOF_SCENE }, contentHash);
  }

  private async readEnterpriseEvidenceBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, owner: FileStorageOwner, contentHash?: string) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { tenantId, id: fileAssetId, businessType: owner.businessType, businessId: owner.businessId, uploadedBy: applicantCustomerId, uploadScene: owner.uploadScene, status: "active" }, include: { uploadSession: true } });
    if (!asset || asset.storageProvider === "local_mock" || asset.uploadSession?.status !== "completed" || !asset.uploadSession.completedAt
      || !["application/pdf", "image/png", "image/jpeg"].includes(asset.mimeType) || asset.sizeBytes < 1 || asset.sizeBytes > MAX_FILE_BYTES) throw new NotFoundException("授权材料未真实归档或不属于当前申请");
    if (owner.uploadScene === ENTERPRISE_PAYMENT_PROOF_SCENE && (asset.businessModule !== "enterprise" || asset.checksum !== contentHash
      || (asset.metadata as JsonRecord | null)?.workspaceId !== owner.workspaceId || (asset.metadata as JsonRecord | null)?.fileUploadVersion !== 2
      || (asset.metadata as JsonRecord | null)?.fileContentVersion !== 1 || (asset.metadata as JsonRecord | null)?.contentHash !== contentHash
      || asset.uploadSession.provider !== asset.storageProvider || asset.uploadSession.storageKey !== asset.storageKey)) throw new ConflictException("原费用回款凭证冻结内容不可核对");
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config) throw new ServiceUnavailableException("授权材料存储不可用");
    if (contentHash && (asset.metadata as JsonRecord | null)?.storageLocationHash !== fileStorageLocationHash(config)) throw new ConflictException("原费用回款凭证存储位置已变化");
    const signed = this.ports.presign(config, "GET", asset.storageKey, asset.mimeType, new Date(Date.now() + 60000));
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

  async readInspectionBytes(tenantId: string, fileAssetId: string, owner: FileStorageOwner, maxBytes: number, signal: AbortSignal) {
    if (!owner.workspaceId || !owner.actorUserId || owner.businessType !== 'rental_order' || !owner.businessId
      || !['pickup-evidence', 'return-evidence'].includes(owner.uploadScene ?? '')
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) throw new BadRequestException('检查证据读取参数无效');
    if (!this.ports.inspectionObjectReader) throw new ServiceUnavailableException('非URL受控检查存储读取未配置');
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: 'active', uploadedBy: owner.actorUserId }, include: { uploadSession: true } });
    if (!asset || !this.ports.matchesOwner(asset, owner) || asset.uploadSession?.status !== 'completed' || !asset.uploadSession.completedAt
      || asset.uploadSession.tenantId !== tenantId || asset.uploadSession.storageKey !== asset.storageKey) throw new NotFoundException('检查附件不属于当前业务或未完成上传');
    await this.ports.assertBusinessReference(tenantId, asset.businessType, asset.businessId ?? '', owner.workspaceId);
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
      const opening = this.ports.inspectionObjectReader.open({ tenantId, workspaceId: owner.workspaceId, fileAssetId,
        provider: asset.storageProvider, storageKey: asset.storageKey }, controller.signal).then(async stream => {
        if (controller.signal.aborted) { await stream.cancel().catch(() => undefined); throw new ServiceUnavailableException('检查读取已取消'); }
        return stream;
      });
      let stream: ReadableStream<Uint8Array>;
      try { stream = await Promise.race([opening, aborted]); }
      finally { controller.signal.removeEventListener('abort', rejectOpening); }
      const result = await this.ports.readInspectionMedia(stream, maxBytes, controller.signal);
      if (result.mediaType !== asset.mimeType.split(';', 1)[0].trim().toLowerCase()) throw new BadRequestException('检查附件实际格式与登记类型不同');
      const after = await this.prisma.fileAsset.findFirst({ where: { id: asset.id, tenantId, status: 'active', updatedAt: asset.updatedAt, uploadedBy: owner.actorUserId } });
      if (!after || after.storageKey !== asset.storageKey) throw new ConflictException('读取期间附件已变化');
      if (controller.signal.aborted) throw new ServiceUnavailableException('检查读取已取消');
      return result;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }
}
