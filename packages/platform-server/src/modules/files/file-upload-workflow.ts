/** 原上传的创建重放、完成恢复及服务端字节派发。权限、领域证据和事务由所属参加者供给。
 * PUT引用的末次授权由实际回执调用方在所有读取完成后核定。
 * 始终使用原会话、原键和原冻结目标，失应答解释继续由原提交边界决定。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type {
  CompleteFileUploadRequest,
  CreateFileUploadSessionRequest,
  FileAssetSummary,
  FileUploadSessionSummary
} from "@rental-os/platform-contracts/files";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { StoredFileAsset, StoredFileUploadSession } from "./file-storage.store";

export interface FileUploadCreationParticipants<Created> {
  findOriginal(): Promise<Created | undefined>;
  replay(original: Created, source: "existing" | "unique_conflict"): Promise<FileUploadSessionSummary>;
  authorizeCreation(): Promise<void>;
  createFacts(): Promise<Created>;
  readCreatedReceipt(created: Created): Promise<FileUploadSessionSummary>;
  isUniqueConflict(error: unknown): boolean;
  creationFailed?(error: unknown, stage: "persist" | "receipt"): void;
}

export async function createOriginalFileUploadSession<Created>(
  participants: FileUploadCreationParticipants<Created>
): Promise<FileUploadSessionSummary> {
  const original = await participants.findOriginal();
  if (original) return participants.replay(original, "existing");
  await participants.authorizeCreation();
  let created: Created;
  try {
    created = await participants.createFacts();
  } catch (error) {
    if (participants.isUniqueConflict(error)) {
      const concurrent = await participants.findOriginal();
      if (concurrent) return participants.replay(concurrent, "unique_conflict");
    }
    participants.creationFailed?.(error, "persist");
    throw error;
  }
  try {
    return await participants.readCreatedReceipt(created);
  } catch (error) {
    participants.creationFailed?.(error, "receipt");
    throw error;
  }
}

export interface FileFrozenUploadContent {
  storageKey: string;
  checksum: string;
  config: TenantIntegrationRuntimeConfig;
}

export interface FileUploadCompletionSnapshot<
  Asset extends StoredFileAsset,
  Session extends StoredFileUploadSession
> {
  asset: Asset;
  session: Session;
  frozen?: FileFrozenUploadContent;
}

export interface FileUploadCompletionParticipants<
  Asset extends StoredFileAsset,
  Session extends StoredFileUploadSession
> {
  allowSimulation: boolean;
  runtimeConfig(provider: string): Promise<TenantIntegrationRuntimeConfig | undefined>;
  expireUpload(session: Session): Promise<void>;
  freeze(
    snapshot: FileUploadCompletionSnapshot<Asset, Session>,
    config: TenantIntegrationRuntimeConfig
  ): Promise<FileUploadCompletionSnapshot<Asset, Session> & { frozen: FileFrozenUploadContent }>;
  completionMetadata?(snapshot: FileUploadCompletionSnapshot<Asset, Session>): Record<string, unknown>;
  activate(snapshot: FileUploadCompletionSnapshot<Asset, Session>, metadata: Record<string, unknown>): Promise<Asset>;
  afterComplete?(snapshot: FileUploadCompletionSnapshot<Asset, Session>, originallyCompleted: boolean): Promise<void>;
}

/** 调用方先核原业务和会话归属。此后只有原状态及冻结收据决定完成或观察路径。 */
export async function completeOriginalFileUpload<
  Asset extends StoredFileAsset,
  Session extends StoredFileUploadSession
