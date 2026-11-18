/** 原普通上传回执及原暂存PUT续签。终态、过期及unknown仅返回原回执，保持原有效期。
 * 当前业务引用及共享对象范围由所属Core参加者核验；本入口不创建上传或重绑旧对象。 */
import { ConflictException } from "@nestjs/common";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { FileStorageOwner, StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

type ReceiptAsset = Pick<StoredFileAsset, "id" | "tenantId" | "businessType" | "status" | "storageProvider" | "storageKey" | "mimeType" | "metadata">;
type ReceiptSession = Pick<StoredFileUploadSession, "id" | "tenantId" | "fileAssetId" | "provider" | "storageKey" | "status" | "expiresAt">;

export interface FileUploadReceiptParticipants<Asset, Session> {
  /** 原Core判断共享客户资料与空间业务的范围差异。 */
  isTenantSharedBinding(asset: Asset): boolean;
  assertBusinessReference(): Promise<void>;
  runtimeConfig(): Promise<TenantIntegrationRuntimeConfig | undefined>;
  readSession(): PromiseLike<Session | null>;
  readAsset(): PromiseLike<Asset | null>;
  signPendingPut(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, expiresAt: Date): {
    url: string;
    headers: Record<string, string>;
  };
}

export async function readOriginalFileUploadReceipt<Asset extends ReceiptAsset, Session extends ReceiptSession>(
  input: { tenantId: string; asset: Asset; session: Session; owner?: FileStorageOwner },
  participants: FileUploadReceiptParticipants<Asset, Session>
): Promise<FileUploadSessionSummary> {
  const { tenantId, owner } = input;
  const session = structuredClone(input.session), asset = structuredClone(input.asset);
  const metadata = asset.metadata as Record<string, unknown> | null;
  const mode = metadata?.uploadMode === "provider" ? "provider" : "simulation";
  const summary = { sessionId: session.id, fileAssetId: asset.id, provider: session.provider, mode,
    status: session.status, expiresAt: session.expiresAt.toISOString() } as const;
  if (session.tenantId !== tenantId || asset.tenantId !== tenantId || session.fileAssetId !== asset.id
    || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey
    || owner?.workspaceId && metadata?.workspaceId && metadata.workspaceId !== owner.workspaceId
      && !participants.isTenantSharedBinding(asset)) {
    throw new ConflictException("原上传会话与文件绑定不一致");
  }
  if (session.status !== "pending_upload" || asset.status !== "pending_upload"
    || session.expiresAt.getTime() <= Date.now() || mode === "simulation") return summary;

  if (metadata?.fileUploadVersion !== 2) throw new ConflictException("旧上传会话缺少临时对象和原配置依据，须核对原会话");
  const config = await participants.runtimeConfig();
  if (!config || metadata.storageLocationHash !== fileStorageLocationHash(config)
    || metadata.uploadConfigHash !== requestFingerprint({ id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials })) {
    throw new ConflictException("文件平台配置已变化，不能续签原上传会话");
  }
  const signed = participants.signPendingPut(config, `${asset.storageKey}.pending-upload`, asset.mimeType, session.expiresAt);
  await participants.assertBusinessReference();
  const currentSession = await participants.readSession();
  const currentAsset = await participants.readAsset();
  const currentConfig = await participants.runtimeConfig();
  if (!currentSession || !currentAsset || requestFingerprint(currentSession) !== requestFingerprint(session)
    || requestFingerprint(currentAsset) !== requestFingerprint(asset) || session.expiresAt.getTime() <= Date.now()
    || !currentConfig || metadata.uploadConfigHash !== requestFingerprint({ id: currentConfig.id, provider: currentConfig.provider,
      settings: currentConfig.settings, credentials: currentConfig.credentials })) {
    throw new ConflictException("原上传会话在续签期间已变化");
  }
  return { ...summary, uploadUrl: signed.url, uploadHeaders: signed.headers };
}
