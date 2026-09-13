import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  CompleteFileUploadRequest,
  CreateFileUploadSessionRequest,
  FileDownloadUrlSummary,
  FileUploadSessionSummary
} from "@rental-os/shared";
import { assertOutboundUrl } from "../../common/outbound-url";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";

type JsonRecord = Record<string, unknown>;

const UPLOAD_TTL_SECONDS = 15 * 60;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const text = (value: unknown, name: string) => {
  const result = String(value ?? "").trim();
  if (!result) throw new ServiceUnavailableException(`文件平台缺少配置：${name}`);
  return result;
};

const encodePath = (value: string) => value.split("/").map((part) => encodeURIComponent(part)).join("/");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest("hex");
const hmacBuffer = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const hmacSha1 = (key: string | Buffer, value: string) => createHmac("sha1", key).update(value).digest("hex");

function safeBucket(value: unknown) {
  const bucket = String(value ?? "").trim();
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/iu.test(bucket) || bucket.includes("..")) {
    throw new ServiceUnavailableException("对象存储 Bucket 格式不安全");
  }
  return bucket;
}

function safeRegion(value: unknown) {
  const region = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/iu.test(region)) throw new ServiceUnavailableException("对象存储地域格式不安全");
  return region;
}

function safeObjectPrefix(value: unknown) {
  const prefix = String(value ?? "").trim().replace(/^\/+|\/+$/gu, "");
  if (!prefix) return "";
  const segments = prefix.split("/");
  if (prefix.length > 180 || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\\u0000-\u001f\u007f]/u.test(segment))) {
    throw new ServiceUnavailableException("对象存储对象前缀格式不安全");
  }
  return segments.join("/");
}

function hmacSha1Base64(key: string, value: string) {
  return createHmac("sha1", key).update(value).digest("base64");
}

