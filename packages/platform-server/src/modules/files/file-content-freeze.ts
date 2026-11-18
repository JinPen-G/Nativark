/** 原上传完成的字节冻结内核。先提交唯一目标意图，再写一次，恢复只读取原目标。
 * 当前业务/知识授权、原配置锁与实际字节传输由原参加者提供，本入口不签发上传权限。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { fileStorageLocationHash } from "@rental-os/platform-contracts/file-content-binding";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

export interface FileContentFreezeAsset {
  id: string;
  tenantId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  status: string;
  updatedAt: Date;
  metadata: unknown;
}

export interface FileContentFreezeSession {
  id: string;
  storageKey: string;
  status: string;
  expiresAt: Date;
  updatedAt: Date;
}

/** 私有参加者沿原同一事务读取/占用。生成ORM类型由调用方自己的宿主提供。 */
export interface FileContentFreezeTransaction<Asset, Session> {
  fileAsset: {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<Asset | null>;
    findUniqueOrThrow(query: { where: { id: string } }): PromiseLike<Asset>;
    updateMany(query: {
      where: { id: string; tenantId: string; status: "pending_upload"; updatedAt: Date; storageKey: string };
      data: { storageKey: string; checksum: string; metadata: { [key: string]: PlatformJsonValue | undefined } };
    }): PromiseLike<{ count: number }>;
  };
  fileUploadSession: {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<Session | null>;
    updateMany(query: {
      where: { id: string; tenantId: string; status: "pending_upload"; updatedAt: Date; storageKey: string; fileAssetId: string };
      data: { status: "freeze_pending"; storageKey: string };
    }): PromiseLike<{ count: number }>;
  };
}

export interface FileContentFreezeParticipants<Asset, Session, Transaction extends FileContentFreezeTransaction<Asset, Session>> {
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  /** 执行原调用链在占用前需要的当前授权核对。原通用业务边界继续由所属入口裁定。 */
  beforeClaim(transaction: Transaction): Promise<void>;
  assertConfiguration(transaction: Transaction, config: TenantIntegrationRuntimeConfig): Promise<void>;
  readContent(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, sizeBytes: number): Promise<Buffer>;
  writeContent(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, bytes: Buffer): Promise<Response>;
  /** 已有知识等专用字节来源由所属授权链提供。普通文件沿原暂存对象读取。 */
  readPendingContent?(): Promise<{ bytes: Uint8Array; contentHash: string }>;
}

export async function freezeFileUploadContent<
  Asset extends FileContentFreezeAsset,
  Session extends FileContentFreezeSession,
  Transaction extends FileContentFreezeTransaction<Asset, Session>
>(input: {
  tenantId: string;
  asset: Asset;
  session: Session;
  config: TenantIntegrationRuntimeConfig;
  checksum?: string;
}, participants: FileContentFreezeParticipants<Asset, Session, Transaction>) {
  const { tenantId, config } = input;
  let asset = structuredClone(input.asset), session = structuredClone(input.session);
  const metadata = asset.metadata as Record<string, unknown> | null;
  const resuming = session.status === "freeze_pending" && asset.status === "pending_upload";
  if (!resuming && (session.status !== "pending_upload" || asset.status !== "pending_upload"))
    throw new ConflictException("上传会话已失效");
  if (!config || metadata?.fileUploadVersion !== 2
    || metadata.storageLocationHash !== fileStorageLocationHash(config)
    || metadata.uploadConfigHash !== requestFingerprint({ id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials })) {
    throw new ConflictException("原上传缺少有效临时对象或文件配置依据，不能确认完成");
  }

  let checksum: string;
  let destination: string;
  if (resuming) {
    checksum = String(metadata.contentHash ?? "");
    destination = asset.storageKey;
    if (!/^[a-f0-9]{64}$/u.test(checksum) || session.storageKey !== destination || metadata.fileContentVersion !== 1
      || asset.checksum !== checksum || typeof metadata.stagingStorageKey !== "string"
      || !destination.startsWith(`${metadata.stagingStorageKey}.committed/`)
      || !destination.endsWith(`/${checksum}`)) {
      throw new ConflictException("原内容冻结依据无效，禁止另写或替换文件");
    }
    if (input.checksum?.trim() && input.checksum.trim() !== checksum)
      throw new ConflictException("原冻结收据与文件摘要不一致");
  } else {
    const supplied = participants.readPendingContent ? await participants.readPendingContent() : undefined;
    const bytes = supplied ? Buffer.from(supplied.bytes)
      : await participants.readContent(config, `${session.storageKey}.pending-upload`, asset.mimeType, asset.sizeBytes);
    checksum = createHash("sha256").update(bytes).digest("hex");
    if (supplied && supplied.contentHash !== checksum) throw new ConflictException("知识原字节与摘要不一致");
    if (input.checksum?.trim() && input.checksum.trim() !== checksum)
      throw new ConflictException("文件内容摘要与实际上传字节不一致");
    destination = `${session.storageKey}.committed/${randomUUID()}/${checksum}`;

    // 原目标在PUT前持久化。提交失应答保留freeze_pending，后续调用只核对该目标。
    const claimed = await participants.transaction(async tx => {
      await participants.beforeClaim(tx);
      await participants.assertConfiguration(tx, config);
      const [currentAsset, currentSession] = await Promise.all([
        tx.fileAsset.findFirst({ where: { id: asset.id, tenantId } }),
        tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } })
      ]);
      if (requestFingerprint(currentAsset) !== requestFingerprint(asset) || requestFingerprint(currentSession) !== requestFingerprint(session)
        || session.expiresAt.getTime() <= Date.now()) throw new ConflictException("原上传会话在内容读取期间已变化");
      const sessionClaim = await tx.fileUploadSession.updateMany({
        where: { id: session.id, tenantId, status: "pending_upload", updatedAt: session.updatedAt, storageKey: session.storageKey, fileAssetId: asset.id },
        data: { status: "freeze_pending", storageKey: destination }
      });
      if (sessionClaim.count !== 1) throw new ConflictException("原上传已被另一完成操作占用，请读取原结果");
      const assetClaim = await tx.fileAsset.updateMany({
        where: { id: asset.id, tenantId, status: "pending_upload", updatedAt: asset.updatedAt, storageKey: asset.storageKey },
        data: { storageKey: destination, checksum,
          metadata: { ...metadata, fileContentVersion: 1, contentHash: checksum, stagingStorageKey: session.storageKey } as { [key: string]: PlatformJsonValue | undefined } }
      });
      if (assetClaim.count !== 1) throw new ConflictException("原上传文件已变化，不能冻结内容");
      return { asset: await tx.fileAsset.findUniqueOrThrow({ where: { id: asset.id } }),
        session: await tx.fileUploadSession.findFirst({ where: { id: session.id, tenantId } }) };
    });
    if (!claimed.session) throw new ConflictException("原内容冻结会话缺失");
    asset = structuredClone(claimed.asset);
    session = structuredClone(claimed.session);
    const response = await participants.writeContent(config, destination, asset.mimeType, bytes);
    if (!response.ok) throw new ServiceUnavailableException("正式文件存储未确认写入，只能核对原内容冻结结果");
  }

  const written = await participants.readContent(config, destination, asset.mimeType, asset.sizeBytes);
  if (createHash("sha256").update(written).digest("hex") !== checksum)
    throw new ConflictException("正式文件内容校验失败，禁止激活证据");
  return { asset, session, frozen: { storageKey: destination, checksum, config } };
}
