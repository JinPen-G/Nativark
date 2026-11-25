import { createHash, createHmac } from "node:crypto";

type OssMethod = "GET" | "PUT" | "HEAD" | "DELETE";

export interface AliyunOssV4Input {
  base: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  method: OssMethod;
  storageKey: string;
  mimeType: string;
  expiresAt: Date;
  now?: Date;
}

const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (value: string) => value.split("/").map(uriEncode).join("/");
const isoBasic = (date: Date) => date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value, "utf8").digest();

/** OSS V4 presigning for temporary object access; credentials never leave the API. */
export function createAliyunOssV4Url(input: AliyunOssV4Input): { url: string; headers: Record<string, string> } {
  const now = input.now ?? new Date();
  const expires = Math.floor((input.expiresAt.getTime() - now.getTime()) / 1000);
  if (!Number.isInteger(expires) || expires < 1 || expires > 604_800) throw new Error("OSS V4 预签名有效期必须在 1 秒至 7 天之间");
  if (!Number.isFinite(now.getTime())) throw new Error("OSS V4 签名时间无效");

  const endpoint = new URL(input.base);
  const host = endpoint.host;
  const dateTime = isoBasic(now);
  const date = dateTime.slice(0, 8);
  const scope = `${date}/${input.region}/oss/aliyun_v4_request`;
  const accessKeyId = input.accessKeyId.trim();
  const credential = `${accessKeyId}/${scope}`;
  const signedHeaderNames = input.method === "PUT" ? ["content-type", "host"] : ["host"];
  const canonicalHeaders = input.method === "PUT"
    ? `content-type:${input.mimeType.trim()}\nhost:${host}\n`
    : `host:${host}\n`;
  const additionalHeaders = signedHeaderNames.join(";");
  const parameters: Array<[string, string]> = [
    ["x-oss-additional-headers", additionalHeaders],
    ["x-oss-credential", credential],
    ["x-oss-date", dateTime],
    ["x-oss-expires", String(expires)],
    ["x-oss-signature-version", "OSS4-HMAC-SHA256"]
  ];
  const canonicalQuery = [...parameters]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const encodedKey = encodePath(input.storageKey);
  // OSS virtual-host requests use the bucket-qualified path in the canonical
  // URI while the actual URL host already contains the bucket, as in OSS V4's
  // official presigned-URL examples.
  const canonicalUri = `/${input.bucket}/${encodedKey}`;
  const canonicalRequest = `${input.method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${additionalHeaders}\nUNSIGNED-PAYLOAD`;
  const stringToSign = `OSS4-HMAC-SHA256\n${dateTime}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`aliyun_v4${input.accessKeySecret}`, date);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "oss");
  const signingKey = hmac(serviceKey, "aliyun_v4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const urlQuery = `${canonicalQuery}&x-oss-signature=${signature}`;
  const path = `${endpoint.pathname.replace(/\/$/u, "")}/${encodedKey}`;
  const headers: Record<string, string> = input.method === "PUT" ? { "Content-Type": input.mimeType } : {};
  return { url: `${endpoint.protocol}//${host}${path}?${urlQuery}`, headers };
}
