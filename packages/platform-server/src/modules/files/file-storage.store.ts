/** 文件私有持久端口仅描述原平台文件表。业务表、业务授权和特殊证据仍由所属参加者维护。 */
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

export interface FileStorageOwner {
  businessType?: string;
  businessId?: string;
  uploadScene?: string;
  workspaceId?: string;
  actorUserId?: string;
  actorName?: string;
}

export interface StoredFileAsset {
  id: string;
  tenantId: string;
  businessModule: string;
  businessType: string;
  businessId: string | null;
  fileName: string;
  fileExt: string | null;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  publicUrl: string | null;
  checksum: string | null;
  uploadScene: string;
  status: string;
  uploadedBy: string | null;
  metadata: PlatformJsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredFileUploadSession {
  id: string;
  tenantId: string;
  fileAssetId: string;
  provider: string;
  storageKey: string;
  status: string;
  idempotencyKey: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  cleanupAttempts: number;
  lastCleanupAt: Date | null;
  cleanupError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type FileAssetCreate = Omit<StoredFileAsset, "checksum" | "createdAt" | "updatedAt" | "metadata"> & {
  metadata: { [key: string]: PlatformJsonValue | undefined };
};
export interface FileAssetListQuery {
  where: {
    tenantId: string;
    businessModule?: string;
    businessType?: string;
    businessId?: string;
    uploadScene?: string;
    status?: string;
    NOT?: { uploadScene: string };
  };
  orderBy: { createdAt: "desc" };
  take: number;
}

export interface FileStorageTransaction {
  fileAsset: {
    findMany(query: FileAssetListQuery): PromiseLike<StoredFileAsset[]>;
    create(query: { data: FileAssetCreate }): PromiseLike<StoredFileAsset>;
  };
  fileUploadSession: {
    findFirst(query: { where: { tenantId: string; id?: string; idempotencyKey?: string } }): PromiseLike<StoredFileUploadSession | null>;
    create(query: { data: Pick<StoredFileUploadSession, "id" | "tenantId" | "fileAssetId" | "provider" | "storageKey" | "status" | "idempotencyKey" | "expiresAt"> }): PromiseLike<StoredFileUploadSession>;
  };
}
