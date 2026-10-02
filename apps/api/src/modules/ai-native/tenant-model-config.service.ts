import { createHash } from "node:crypto";
import { z } from "zod";
import { SecretBox } from "../../common/secret-box";
import { isPrivateOrLocalHost, parseOutboundUrl } from "../../common/outbound-url";
import { ModelGatewayError, type GatewayContext, type GatewayProfile } from "./model-gateway.ports";

/** Protocol support, never a supplier/model catalogue. Extend through tested adapters. */
export const tenantModelProtocols = ["openai_chat_completions"] as const;
const settingsSchema = z.object({
  enabled: z.boolean().default(false), protocol: z.enum(tenantModelProtocols),
  baseUrl: z.string().min(1).max(2048), model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
  apiKey: z.string().min(1).max(8192).regex(/^[^\r\n]+$/u).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxConcurrent: z.number().int().min(1).max(20).default(2),
  maxOutputTokens: z.number().int().min(1).max(32768).default(2048),
  expectedRevision: z.number().int().nonnegative()
}).strict();
type Settings = Omit<z.infer<typeof settingsSchema>, "apiKey" | "expectedRevision">;
export interface TenantModelRecord { tenantId: string; revision: number; settings: Settings; credentialsEncrypted: string; }
export interface TenantModelConfigPorts {
  /** Must validate fresh server identity, tenant membership, space access and action permission. */
  authorize(context: GatewayContext, action: "read" | "manage" | "invoke"): Promise<void>;
  repository: {
    read(tenantId: string): Promise<TenantModelRecord | null>;
    /** Atomic compare-and-swap, including insert at revision zero. Never blind upsert. */
    compareAndSwap(tenantId: string, expectedRevision: number, next: TenantModelRecord): Promise<boolean>;
  };
}

/** Pure validation only. DNS/connection pinning must additionally happen in the egress transport. */
export function normalizeTenantModelBaseUrl(value: string) {
  try {
    const url = parseOutboundUrl(value, "Model Base URL", { allowPrivateInDevelopment: false });
    if (url.protocol !== "https:" || isPrivateOrLocalHost(url.hostname)) throw new Error();
    return url.toString().replace(/\/+$/u, "");
  } catch { throw new ModelGatewayError("CONFIG_INVALID"); }
}

/** Server-only encrypted settings service. No public credential getter or automatic activation. */
export class TenantModelConfigService {
  constructor(private readonly ports: TenantModelConfigPorts, private readonly secrets: SecretBox) {}

  private async authorize(context: GatewayContext, action: "read" | "manage" | "invoke") {
    if (!context || [context.tenantId, context.workspaceId, context.actorId].some(v => typeof v !== "string" || !/^[\w.:-]{1,128}$/u.test(v))) {
      throw new ModelGatewayError("INVALID_REQUEST");
    }
    try { await this.ports.authorize(context, action); } catch { throw new ModelGatewayError("FORBIDDEN"); }
  }

  private async readRecord(tenantId: string) {
    const record = await this.ports.repository.read(tenantId);
    if (record && record.tenantId !== tenantId) throw new ModelGatewayError("FORBIDDEN");
    if (!record) return null;
    const parsed = settingsSchema.omit({ apiKey: true, expectedRevision: true }).safeParse(record.settings);
    if (!parsed.success || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= Number.MAX_SAFE_INTEGER || typeof record.credentialsEncrypted !== "string") throw new ModelGatewayError("CONFIG_INVALID");
    return { ...record, settings: parsed.data };
  }

  private decrypt(record: TenantModelRecord) {
    try {
      const secret = this.secrets.decrypt(record.credentialsEncrypted);
      // Bind ciphertext to tenant and destination; a copied row cannot reuse another tenant's key.
      if (secret.tenantId !== record.tenantId || secret.protocol !== record.settings.protocol || secret.baseUrl !== record.settings.baseUrl || secret.model !== record.settings.model || !secret.apiKey?.trim()) throw new Error();
      return secret.apiKey;
    } catch { throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE"); }
  }

  private reference(record: TenantModelRecord) {
    return `tenant-model:${createHash("sha256").update(record.tenantId).digest("hex")}:${record.revision}`;
  }

  private summary(record: TenantModelRecord) {
    return { ...record.settings, revision: record.revision, keyConfigured: true };
  }

  async get(context: GatewayContext) {
    await this.authorize(context, "read");
    const record = await this.readRecord(context.tenantId);
    if (!record) return null;
    this.decrypt(record);
    return this.summary(record);
  }

  async save(context: GatewayContext, value: unknown) {
    await this.authorize(context, "manage");
    const parsed = settingsSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError("CONFIG_INVALID");
    const { apiKey, expectedRevision, ...settings } = parsed.data;
    settings.baseUrl = normalizeTenantModelBaseUrl(settings.baseUrl);
    const previous = await this.readRecord(context.tenantId);
    if ((previous?.revision ?? 0) !== expectedRevision) throw new ModelGatewayError("CONFIG_INVALID");
    // Never silently forward a stored key to a changed endpoint/protocol.
    if (!apiKey?.trim() && (!previous || previous.settings.baseUrl !== settings.baseUrl || previous.settings.protocol !== settings.protocol)) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    const key = apiKey?.trim() || this.decrypt(previous!);
    let encrypted: string;
    try { encrypted = this.secrets.encrypt({ apiKey: key, tenantId: context.tenantId, protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model }); }
    catch { throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE"); }
    const next = { tenantId: context.tenantId, revision: expectedRevision + 1, settings, credentialsEncrypted: encrypted };
    if (!await this.ports.repository.compareAndSwap(context.tenantId, expectedRevision, next)) throw new ModelGatewayError("CONFIG_INVALID");
    return this.summary(next);
  }

  async profile(context: GatewayContext): Promise<GatewayProfile> {
    await this.authorize(context, "invoke");
    const record = await this.readRecord(context.tenantId);
    if (!record) throw new ModelGatewayError("DISABLED");
    return { enabled: record.settings.enabled, provider: record.settings.protocol,
      baseUrl: normalizeTenantModelBaseUrl(record.settings.baseUrl), allowedModels: [record.settings.model],
      credentialRef: this.reference(record), timeoutMs: record.settings.timeoutMs,
      maxConcurrent: record.settings.maxConcurrent, maxOutputTokens: record.settings.maxOutputTokens };
  }

  async credential(reference: string, context: GatewayContext) {
    await this.authorize(context, "invoke");
    const record = await this.readRecord(context.tenantId);
    if (!record || !record.settings.enabled || this.reference(record) !== reference) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    return this.decrypt(record);
  }
}
