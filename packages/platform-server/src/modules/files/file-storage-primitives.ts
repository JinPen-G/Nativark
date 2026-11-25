/** 公共文件字节、原格式校验及受控对象操作。业务授权和生命周期参加者由所属服务提供。
 * 限长读取保持原流超时、取消和精确大小/类型核对，不把HEAD或客户端摘要作为字节证据。 */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { CreateFileUploadSessionRequest, FileAssetSummary, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import { ObjectStorageProviderService, safeObjectPrefix, fetchObjectStorageWithTimeout as fetchWithTimeout } from "../integrations/object-storage.provider.service";
import type { TenantIntegrationRuntimeConfig } from "../integrations/tenant-integration.service";
import type { FileStorageOwner } from "./file-storage.store";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class FileStoragePrimitives extends ObjectStorageProviderService {
  protected pendingObjectKey(storageKey: string) { return `${storageKey}.pending-upload`; }

  protected matchesOwner(asset: { businessType: string; businessId: string | null; uploadScene: string }, owner: FileStorageOwner) {
    return (!owner.businessType || asset.businessType === owner.businessType)
      && (!owner.businessId || asset.businessId === owner.businessId)
      && (!owner.uploadScene || asset.uploadScene === owner.uploadScene);
  }

  protected assetSummary(asset: {
    id: string;
    businessModule: string;
    businessType: string;
    businessId: string | null;
    fileName: string;
    fileExt: string | null;
    mimeType: string;
    sizeBytes: number;
    storageProvider: string;
    uploadScene: string;
    status: string;
    uploadedBy: string | null;
    createdAt: Date;
  }): FileAssetSummary {
    return {
      id: asset.id,
      businessModule: asset.businessModule,
      businessType: asset.businessType,
      businessId: asset.businessId ?? undefined,
      fileName: asset.fileName,
      fileExt: asset.fileExt ?? undefined,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      storageProvider: asset.storageProvider,
      uploadScene: asset.uploadScene,
      status: asset.status,
      uploadedBy: asset.uploadedBy ?? undefined,
      createdAt: asset.createdAt.toISOString()
    };
  }

  protected validateInput(input: CreateFileUploadSessionRequest) {
    if (!input.businessModule?.trim() || !input.businessType?.trim() || !input.businessId?.trim() || !input.uploadScene?.trim()) throw new ConflictException("文件业务归属、业务对象和上传场景不能为空");
    if (input.businessModule.trim().length > 64 || input.businessType.trim().length > 64 || input.businessId.trim().length > 191 || input.uploadScene.trim().length > 64) throw new ConflictException("文件业务归属字段过长");
    if (!input.fileName?.trim() || input.fileName.trim().length > 180 || !input.mimeType?.trim()) throw new ConflictException("文件名和类型不能为空且不能超过 180 个字符");
    const mimeType = input.mimeType.trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mimeType) || mimeType.length > 127) throw new ConflictException("文件类型格式无效");
    if (["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript"].includes(mimeType)) {
      throw new ConflictException("不允许上传可直接执行或内嵌脚本的文件类型");
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) throw new ConflictException("文件大小必须在 1B 到 20MB 之间");
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 191) throw new ConflictException("上传必须带有效幂等键");
    return mimeType;
  }

  protected storageKey(config: TenantIntegrationRuntimeConfig | undefined, tenantId: string, assetId: string, fileName: string) {
    const prefix = safeObjectPrefix(config?.settings.objectPrefix ?? "tenant-files");
    const safeName = fileName.trim().replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 180) || "file";
    return `${prefix ? `${prefix}/` : ""}${tenantId}/${assetId}/${safeName}`;
  }

  protected sessionSummary(session: { id: string; fileAssetId: string; provider: string; status: string; expiresAt: Date }, asset: { id: string }, mode: "provider" | "simulation" = "simulation"): FileUploadSessionSummary {
    return { sessionId: session.id, fileAssetId: asset.id, provider: session.provider, mode, status: session.status, expiresAt: session.expiresAt.toISOString() };
  }

  protected async deleteObject(config: TenantIntegrationRuntimeConfig, storageKey: string, at: Date) {
    const expiresAt = new Date(at.getTime() + 5 * 60 * 1000);
    const signed = this.presign(config, "DELETE", storageKey, "application/octet-stream", expiresAt);
    const response = await this.objectRequest(signed.url, { method: "DELETE", headers: signed.headers });
    return response.status === 404 || response.ok;
  }

  protected async readObjectContent(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, sizeBytes: number) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) throw new ConflictException("文件大小无效");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const wait = async <T>(work: Promise<T>): Promise<T> => {
      let rejectAbort: () => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new ServiceUnavailableException("文件内容读取结果未明确")); });
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
      try { return await Promise.race([work, aborted]); }
      finally { controller.signal.removeEventListener("abort", rejectAbort); }
    };
    try {
      const signed = this.presign(config, "GET", storageKey, mimeType, new Date(Date.now() + 60_000));
      const task = this.objectRequest(signed.url, { method: "GET", headers: signed.headers, signal: controller.signal });
      void task.then(response => { if (controller.signal.aborted && response.body) void response.body.cancel().catch(() => undefined); }, () => undefined);
      const response = await wait(task);
      const actualType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!response.ok || !response.body || response.headers.get("content-length") !== String(sizeBytes) || actualType !== mimeType) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new ConflictException("实际上传文件的类型或大小与原声明不一致");
      }
      reader = response.body.getReader();
      const chunks: Buffer[] = []; let total = 0;
      for (;;) {
        const next = await wait(reader.read());
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (total += next.value.byteLength) > sizeBytes) throw new ConflictException("实际上传内容超过原文件大小");
        chunks.push(Buffer.from(next.value));
      }
      if (total !== sizeBytes) throw new ConflictException("实际上传内容大小不完整");
      return Buffer.concat(chunks, total);
    } finally {
      controller.abort(); clearTimeout(timer);
      if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    }
  }

  protected async objectExists(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, sizeBytes: number, expiresAt: Date) {
    const signed = this.presign(config, "HEAD", storageKey, mimeType, expiresAt);
    const response = await fetchWithTimeout(signed.url, { method: "HEAD", headers: signed.headers });
    if (!response.ok) return false;
    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength !== sizeBytes) return false;
    const expectedType = mimeType.split(";", 1)[0].trim().toLowerCase();
    const actualType = String(response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    return Boolean(actualType) && actualType === expectedType;
  }
}
