/** 原文件/会话的激活与失败收据写入。调用方供给原事务、版本保护及领域提交复验。
 * 按会话→文件顺序CAS，迟到失败保持其他完成者已经占用的冻结结果。 */
import { ConflictException } from "@nestjs/common";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import { COMPLETED_STAGING_PENDING } from "./file-cleanup";
import type { FileActivationTransaction } from "./file-storage.application-store";
import type { StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

export interface FileUploadActivationFacts {
  tenantId: string;
  assetId: string;
  sessionId: string;
  metadata: Record<string, unknown>;
  frozen?: { storageKey: string; checksum: string };
  /** 保留调用方该历史模式原有的CAS字段，来源为已核定的原持久快照。 */
  sessionVersion?: Partial<Pick<StoredFileUploadSession, "updatedAt" | "fileAssetId" | "provider" | "storageKey">>;
  assetVersion?: Partial<Pick<StoredFileAsset, "updatedAt" | "storageProvider" | "storageKey" | "uploadedBy">>;
}

export interface FileUploadActivationParticipants<
  Asset extends StoredFileAsset,
  Transaction extends FileActivationTransaction<Asset>
> {
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  beforeActivate(transaction: Transaction): Promise<void>;
  afterActivate?(asset: Asset, transaction: Transaction): Promise<void>;
}

export async function activateOriginalFileUpload<
  Asset extends StoredFileAsset,
  Transaction extends FileActivationTransaction<Asset>
>(
  facts: FileUploadActivationFacts,
  participants: FileUploadActivationParticipants<Asset, Transaction>
): Promise<Asset> {
  return participants.transaction(async tx => {
    await participants.beforeActivate(tx);
    const sessionClaim = await tx.fileUploadSession.updateMany({
      where: {
        id: facts.sessionId,
        tenantId: facts.tenantId,
        status: facts.frozen ? "freeze_pending" : "pending_upload",
        ...facts.sessionVersion
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        failureReason: null,
        ...(facts.frozen ? { storageKey: facts.frozen.storageKey, cleanupError: COMPLETED_STAGING_PENDING } : {})
      }
    });
    if (sessionClaim.count !== 1) throw new ConflictException("上传会话已失效，请重新上传");
    const assetClaim = await tx.fileAsset.updateMany({
      where: { id: facts.assetId, tenantId: facts.tenantId, status: "pending_upload", ...facts.assetVersion },
      data: {
        status: "active",
        metadata: facts.metadata as { [key: string]: PlatformJsonValue | undefined },
        ...(facts.frozen ? { storageKey: facts.frozen.storageKey, checksum: facts.frozen.checksum } : {})
      }
    });
    if (assetClaim.count !== 1) throw new ConflictException("上传文件已失效，请重新上传");
    const asset = await tx.fileAsset.findUniqueOrThrow({ where: { id: facts.assetId } });
    await participants.afterActivate?.(asset, tx);
    return asset;
  });
}

export interface FileUploadFailureTransaction {
  fileAsset: Pick<FileActivationTransaction["fileAsset"], "updateMany">;
  fileUploadSession: Pick<FileActivationTransaction["fileUploadSession"], "updateMany"> & {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<StoredFileUploadSession | null>;
  };
}

export async function failOriginalFileUpload(
  tx: FileUploadFailureTransaction,
  tenantId: string,
  sessionId: string,
  reason: string
): Promise<boolean> {
  const session = await tx.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
  if (!session || session.status !== "pending_upload") return false;
  const claimed = await tx.fileUploadSession.updateMany({
    where: {
      id: sessionId,
      tenantId,
      status: "pending_upload",
      updatedAt: session.updatedAt,
      fileAssetId: session.fileAssetId,
      storageKey: session.storageKey
    },
    data: { status: "failed", failureReason: reason, cleanupError: "待执行过期对象清理" }
  });
  if (claimed.count !== 1) return false;
  await tx.fileAsset.updateMany({
    where: { id: session.fileAssetId, tenantId, storageKey: session.storageKey, status: "pending_upload" },
    data: { status: "failed" }
  });
  return true;
}
