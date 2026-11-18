/** 公共文件台账与开发模拟元数据登记，供Core和原集成宿主共用。
 * 当前租户沿公共ALS读取，业务ACL、存储选择和创建日志由宿主提供。 */
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreateFileAssetRequest, FileAssetQuery, FileAssetSummary } from "@rental-os/platform-contracts/files";
import { requireRequestTenantId } from "../../common/request-identity";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import { fileAssetSummary } from "./file-storage.repository";
import type { StoredFileAsset } from "./file-storage.store";

export interface FileLedgerAuthority {
  authorityKey(tenantId: string): string;
  filterReadable(tenantId: string, files: FileAssetSummary[]): PromiseLike<FileAssetSummary[]>;
}

export interface FileLedgerStorage {
  listFiles(tenantId: string, query?: FileAssetQuery, excludedScene?: string): PromiseLike<FileAssetSummary[]>;
  createFile(input: CreateFileAssetRequest, tenantId: string): PromiseLike<FileAssetSummary>;
}

export interface FileLedgerParticipants {
  storage: FileLedgerStorage;
  authority?: FileLedgerAuthority;
  usePersistentStorage(): boolean;
  recordMetadataCreation(input: CreateFileAssetRequest, created: FileAssetSummary): PromiseLike<unknown>;
  excludedScene?: string;
  initialFiles?: readonly FileAssetSummary[];
  simulationFiles?: Map<string, FileAssetSummary[]>;
}

type FileLedgerMetadataCreate = Pick<StoredFileAsset,
  "id" | "tenantId" | "businessModule" | "businessType" | "fileName" | "mimeType" | "sizeBytes"
  | "storageProvider" | "storageKey" | "publicUrl" | "checksum" | "uploadScene"
> & {
  businessId?: string;
  fileExt?: string;
  uploadedBy?: string;
  metadata: { [key: string]: PlatformJsonValue | undefined };
};

export interface FileLedgerMetadataStore {
  fileAsset: {
    create(query: { data: FileLedgerMetadataCreate }): PromiseLike<StoredFileAsset>;
  };
}

export class FileLedgerApplication {
  private readonly filesByTenant: Map<string, FileAssetSummary[]>;
  private readonly files: readonly FileAssetSummary[];

  constructor(private readonly participants: FileLedgerParticipants) {
    this.filesByTenant = participants.simulationFiles ?? new Map<string, FileAssetSummary[]>();
    this.files = participants.initialFiles ?? [];
  }

  private get defaultTenantId() {
    return requireRequestTenantId();
  }

