/** 原文件 HTTP 的有限应用参加者，沿原服务裁定列表 ACL、上传收据和客户范围。
 * 宿主供给同一实例，订单读取只声明本入口所需模型。 */
import type { PrismaClient } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type {
  CompleteFileUploadRequest, CreateFileAssetRequest, CreateFileUploadSessionRequest, FileAssetQuery,
  FileAssetSummary, FileDownloadUrlSummary, FileUploadCleanupSummary, FileUploadSessionSummary
} from "@rental-os/platform-contracts/files";
import type { FileStorageOwner } from "@rental-os/platform-server/files";

export const RENTAL_FILES_LEDGER = Symbol.for("rental-core.http.files.ledger");
export const RENTAL_FILES_STORAGE = Symbol.for("rental-core.http.files.storage");
export const RENTAL_FILES_DATABASE = Symbol.for("rental-core.http.files.database");
export const RENTAL_FILES_CUSTOMER_AUTHORITY = Symbol.for("rental-core.http.files.customer-authority");

export interface RentalFileLedgerHttpApplication {
  listFiles(query?: FileAssetQuery): Promise<FileAssetSummary[]>;
  createFile(input: CreateFileAssetRequest): Promise<FileAssetSummary>;
}

export interface RentalFileStorageHttpApplication {
  createUploadSession(tenantId: string, input: CreateFileUploadSessionRequest, owner?: FileStorageOwner): Promise<FileUploadSessionSummary>;
  completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest, owner?: FileStorageOwner): Promise<FileAssetSummary>;
  cleanupExpiredUploadSessions(tenantId: string, limit?: number): Promise<FileUploadCleanupSummary>;
  downloadUrl(tenantId: string, fileAssetId: string, owner?: FileStorageOwner): Promise<FileDownloadUrlSummary>;
}

export type RentalFileHttpDatabase = Pick<PrismaClient, "rentalOrder">;

export interface RentalFileCustomerHttpAuthority {
  assertIdentityVerificationCustomerAccess(
    tenantId: string,
    customerId: string,
    user: SystemUserRow | undefined,
    manage: boolean
  ): Promise<void>;
}
