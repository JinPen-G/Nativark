/** 原受保护文件访问引用。原业务ACL与成功审计均完成，并复核原绑定后才返回短时GET。
 * 专用证据拒绝、本人/业务归属及发布资格由所属原入口裁定，本入口没有公开读取兜底。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { FileDownloadUrlSummary } from "@rental-os/platform-contracts/files";
import { getRequestIdentity } from "../../common/request-identity";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";

export interface FileDownloadAsset {
  id: string;
  tenantId: string;
  status: string;
  businessType: string;
  businessId: string | null;
  uploadScene: string;
  storageKey: string;
  storageProvider: string;
  checksum: string | null;
  mimeType: string;
  metadata: unknown;
  updatedAt: Date;
}

export interface FileDownloadAccess<Asset> {
  authorityKey(tenantId: string): string;
  assertRead(tenantId: string, asset: Asset): Promise<void>;
}

export interface FileDownloadAudit {
  tenantId: string;
  action: "file.download-url.issue";
  targetType: "file";
  targetId: string;
  detail: string;
  requireSuccess: true;
  userId?: string;
  metadata: {
    mode: "provider" | "simulation";
    expiresAt?: string;
    audience: string;
    actorId?: string;
    businessType: string;
    businessId: string | null;
  };
}

export interface FileDownloadParticipants<Asset> {
  access: FileDownloadAccess<Asset>;
  recordAudit(input: FileDownloadAudit): Promise<unknown>;
  readAsset(): PromiseLike<Asset | null>;
  runtimeConfig(): Promise<TenantIntegrationRuntimeConfig | undefined>;
  allowSimulation: boolean;
  signGet(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, expiresAt: Date): { url: string };
}

export async function issueFileDownloadReference<Asset extends FileDownloadAsset>(
  input: { tenantId: string; fileAssetId: string; asset: Asset },
  participants: FileDownloadParticipants<Asset>
): Promise<FileDownloadUrlSummary> {
  const { tenantId, fileAssetId, asset } = input;
  if (asset.id !== fileAssetId || asset.tenantId !== tenantId || asset.status !== "active")
    throw new ConflictException("文件或读取授权已变化");
  if (!participants.access || !participants.recordAudit)
    throw new ServiceUnavailableException("文件业务读取权威或访问审计未配置");
  const actor = getRequestIdentity();
  const auditActor = { requireSuccess: true as const, ...(actor?.audience !== "client" ? { userId: actor?.userId } : {}) };
  const authority = participants.access.authorityKey(tenantId);
  const binding = (row: Asset) => requestFingerprint({ id: row.id, tenantId: row.tenantId, status: row.status,
    businessType: row.businessType, businessId: row.businessId, uploadScene: row.uploadScene,
    storageKey: row.storageKey, storageProvider: row.storageProvider, mimeType: row.mimeType,
    updatedAt: row.updatedAt.toISOString(), metadata: row.metadata });
  const originalBinding = binding(asset);
  await participants.access.assertRead(tenantId, asset);
  const recheck = async () => {
    const current = await participants.readAsset();
    if (!current || binding(current) !== originalBinding || participants.access.authorityKey(tenantId) !== authority)
      throw new ConflictException("文件或读取授权已变化");
    await participants.access.assertRead(tenantId, current);
    const afterAccess = await participants.readAsset();
    if (!afterAccess || binding(afterAccess) !== originalBinding || participants.access.authorityKey(tenantId) !== authority)
      throw new ConflictException("文件或读取授权已变化");
  };

  if (asset.storageProvider === "local_mock") {
    if (!participants.allowSimulation)
      throw new ServiceUnavailableException("生产环境禁止访问未归档的模拟文件，请先配置文件存储平台");
    const result = { fileAssetId, provider: asset.storageProvider, mode: "simulation" as const, downloadUrl: `/api/files/${fileAssetId}/download-url` };
    await participants.recordAudit({ tenantId, action: "file.download-url.issue", targetType: "file", targetId: fileAssetId,
      detail: "生成受保护文件访问引用", ...auditActor, metadata: { mode: result.mode, audience: actor?.audience ?? "public",
        actorId: actor?.userId, businessType: asset.businessType, businessId: asset.businessId } });
    await recheck();
    return result;
  }

  const config = await participants.runtimeConfig();
  if (!config) throw new ServiceUnavailableException("文件平台已停用，无法生成下载地址");
  const metadata = asset.metadata as Record<string, unknown> | null;
  if (metadata?.fileUploadVersion === 2 && !frozenFileContentHash(asset, config))
    throw new ConflictException("正式文件内容版本或原存储位置无法核实");
  await recheck();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const signed = participants.signGet(config, asset.storageKey, asset.mimeType, expiresAt);
  const result = { fileAssetId, provider: asset.storageProvider, mode: "provider" as const,
    downloadUrl: signed.url, expiresAt: expiresAt.toISOString() };
  await participants.recordAudit({ tenantId, action: "file.download-url.issue", targetType: "file", targetId: fileAssetId,
    detail: "生成短时文件访问签名", ...auditActor, metadata: { mode: result.mode, expiresAt: result.expiresAt,
      audience: actor?.audience ?? "public", actorId: actor?.userId, businessType: asset.businessType, businessId: asset.businessId } });
  await recheck();
  return result;
}
