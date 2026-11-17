/** 公共对象存储签名、出站HTTP与只读连接探针。业务文件归属、字节证据、ACL和删除收据由原宿主持有。 */
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { assertOutboundUrl } from "../../common/outbound-url";
import { createAliyunOssV4Url } from "./aliyun-oss-v4";
import type { TenantIntegrationRuntimeConfig } from "./tenant-integration.service";

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

/** OSS endpoints are commonly written as `oss-cn-hangzhou`; V4 credential scope uses `cn-hangzhou`. */
function aliyunSigningRegion(value: unknown) {
  const configured = safeRegion(value).toLowerCase();
  const region = configured.startsWith("oss-") ? configured.slice("oss-".length) : configured;
  if (!region) throw new ServiceUnavailableException("阿里云 OSS 地域无效");
  return region;
}

export function safeObjectPrefix(value: unknown) {
  const prefix = String(value ?? "").trim().replace(/^\/+|\/+$/gu, "");
  if (!prefix) return "";
  const segments = prefix.split("/");
  if (prefix.length > 180 || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\\u0000-\u001f\u007f]/u.test(segment))) {
    throw new ServiceUnavailableException("对象存储对象前缀格式不安全");
  }
  return segments.join("/");
}

function isoBasic(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
}

export async function fetchObjectStorageWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    // 供应商地址来自租户配置；禁止跟随跳转，避免一个看似安全的公网地址
    // 把服务端请求转发到内网或云元数据地址。
    const safeUrl = await assertOutboundUrl(url, "对象存储请求地址", { allowQuery: true });
    return await fetch(safeUrl, { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

@Injectable()
export class ObjectStorageProviderService {

  /**
   * 用随机不存在的对象做 HEAD 探针：验证签名、Bucket 和网络可达性，
   * 只接受 404 作为“权限已到达但对象不存在”，绝不上传、删除或覆盖租户文件。
   */
  async testConnection(config: TenantIntegrationRuntimeConfig): Promise<string> {
    const configuredPrefix = config.settings.objectPrefix ?? "tenant-files";
    const prefix = safeObjectPrefix(configuredPrefix);
    const storageKey = `${prefix ? `${prefix}/` : ""}_rental_os_connectivity/${config.id}/${randomUUID()}.probe`;
    const signed = this.presign(config, "HEAD", storageKey, "application/octet-stream", new Date(Date.now() + 5 * 60 * 1000));
    const response = await fetchObjectStorageWithTimeout(signed.url, { method: "HEAD", headers: signed.headers });
    if (response.status === 404) return "已验证对象存储连接（随机探针对象不存在，未上传文件）。";
    if (!response.ok) throw new Error(`对象存储返回 HTTP ${response.status}`);
    return "已验证对象存储连接（未写入文件）。";
  }

  protected endpoint(config: TenantIntegrationRuntimeConfig) {
    const settings = config.settings;
    const bucket = safeBucket(text(settings.bucket, "Bucket"));
    if (config.provider === "aliyun_oss") {
      const base = new URL(text(settings.endpoint, "Endpoint"));
      const host = base.hostname.startsWith(`${bucket}.`) ? base.hostname : `${bucket}.${base.hostname}`;
      return { base: `${base.protocol}//${host}`, bucket, region: aliyunSigningRegion(settings.region) };
    }
    if (config.provider === "tencent_cos") {
      const region = safeRegion(text(settings.region, "地域"));
      return { base: `https://${bucket}.cos.${region}.myqcloud.com`, bucket, region };
    }
    const base = new URL(text(settings.endpoint, "Endpoint"));
    const pathStyle = String(settings.forcePathStyle ?? "false").toLowerCase() === "true" || settings.forcePathStyle === true;
    return { base: pathStyle ? `${base.protocol}//${base.host}/${encodeURIComponent(bucket)}` : `${base.protocol}//${bucket}.${base.host}`, bucket, region: safeRegion(text(settings.region, "Region")) };
  }

  protected presign(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD" | "DELETE", storageKey: string, mimeType: string, expiresAt: Date) {
    if (config.provider === "aliyun_oss") return this.presignOss(config, method, storageKey, mimeType, expiresAt);
    if (config.provider === "tencent_cos") return this.presignCos(config, method, storageKey, mimeType, expiresAt);
    return this.presignS3(config, method, storageKey, mimeType, expiresAt);
  }

  protected presignOss(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD" | "DELETE", storageKey: string, mimeType: string, expiresAt: Date) {
    const { base, bucket, region } = this.endpoint(config);
    return createAliyunOssV4Url({
      base,
      bucket,
      region,
      accessKeyId: text(config.credentials.accessKeyId, "AccessKey ID"),
      accessKeySecret: text(config.credentials.accessKeySecret, "AccessKey Secret"),
      method,
      storageKey,
      mimeType,
      expiresAt
    });
  }

  protected presignCos(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD" | "DELETE", storageKey: string, mimeType: string, expiresAt: Date) {
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

  protected presignS3(config: TenantIntegrationRuntimeConfig, method: "GET" | "PUT" | "HEAD" | "DELETE", storageKey: string, mimeType: string, expiresAt: Date) {
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

  protected objectRequest(url: string, init: RequestInit) { return fetchObjectStorageWithTimeout(url, init); }
}
