/** 公共文件应用所需的原文件表能力。宿主以自身schema的同一事务实现，领域表经业务参加者访问。 */
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import type { FileCleanupTransaction } from "./file-cleanup";
import type { FileContentFreezeTransaction } from "./file-content-freeze";
import type { FileStorageTransaction, StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

interface FileActivationTransaction {
  fileAsset: {
    findFirst(query: { where: { id: string; tenantId: string; status?: string } }): PromiseLike<StoredFileAsset | null>;
    findUniqueOrThrow(query: { where: { id: string } }): PromiseLike<StoredFileAsset>;
    updateMany(query: {
      where: { id: string; tenantId: string; status: string; updatedAt?: Date; storageProvider?: string; storageKey?: string; uploadedBy?: string | null };
      data: { status: string; storageKey?: string; checksum?: string; metadata?: { [key: string]: PlatformJsonValue | undefined } };
    }): PromiseLike<{ count: number }>;
  };
  fileUploadSession: {
    updateMany(query: {
      where: { id: string; tenantId: string; status: string; updatedAt?: Date; fileAssetId?: string; provider?: string; storageKey?: string };
      data: { status: string; completedAt?: Date; failureReason?: string | null; storageKey?: string; cleanupError?: string };
    }): PromiseLike<{ count: number }>;
  };
}

export type FileStorageApplicationTransaction = FileStorageTransaction
  & FileContentFreezeTransaction<StoredFileAsset, StoredFileUploadSession>
  & FileActivationTransaction & FileCleanupTransaction;
