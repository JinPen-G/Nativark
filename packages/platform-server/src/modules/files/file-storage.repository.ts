/** 原文件元数据、上传会话和原键回执的持久实现。调用方供给原同一事务及已授权事实。
 * 这里只负责原文件表，不从businessId、workspaceId或metadata授予业务权限。 */
import { BadRequestException } from "@nestjs/common";
import type { CreateFileUploadSessionRequest, FileAssetQuery, FileAssetSummary } from "@rental-os/platform-contracts/files";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import type { FileStorageOwner, FileStorageTransaction, StoredFileAsset } from "./file-storage.store";

export interface FileUploadFacts {
  input: CreateFileUploadSessionRequest;
  owner?: FileStorageOwner;
  assetId: string;
  sessionId: string;
  expiresAt: Date;
  provider: string;
  storageKey: string;
  mode: "provider" | "simulation";
  mimeType: string;
}

export class FileStorageRepository {
  constructor(private readonly database: FileStorageTransaction) {}

  async listFiles(tenantId: string, query: FileAssetQuery = {}, excludedScene?: string): Promise<FileAssetSummary[]> {
    if (!tenantId) throw new BadRequestException("文件读取缺少当前租户");
    const rows = await this.database.fileAsset.findMany({ where: { tenantId, businessModule: query.businessModule,
      businessType: query.businessType, businessId: query.businessId, uploadScene: query.uploadScene, status: query.status,
      ...(excludedScene ? { NOT: { uploadScene: excludedScene } } : {}) }, orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(Number(query.limit ?? 80), 1), 200) });
    return rows.map(fileAssetSummary);
  }

  findUploadSession(tenantId: string, reference: { id: string } | { idempotencyKey: string }) {
    if (!tenantId) throw new BadRequestException("上传观察缺少当前租户");
    return this.database.fileUploadSession.findFirst({ where: { tenantId, ...reference } });
  }

  async persistUploadFacts(tx: FileStorageTransaction, tenantId: string, facts: FileUploadFacts, metadata: Record<string, unknown>) {
    if (!tenantId) throw new BadRequestException("上传事实缺少当前租户");
    const { input, owner, assetId, sessionId, expiresAt, provider, storageKey, mimeType } = facts;
    const asset = await tx.fileAsset.create({ data: { id: assetId, tenantId, businessModule: input.businessModule.trim(),
      businessType: input.businessType.trim(), businessId: input.businessId.trim(), fileName: input.fileName.trim().slice(0, 180),
      fileExt: input.fileName.includes(".") ? input.fileName.split(".").pop()?.slice(0, 20) ?? null : null,
      mimeType, sizeBytes: input.sizeBytes, storageProvider: provider, storageKey, publicUrl: null, uploadScene: input.uploadScene.trim(),
      status: "pending_upload", uploadedBy: owner?.actorUserId ?? null,
      // metadata沿原调用方的JSON对象交给同一ORM验证，不在迁移层重序列化或改写历史值。
      metadata: metadata as { [key: string]: PlatformJsonValue | undefined } } });
    const session = await tx.fileUploadSession.create({ data: { id: sessionId, tenantId, fileAssetId: asset.id, provider, storageKey,
      status: "pending_upload", idempotencyKey: input.idempotencyKey.trim(), expiresAt } });
    return { asset, session };
  }
}

/** 原API文件投影仅释放文件事实。读取ACL在投影之后继续按当前业务范围过滤。 */
export function fileAssetSummary(row: StoredFileAsset): FileAssetSummary {
  return { id: row.id, businessModule: row.businessModule, businessType: row.businessType, businessId: row.businessId ?? undefined,
    fileName: row.fileName, fileExt: row.fileExt ?? undefined, mimeType: row.mimeType, sizeBytes: row.sizeBytes,
    storageProvider: row.storageProvider,
    uploadScene: row.uploadScene, status: row.status, uploadedBy: row.uploadedBy ?? undefined, createdAt: row.createdAt.toISOString() };
}