>(
  input: { asset: Asset; session: Session; request: CompleteFileUploadRequest },
  participants: FileUploadCompletionParticipants<Asset, Session>
): Promise<Asset> {
  let snapshot: FileUploadCompletionSnapshot<Asset, Session> = {
    asset: structuredClone(input.asset),
    session: structuredClone(input.session)
  };
  const request = structuredClone(input.request);
  const { asset, session } = snapshot;
  if (session.status === "completed") {
    if (asset.status !== "active") throw new ConflictException("上传结果不可用");
    if (session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey) {
      throw new ConflictException("原已完成文件绑定不一致");
    }
    if ((asset.metadata as Record<string, unknown> | null)?.fileUploadVersion === 2
      && request.checksum?.trim() && request.checksum.trim() !== asset.checksum) {
      throw new ConflictException("原完成收据与文件摘要不一致，不能重写内容");
    }
    await participants.afterComplete?.(snapshot, true);
    return asset;
  }
  const resuming = session.status === "freeze_pending" && asset.status === "pending_upload"
    && (asset.metadata as Record<string, unknown> | null)?.fileUploadVersion === 2;
  if (session.status !== "pending_upload" && !resuming) throw new ConflictException("上传会话已失效");
  if (!resuming && session.expiresAt.getTime() <= Date.now()) {
    await participants.expireUpload(session);
    throw new ConflictException("上传会话已过期，请重新上传");
  }
  if (session.provider === "local_mock" && !participants.allowSimulation) {
    throw new ServiceUnavailableException("生产环境禁止完成模拟文件上传，请先配置并验证文件存储平台");
  }
  if (session.provider !== "local_mock") {
    const config = await participants.runtimeConfig(session.provider);
    if (!config) throw new ConflictException("原上传缺少有效临时对象或文件配置依据，不能确认完成");
    snapshot = await participants.freeze(snapshot, config);
  }
  const metadata = {
    ...((snapshot.asset.metadata ?? {}) as Record<string, unknown>),
    ...participants.completionMetadata?.(snapshot),
    completedAt: new Date().toISOString(),
    ...(snapshot.frozen ? { fileContentVersion: 1, contentHash: snapshot.frozen.checksum } : {}),
    ...(request.checksum?.trim() ? { clientChecksum: request.checksum.trim() } : {})
  };
  const updated = await participants.activate(snapshot, metadata);
  await participants.afterComplete?.({ ...snapshot, asset: updated }, false);
  return updated;
}

export interface FileBufferUploadParticipants {
  createUpload(): Promise<FileUploadSessionSummary>;
  assertDispatch(session: FileUploadSessionSummary): Promise<void>;
  put(session: FileUploadSessionSummary, bytes: Uint8Array): Promise<Response>;
  fail(sessionId: string, reason: string, resultOnly?: boolean): Promise<void>;
  complete(sessionId: string, checksum: string): Promise<FileAssetSummary>;
}

/** 服务端已有字节仍经原会话、派发复验和完成状态机；未知冻结只核原目标。 */
export async function uploadOriginalFileBuffer(
  input: CreateFileUploadSessionRequest,
  content: Buffer,
  participants: FileBufferUploadParticipants
): Promise<FileAssetSummary> {
  if (!Buffer.isBuffer(content) || content.length !== input.sizeBytes) {
    throw new ConflictException("上传文件内容与声明大小不一致");
  }
  const checksum = createHash("sha256").update(content).digest("hex");
  const session = await participants.createUpload();
  if (session.status === "completed" || session.status === "freeze_pending") {
    return participants.complete(session.sessionId, checksum);
  }
  if (session.mode !== "provider" || !session.uploadUrl) {
    await participants.fail(session.sessionId, "文件平台未返回可用上传地址");
    throw new ServiceUnavailableException("文件平台未返回可用上传地址");
  }
  await participants.assertDispatch(session);
  let response: Response;
  try {
    response = await participants.put(session, new Uint8Array(content));
  } catch {
    await participants.fail(session.sessionId, "上传到对象存储失败", true);
    throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
  }
  if (!response.ok) {
    await participants.fail(session.sessionId, `对象存储返回 HTTP ${response.status}`, true);
    throw new ServiceUnavailableException("上传到对象存储失败，请稍后重试");
  }
  return participants.complete(session.sessionId, checksum);
}

/** 原观察只在授权等待后比较同一快照；读取器继续决定缺失和业务版本的原语义。 */
export async function assertOriginalFileUploadSnapshot(
  expected: unknown,
  read: () => Promise<unknown>,
  authorize: () => Promise<void>,
  changed: () => Error
): Promise<void> {
  await authorize();
  // 原快照含Date版本和有效期，先按JSON语义保留其值，再沿原指纹排序比较。
  const expectedHash = requestFingerprint(JSON.parse(JSON.stringify(expected) ?? "null"));
  const currentHash = requestFingerprint(JSON.parse(JSON.stringify(await read()) ?? "null"));
  if (expectedHash !== currentHash) throw changed();
}
