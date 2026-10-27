import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export const SECRET_BOX_ENVELOPE_PATTERN = /^(?:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+|v2:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)$/u;

/** 服务端保存租户第三方凭据的 AES-256-GCM 小封装。 */
export class SecretBox {
  constructor(private readonly config: ConfigService) {}

  private derive(value: string) {
    // Length cannot prove entropy: deployment must supply a randomly generated
    // secret. Reject short/trivially repeated production values rather than hash them into apparent strength.
    if (this.config.get<string>("NODE_ENV") === "production"
      && (Buffer.byteLength(value, "utf8") < 32 || new Set(value).size < 8 || /^(.{1,16})\1+$/u.test(value)
        || /^(?:change-this|replace[-_ ]|your[-_ ]|example[-_ ])/iu.test(value))) {
      throw new ServiceUnavailableException("第三方凭据加密密钥强度不足，请配置至少 32 字节的随机密钥");
    }
    return createHash("sha256").update(value, "utf8").digest();
  }

  private key() {
    const configured = this.config.get<string>("INTEGRATION_ENCRYPTION_KEY")?.trim();
    if (configured) {
      return this.derive(configured);
    }
    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ServiceUnavailableException("未配置第三方凭据加密密钥");
    }
    // 本地开发允许从开发认证密钥派生，避免把密钥写进仓库；生产环境强制独立密钥。
    const fallback = this.config.get<string>("AUTH_TOKEN_SECRET")?.trim();
    if (!fallback) throw new ServiceUnavailableException("未配置第三方凭据加密密钥");
    return createHash("sha256").update(`${fallback}:tenant-integrations`, "utf8").digest();
  }

  private activeKey() {
    const key = this.key();
    const configuredId = this.config.get<string>("INTEGRATION_ENCRYPTION_KEY_ID")?.trim();
    // A misconfigured alias must never put the encryption secret in an envelope header.
    const id = configuredId && configuredId !== this.config.get<string>("INTEGRATION_ENCRYPTION_KEY")?.trim()
      ? configuredId : `key-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(id)) throw new ServiceUnavailableException("第三方凭据密钥版本无效");
    return { id, key };
  }

  private previousKeys() {
    const raw = this.config.get<string>("INTEGRATION_PREVIOUS_ENCRYPTION_KEYS");
    if (!raw) return new Map<string, Buffer>();
    try {
      if (raw.length > 65536) throw new Error();
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 5) throw new Error();
      const keys = new Map<string, Buffer>();
      const active = this.activeKey();
      for (const [id, value] of Object.entries(parsed)) {
        if (!/^[A-Za-z0-9._-]{1,64}$/u.test(id) || typeof value !== "string" || !value.trim() || id === active.id) throw new Error();
        keys.set(id, this.derive(value.trim()));
      }
      return keys;
    } catch { throw new ServiceUnavailableException("第三方凭据历史密钥配置无效"); }
  }

  encrypt(value: Record<string, string>) {
    const iv = randomBytes(12);
    const active = this.activeKey();
    const cipher = createCipheriv("aes-256-gcm", active.key, iv);
    cipher.setAAD(Buffer.from(`rental-os:secret-box:v2:${active.id}`, "utf8"));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return `v2:${active.id}:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  decrypt(value: string): Record<string, string> {
    if (!SECRET_BOX_ENVELOPE_PATTERN.test(value)) throw new Error("第三方凭据密文格式无效");
    const parts = value.split(":"), version = parts[0], keyId = version === "v2" ? parts[1] : undefined;
    const [ivRaw, tagRaw, ciphertextRaw] = parts.slice(version === "v2" ? 2 : 1);
    const iv = Buffer.from(ivRaw, "base64url"), tag = Buffer.from(tagRaw, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("第三方凭据密文格式无效");
    const active = this.activeKey();
    const keys = keyId && keyId !== active.id
      ? [this.previousKeys().get(keyId)].filter((key): key is Buffer => !!key) : [active.key];
    let plaintext: string | undefined;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        if (keyId) decipher.setAAD(Buffer.from(`rental-os:secret-box:v2:${keyId}`, "utf8"));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64url")), decipher.final()]).toString("utf8");
        break;
      } catch {
        // v1 has no key id; consult the bounded configured ring only if the current key failed.
        if (!keyId && index === 0) keys.push(...this.previousKeys().values());
      }
    }
    if (plaintext === undefined) throw new Error("第三方凭据无法解密");
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("第三方凭据内容无效");
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, item]) => typeof item === "string")) as Record<string, string>;
  }

  /**
   * 生成服务端内部使用的稳定指纹。它与 AES-GCM 密文分开：同一个手机号不能
   * 通过数据库里的值反推出明文，但重试和频率限制仍能识别同一收件人。
   */
  fingerprint(value: string) {
    const stable = this.config.get<string>("INTEGRATION_FINGERPRINT_KEY")?.trim();
    // Phone/identity lookup hashes must not silently change on encryption-key
    // rotation. Set this to the original fingerprint key before retaining old encryption keys.
    if (!stable && this.config.get<string>("INTEGRATION_PREVIOUS_ENCRYPTION_KEYS")) {
      throw new ServiceUnavailableException("轮换加密密钥前须配置独立且稳定的指纹密钥");
    }
    return createHmac("sha256", stable ? this.derive(stable) : this.key()).update(value.trim(), "utf8").digest("hex");
  }
}
