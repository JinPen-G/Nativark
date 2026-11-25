/** 文件应用的真实业务参加者由受控宿主按原module/type/scene登记。
 * 每次调用仍核当前主体、Core/对象/范围和领域证据，登记本身不授予文件访问权。 */
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { FileStorageOwner, StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

export interface FileStorageBinding {
  businessModule: string;
  businessType: string;
  uploadScene: string;
}

export interface FileUploadAuthorityContext<Owner extends FileStorageOwner> {
  tenantId: string;
  request: CreateFileUploadSessionRequest;
  owner?: Owner;
}

export interface FileAssetAuthorityContext<Owner extends FileStorageOwner> {
  tenantId: string;
  asset: StoredFileAsset;
  owner?: Owner;
  operation: "receipt" | "complete" | "download";
}

export interface FileCompletionAuthorityContext<Owner extends FileStorageOwner> extends FileAssetAuthorityContext<Owner> {
  session: StoredFileUploadSession;
  request: CompleteFileUploadRequest;
  contentHash?: string;
}

export interface FileStorageAuthority<Owner extends FileStorageOwner, Transaction> {
  readonly binding: Readonly<FileStorageBinding>;
  /** 原ALS/会话/角色/范围的版本指纹，供等待审计后的撤权复验。 */
  authorityKey(tenantId: string): string;
  assertUpload(context: FileUploadAuthorityContext<Owner>, transaction?: Transaction): Promise<void>;
  assertAsset(context: FileAssetAuthorityContext<Owner>, transaction?: Transaction): Promise<void>;
  isTenantSharedBinding(asset: StoredFileAsset): boolean;
  /** 专用入口可补入经过原业务验证的证据，仍须保持原登记的文件路由。 */
  prepareUpload?(context: FileUploadAuthorityContext<Owner>): Promise<CreateFileUploadSessionRequest>;
  uploadMetadata?(context: FileUploadAuthorityContext<Owner>): Record<string, unknown>;
  validateConfiguration?(context: FileUploadAuthorityContext<Owner>, config: TenantIntegrationRuntimeConfig | undefined): void;
  assertReplay?(context: FileUploadAuthorityContext<Owner>, asset: StoredFileAsset): void;
  /** 知识等来源沿原专用回执及unknown解释；普通来源直接使用原回执内核。 */
  readReceipt?(context: FileUploadAuthorityContext<Owner> & {
    asset: StoredFileAsset; session: StoredFileUploadSession;
  }, readOriginal: () => Promise<FileUploadSessionSummary>): Promise<FileUploadSessionSummary>;
  readPendingContent?(context: FileCompletionAuthorityContext<Owner>): Promise<{ bytes: Uint8Array; contentHash: string }>;
  completionMetadata?(context: FileCompletionAuthorityContext<Owner>): Record<string, unknown>;
  beforeActivate?(context: FileCompletionAuthorityContext<Owner>, transaction: Transaction): Promise<void>;
  /** 原领域绑定需要与激活同事务时，在此使用原事务；不另起业务写入。 */
  afterActivate?(context: FileCompletionAuthorityContext<Owner>, transaction: Transaction): Promise<void>;
  afterComplete?(context: FileCompletionAuthorityContext<Owner>): Promise<void>;
  /** 原专用来源只按自己的提交边界解释失应答，禁止自动重建上传。 */
  creationFailed?(error: unknown, stage: "persist" | "receipt", writeAttempted: boolean): never;
}
