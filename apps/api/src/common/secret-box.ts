import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/** 服务端保存租户第三方凭据的 AES-256-GCM 小封装。 */
export class SecretBox {
  constructor(private readonly config: ConfigService) {}

  private key() {
    const configured = this.config.get<string>("INTEGRATION_ENCRYPTION_KEY")?.trim();
    if (configured) {
      return createHash("sha256").update(configured, "utf8").digest();
    }
    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ServiceUnavailableException("未配置第三方凭据加密密钥");
    }
    // 本地开发允许从开发认证密钥派生，避免把密钥写进仓库；生产环境强制独立密钥。
    const fallback = this.config.get<string>("AUTH_TOKEN_SECRET")?.trim();
    if (!fallback) throw new ServiceUnavailableException("未配置第三方凭据加密密钥");
    return createHash("sha256").update(`${fallback}:tenant-integrations`, "utf8").digest();
  }

  encrypt(value: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  decrypt(value: string): Record<string, string> {
    const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
    if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error("第三方凭据密文格式无效");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("第三方凭据内容无效");
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, item]) => typeof item === "string")) as Record<string, string>;
  }

  /**
   * 生成服务端内部使用的稳定指纹。它与 AES-GCM 密文分开：同一个手机号不能
   * 通过数据库里的值反推出明文，但重试和频率限制仍能识别同一收件人。
   */
  fingerprint(value: string) {
    return createHmac("sha256", this.key()).update(value.trim(), "utf8").digest("hex");
  }
}
