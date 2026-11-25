/** 原普通上传事实的准备与同事务建立。先核已有原键回执，再由调用方进入本段。
 * 业务引用、专用场景、知识授权及失应答解释留在原参加者，模拟模式须由原宿主显式允许。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreateFileUploadSessionRequest } from "@rental-os/platform-contracts/files";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { FileUploadFacts } from "./file-storage.repository";
import type { FileStorageOwner } from "./file-storage.store";

export type OriginalFileUploadFacts<Owner extends FileStorageOwner> = Omit<FileUploadFacts, "owner"> & { owner?: Owner };

export interface FileUploadSessionParticipants<Owner extends FileStorageOwner, Transaction, Created> {
  runtimeConfig(): Promise<TenantIntegrationRuntimeConfig | undefined>;
  /** 原专用来源判断其可接受的真实提供者，普通上传保留原配置选择。 */
  validateConfiguration(config: TenantIntegrationRuntimeConfig | undefined): void;
  allowSimulation: boolean;
  storageKey(config: TenantIntegrationRuntimeConfig | undefined, tenantId: string, assetId: string, fileName: string): string;
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  assertEnabled(transaction: Transaction, config: TenantIntegrationRuntimeConfig): Promise<void>;
  /** 保留原占用前的专用授权复验及写入尝试标记，供所属来源解释提交unknown。 */
  beforePersist(transaction: Transaction): Promise<void>;
  persist(transaction: Transaction, facts: OriginalFileUploadFacts<Owner>, config: TenantIntegrationRuntimeConfig | undefined): Promise<Created>;
}

export async function createOriginalFileUploadFacts<Owner extends FileStorageOwner, Transaction, Created>(
  input: { tenantId: string; request: CreateFileUploadSessionRequest; owner?: Owner; mimeType: string },
  participants: FileUploadSessionParticipants<Owner, Transaction, Created>
): Promise<Created> {
  const assetId = `file_${randomUUID().replace(/-/g, "")}`;
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const config = await participants.runtimeConfig();
  participants.validateConfiguration(config);
  const provider = config?.provider ?? "local_mock";
  const storageKey = participants.storageKey(config, input.tenantId, assetId, config ? "blob" : input.request.fileName);
  if (storageKey.length > 380) throw new ConflictException("文件对象定位过长，不能创建安全上传会话");
  const mode = config ? "provider" : "simulation";
  if (!config && !participants.allowSimulation) throw new ServiceUnavailableException("文件存储尚未配置，请先启用一个文件平台");

  return participants.transaction(async tx => {
    // 配置在事务外读取。仍先锁同一原配置行，再核专用授权及建立pending事实。
    if (config) await participants.assertEnabled(tx, config);
    await participants.beforePersist(tx);
    return participants.persist(tx, {
      input: { ...input.request, idempotencyKey: input.request.idempotencyKey.trim() },
      owner: input.owner, assetId, sessionId, expiresAt, provider, storageKey, mode, mimeType: input.mimeType
    }, config);
  });
}