  async listFiles(query: FileAssetQuery = {}) {
    const authority = this.participants.authority;
    if (!authority) throw new ServiceUnavailableException("文件业务读取权威未配置");
    const tenantId = this.defaultTenantId;
    if (this.participants.usePersistentStorage()) {
      const key = authority.authorityKey(tenantId);
      const candidates = await this.participants.storage.listFiles(tenantId, query, this.participants.excludedScene);
      if (authority.authorityKey(tenantId) !== key) throw new ServiceUnavailableException("文件读取期间授权范围已变化");
      return authority.filterReadable(tenantId, candidates);
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 80), 1), 200);
    const candidates = this.memoryFilesForTenant(tenantId)
      .filter((file) => {
        if (this.participants.excludedScene && file.uploadScene === this.participants.excludedScene) return false;
        if (query.businessModule && file.businessModule !== query.businessModule) {
          return false;
        }
        if (query.businessType && file.businessType !== query.businessType) {
          return false;
        }
        if (query.businessId && file.businessId !== query.businessId) {
          return false;
        }
        if (query.uploadScene && file.uploadScene !== query.uploadScene) {
          return false;
        }
        if (query.status && file.status !== query.status) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(safeFileAssetSummary);
    return authority.filterReadable(tenantId, candidates);
  }

  async createFile(input: CreateFileAssetRequest) {
    // 模拟元数据沿原生产门禁拒绝，真实上传由FileStorageApplication的原键流程处理。
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("生产环境禁止创建模拟文件资产，请使用真实文件存储上传链");
    }
    validateRequired(input.businessModule, "业务模块不能为空");
    validateRequired(input.businessType, "业务对象类型不能为空");
    validateRequired(input.fileName, "文件名不能为空");
    validateRequired(input.mimeType, "文件类型不能为空");

    const created = this.participants.usePersistentStorage()
      ? await this.participants.storage.createFile(input, this.defaultTenantId)
      : this.createMemoryFile(input);

    // 原日志失败继续向上返回，已经登记的元数据仍保留在原台账中。
    await this.participants.recordMetadataCreation(input, created);
    return safeFileAssetSummary(created);
  }

  private createMemoryFile(input: CreateFileAssetRequest) {
    const tenantId = this.defaultTenantId;
    const fileId = `file_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const fileExt = input.fileName.includes(".")
      ? input.fileName.split(".").pop()
      : undefined;
    const row: FileAssetSummary = {
      id: fileId,
      businessModule: input.businessModule,
      businessType: input.businessType,
      businessId: input.businessId,
      fileName: input.fileName,
      fileExt,
      mimeType: input.mimeType,
      sizeBytes: Math.max(0, Math.round(input.sizeBytes ?? 0)),
      storageProvider: "local_mock",
      storageKey: `mock/${tenantId}/${fileId}/${input.fileName}`,
      publicUrl: `/api/files/${fileId}/download`,
      uploadScene: input.uploadScene,
      status: "active",
      uploadedBy: input.uploadedBy,
      createdAt: new Date().toISOString()
    };
    this.memoryFilesForTenant(tenantId).unshift(row);
    return row;
  }

  private memoryFilesForTenant(tenantId: string) {
    const existing = this.filesByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.files.map((file) => {
      const id = `${file.id}_${tenantId}`;
      return {
        ...file,
        id,
        storageKey: (file.storageKey ?? `mock/${tenantId}/${id}`).replace(/^mock\/[^/]+/u, `mock/${tenantId}`),
        publicUrl: `/api/files/${id}/download`
      };
    });
    this.filesByTenant.set(tenantId, seeded);
    return seeded;
  }
}

/** 沿原FileAsset字段、默认和JSON输入登记模拟元数据，返回原受保护投影。 */
export async function createSimulationFileAsset(
  database: FileLedgerMetadataStore,
  input: CreateFileAssetRequest,
  tenantId: string
): Promise<FileAssetSummary> {
  if (!tenantId) throw new BadRequestException("文件登记缺少当前租户");
  const fileId = `file_${Math.random().toString(36).slice(2, 10)}`;
  const fileExt = input.fileName.includes(".")
    ? input.fileName.split(".").pop()
    : undefined;
  const row = await database.fileAsset.create({
    data: {
      id: fileId,
      tenantId,
      businessModule: input.businessModule,
      businessType: input.businessType,
      businessId: input.businessId,
      fileName: input.fileName,
      fileExt,
      mimeType: input.mimeType,
      sizeBytes: Math.max(0, Math.round(input.sizeBytes ?? 0)),
      storageProvider: "local_mock",
      storageKey: `mock/${tenantId}/${fileId}/${input.fileName}`,
      publicUrl: `/api/files/${fileId}/download`,
      checksum: `mock-sha256-${Math.random().toString(36).slice(2, 10)}`,
      uploadScene: input.uploadScene,
      uploadedBy: input.uploadedBy,
      metadata: (input.metadata ?? {}) as { [key: string]: PlatformJsonValue | undefined }
    }
  });
  return fileAssetSummary(row);
}

function safeFileAssetSummary(file: FileAssetSummary): FileAssetSummary {
  const safe = { ...file };
  delete safe.storageKey;
  delete safe.publicUrl;
  return safe;
}

function validateRequired(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(message);
  }
}