function isoBasic(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 供应商地址来自租户配置；禁止跟随跳转，避免一个看似安全的公网地址
    // 把服务端请求转发到内网或云元数据地址。
    const safeUrl = await assertOutboundUrl(url, "对象存储请求地址", { allowQuery: true });
    return await fetch(safeUrl, { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class FileStorageRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationService
  ) {}

  async createUploadSession(
    tenantId: string,
    input: CreateFileUploadSessionRequest
  ): Promise<FileUploadSessionSummary> {
    const mimeType = this.validateInput(input);
    const existing = await this.prisma.fileUploadSession.findFirst({
      where: { tenantId, idempotencyKey: input.idempotencyKey }
    });
    if (existing) {
      const existingAsset = await this.prisma.fileAsset.findUniqueOrThrow({ where: { id: existing.fileAssetId } });
      const existingMode = (existingAsset.metadata as JsonRecord | null)?.uploadMode === "provider" ? "provider" : "simulation";
      return this.sessionSummary(existing, existingAsset, existingMode);
    }

    const assetId = `file_${randomUUID().replace(/-/g, "")}`;
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
    const configured = await this.integrations.runtimeConfig("file", tenantId);
    const provider = configured?.provider ?? "local_mock";
    const storageKey = this.storageKey(configured, tenantId, assetId, input.fileName);
    const mode = configured ? "provider" : "simulation";
    if (!configured && process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("文件存储尚未配置，请先启用一个文件平台");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.fileAsset.create({
        data: {
          id: assetId,
          tenantId,
          businessModule: input.businessModule.trim(),
          businessType: input.businessType.trim(),
          businessId: input.businessId?.trim() || null,
          fileName: input.fileName.trim().slice(0, 180),
          fileExt: input.fileName.includes(".") ? input.fileName.split(".").pop()?.slice(0, 20) : null,
          mimeType,
          sizeBytes: input.sizeBytes,
          storageProvider: provider,
          storageKey,
          publicUrl: null,
          uploadScene: input.uploadScene.trim(),
          status: "pending_upload",
          metadata: { ...(input.metadata ?? {}), uploadMode: mode } as Prisma.InputJsonValue
        }
      });
      const session = await tx.fileUploadSession.create({
        data: {
          id: sessionId,
          tenantId,
          fileAssetId: asset.id,
          provider,
          storageKey,
          status: "pending_upload",
          idempotencyKey: input.idempotencyKey.trim(),
          expiresAt
        }
      });
      return { asset, session };
    });

    if (!configured) return this.sessionSummary(created.session, created.asset, mode);
    const signed = this.presign(configured, "PUT", storageKey, mimeType, expiresAt);
    return {
      ...this.sessionSummary(created.session, created.asset, mode),
      uploadUrl: signed.url,
      uploadHeaders: signed.headers
    };
  }

  async completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest) {
    const session = await this.prisma.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException("上传会话不存在");
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId } });
    if (!asset) throw new NotFoundException("文件元数据不存在");
    if (session.status === "completed") return asset;
    if (session.status !== "pending_upload") throw new ConflictException("上传会话已失效");
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failSession(tenantId, session.id, "上传会话已过期");
      throw new ConflictException("上传会话已过期，请重新上传");
    }
    if (session.provider !== "local_mock") {
      const config = await this.integrations.runtimeConfig("file", tenantId, session.provider as never);
      if (!config) throw new ServiceUnavailableException("文件平台已停用，无法确认上传结果");
      const exists = await this.objectExists(config, session.storageKey, asset.mimeType, asset.sizeBytes, session.expiresAt);
      if (!exists) throw new ConflictException("对象存储中尚未找到上传文件");
    }
    // checksum 是客户端声明，不在服务端读取对象并核算前视为可信事实；只保留在元数据
    // 供排障，不能写入 FileAsset.checksum 作为完整性证明。
    const metadata = {
      ...((asset.metadata ?? {}) as JsonRecord),
      completedAt: new Date().toISOString(),
      ...(input.checksum?.trim() ? { clientChecksum: input.checksum.trim() } : {})
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.fileUploadSession.update({ where: { id: session.id }, data: { status: "completed", completedAt: new Date(), failureReason: null } });
      return tx.fileAsset.update({ where: { id: asset.id }, data: { status: "active", metadata: metadata as Prisma.InputJsonValue } });
    });
    return updated;
  }

  async downloadUrl(tenantId: string, fileAssetId: string): Promise<FileDownloadUrlSummary> {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: "active" } });
    if (!asset) throw new NotFoundException("文件不存在或尚未完成上传");
    if (asset.storageProvider === "local_mock") {
      return { fileAssetId, provider: asset.storageProvider, mode: "simulation", downloadUrl: asset.publicUrl ?? `/api/files/${fileAssetId}/download` };
    }
    const config = await this.integrations.runtimeConfig("file", tenantId, asset.storageProvider as never);
    if (!config) throw new ServiceUnavailableException("文件平台已停用，无法生成下载地址");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const signed = this.presign(config, "GET", asset.storageKey, asset.mimeType, expiresAt);
    return { fileAssetId, provider: asset.storageProvider, mode: "provider", downloadUrl: signed.url, expiresAt: expiresAt.toISOString() };
  }

  private validateInput(input: CreateFileUploadSessionRequest) {
    if (!input.businessModule?.trim() || !input.businessType?.trim() || !input.uploadScene?.trim()) throw new ConflictException("文件业务归属和上传场景不能为空");
    if (!input.fileName?.trim() || !input.mimeType?.trim()) throw new ConflictException("文件名和类型不能为空");
    const mimeType = input.mimeType.trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mimeType) || mimeType.length > 127) throw new ConflictException("文件类型格式无效");
    if (["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript"].includes(mimeType)) {
      throw new ConflictException("不允许上传可直接执行或内嵌脚本的文件类型");
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) throw new ConflictException("文件大小必须在 1B 到 20MB 之间");
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 191) throw new ConflictException("上传必须带有效幂等键");
    return mimeType;
  }

  private storageKey(config: TenantIntegrationRuntimeConfig | undefined, tenantId: string, assetId: string, fileName: string) {
    const prefix = safeObjectPrefix(config?.settings.objectPrefix ?? "tenant-files");
    const safeName = fileName.trim().replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 180) || "file";
    return `${prefix ? `${prefix}/` : ""}${tenantId}/${assetId}/${safeName}`;
  }

  private sessionSummary(session: { id: string; fileAssetId: string; provider: string; status: string; storageKey: string; expiresAt: Date }, asset: { id: string }, mode: "provider" | "simulation" = "simulation"): FileUploadSessionSummary {
    return { sessionId: session.id, fileAssetId: asset.id, provider: session.provider, mode, status: session.status, storageKey: session.storageKey, expiresAt: session.expiresAt.toISOString() };
  }

  private async failSession(tenantId: string, sessionId: string, reason: string) {
    await this.prisma.$transaction([
      this.prisma.fileUploadSession.updateMany({ where: { id: sessionId, tenantId, status: "pending_upload" }, data: { status: "failed", failureReason: reason } }),
      this.prisma.fileAsset.updateMany({ where: { tenantId, uploadSession: { is: { id: sessionId } }, status: "pending_upload" }, data: { status: "failed" } })
    ]);
  }

  private endpoint(config: TenantIntegrationRuntimeConfig) {
    const settings = config.settings;
    const bucket = safeBucket(text(settings.bucket, "Bucket"));
    if (config.provider === "aliyun_oss") {
      const base = new URL(text(settings.endpoint, "Endpoint"));
      const host = base.hostname.startsWith(`${bucket}.`) ? base.hostname : `${bucket}.${base.hostname}`;
      return { base: `${base.protocol}//${host}`, bucket, region: safeRegion(settings.region) };
    }
    if (config.provider === "tencent_cos") {
      const region = safeRegion(text(settings.region, "地域"));
      return { base: `https://${bucket}.cos.${region}.myqcloud.com`, bucket, region };
    }
    const base = new URL(text(settings.endpoint, "Endpoint"));
    const pathStyle = String(settings.forcePathStyle ?? "false").toLowerCase() === "true" || settings.forcePathStyle === true;
    return { base: pathStyle ? `${base.protocol}//${base.host}/${encodeURIComponent(bucket)}` : `${base.protocol}//${bucket}.${base.host}`, bucket, region: safeRegion(text(settings.region, "Region")) };
  }

  private presign(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date) {
    if (config.provider === "aliyun_oss") return this.presignOss(config, method, storageKey, mimeType, expiresAt);
    if (config.provider === "tencent_cos") return this.presignCos(config, method, storageKey, mimeType, expiresAt);
    return this.presignS3(config, method, storageKey, mimeType, expiresAt);
  }

  private presignOss(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date) {
    const { base, bucket } = this.endpoint(config);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const contentType = method === "PUT" ? mimeType : "";
    const resource = `/${bucket}/${storageKey}`;
    const stringToSign = `${method}\n\n${contentType}\n${expires}\n${resource}`;
    const signature = hmacSha1Base64(text(config.credentials.accessKeySecret, "AccessKey Secret"), stringToSign);
    const url = `${base}/${encodePath(storageKey)}?OSSAccessKeyId=${encodeURIComponent(text(config.credentials.accessKeyId, "AccessKey ID"))}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
    const headers: Record<string, string> = method === "PUT" ? { "Content-Type": mimeType } : {};
    return { url, headers };
  }

  private presignCos(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date) {
    const { base } = this.endpoint(config);
    const start = Math.floor(Date.now() / 1000);
    const end = Math.floor(expiresAt.getTime() / 1000);
    const keyTime = `${start};${end}`;
    const uri = `/${encodePath(storageKey)}`;
    const host = new URL(base).host;
    const httpString = `${method.toLowerCase()}\n${uri}\n\nhost=${host}\n`;
    const signKey = hmacSha1(text(config.credentials.secretKey, "SecretKey"), keyTime);
    const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
    const signature = hmacSha1(signKey, stringToSign);
    const query = new URLSearchParams({
      "q-sign-algorithm": "sha1",
      "q-ak": text(config.credentials.secretId, "SecretId"),
      "q-sign-time": keyTime,
      "q-key-time": keyTime,
      "q-header-list": "host",
      "q-url-param-list": "",
      "q-signature": signature
    });
    const headers: Record<string, string> = method === "PUT" ? { "Content-Type": mimeType } : {};
    return { url: `${base}${uri}?${query.toString()}`, headers };
  }

  private presignS3(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD", storageKey: string, mimeType: string, expiresAt: Date) {
    const { base, bucket, region } = this.endpoint(config);
    const endpoint = new URL(base);
    const host = endpoint.host;
    const path = `${endpoint.pathname.replace(/\/$/u, "")}/${encodePath(storageKey)}`;
    const now = new Date();
    const amzDate = isoBasic(now);
    const date = amzDate.slice(0, 8);
    const service = "s3";
    const scope = `${date}/${region}/${service}/aws4_request`;
    const accessKey = text(config.credentials.accessKeyId, "Access Key ID");
    const secretKey = text(config.credentials.secretAccessKey, "Secret Access Key");
    const contentType = method === "PUT" ? mimeType : "";
    const signedHeaders = method === "PUT" ? "content-type;host" : "host";
    const canonicalHeaders = method === "PUT" ? `content-type:${contentType}\nhost:${host}\n` : `host:${host}\n`;
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${accessKey}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))),
      "X-Amz-SignedHeaders": signedHeaders
    });
    const canonicalQuery = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const canonicalRequest = `${method}\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
    const signingKey = hmacBuffer(hmacBuffer(hmacBuffer(hmacBuffer(`AWS4${secretKey}`, date), region), service), "aws4_request");
    query.set("X-Amz-Signature", hmac(signingKey, `${"AWS4-HMAC-SHA256"}\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`));
    const headers: Record<string, string> = method === "PUT" ? { "Content-Type": contentType } : {};
    return { url: `${endpoint.protocol}//${host}${path}?${query.toString()}`, headers };
  }

  private async objectExists(config: TenantIntegrationRuntimeConfig, storageKey: string, mimeType: string, sizeBytes: number, expiresAt: Date) {
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
