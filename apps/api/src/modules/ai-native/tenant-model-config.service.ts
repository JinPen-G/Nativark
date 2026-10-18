import { createHash } from "node:crypto";
import { z } from "zod";
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_USAGE_DRAFT_SCHEMAS, AI_USAGE_DRAFT_VERSION,
  type AiTenantModelSettingsInputDraft, type AiTenantModelSettingsSummaryDraft } from '@rental-os/shared';
import { SecretBox } from "../../common/secret-box";
import { isPrivateOrLocalHost, parseOutboundUrl } from "../../common/outbound-url";
import { ModelGatewayError, type GatewayContext, type GatewayProfile } from "./model-gateway.ports";
import { tenantModelMode, tenantModelServiceEnabled, AiModelConfigurationResultUnknownError,
  AiModelConfigurationRevisionConflictError } from "./model-config-compatibility";
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { capabilityNameSchema } from './capability-verification';
import type { AiProfileCapability } from './provider-profile.ports';
import { modelConfigurationOperationKey, type ModelConfigurationOperationWrite } from './model-configuration-operation';
import type { AiModelConfigurationOperationDraft } from '@rental-os/shared';
import type { AiLegacyModelConfigurationDraft } from '@rental-os/shared';
import type { LegacyModelConfigurationBasis, LegacyModelConfigurationSource } from './tenant-model-config.repository';

/** Protocol support, never a supplier/model catalogue. Extend through tested adapters. */
export const tenantModelProtocols = ["openai_chat_completions"] as const;
export const tenantModelSettingsSchema = z.object({
  enabled: z.boolean().default(false), protocol: z.enum(tenantModelProtocols),
  baseUrl: z.string().min(1).max(2048), model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
  apiKey: z.string().min(1).max(8192).regex(/^[^\r\n]+$/u).optional(),
  secretChange: z.discriminatedUnion("operation", [z.object({ operation: z.literal("retain") }).strict(), z.object({ operation: z.literal("replace"), apiKey: z.string().min(1).max(8192).regex(/^[^\r\n]+$/u) }).strict(), z.object({ operation: z.literal("clear") }).strict()]).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxConcurrent: z.number().int().min(1).max(20).default(2),
  maxOutputTokens: z.number().int().min(1).max(32768).default(2048),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2)
}).strict();
const settingsSchema = tenantModelSettingsSchema;
type Settings = Omit<z.infer<typeof settingsSchema>, "apiKey" | "expectedRevision" | "secretChange">;
export interface TenantModelRecord { tenantId: string; revision: number; mode?: "platform_managed" | "tenant_managed";
  serviceEnabled?: boolean; settings?: Settings; credentialsEncrypted?: string; }
const settingsAjv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(settingsAjv);
const validPublicSettings = settingsAjv.compile<AiTenantModelSettingsInputDraft>(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsInputDraft);
export interface TenantModelConfigPorts {
  /** Must validate fresh server identity, tenant membership, space access and action permission. */
  authorize(context: GatewayContext, action: "read" | "manage" | "invoke"): Promise<void>;
  repository: {
    read(tenantId: string, legacy?: LegacyModelConfigurationBasis): Promise<TenantModelRecord | null>;
    readLegacyState?(tenantId: string): Promise<{ configured: boolean; source: LegacyModelConfigurationSource | null }>;
    /** Atomic compare-and-swap, including insert at revision zero. Never blind upsert. */
    compareAndSwap(tenantId: string, expectedRevision: number, next: TenantModelRecord, context?: GatewayContext,
      operation?: ModelConfigurationOperationWrite, legacy?: LegacyModelConfigurationBasis): Promise<boolean>;
    readOperation?(context: GatewayContext, operationKey: string, commandHash?: string): Promise<AiModelConfigurationOperationDraft>;
    setAllowedCapabilities?(context: GatewayContext, expectedRevision: number, capabilities: readonly AiProfileCapability[]): Promise<{ revision: number; allowedCapabilities: readonly AiProfileCapability[] }>;
  };
}

/** Stable internal vault reference; shared by the config service and atomic
 * Profile projection. Never a credential, permission or live capability proof. */
export function tenantModelCredentialReference(tenantId: string, revision: number) {
  return `tenant-model:${createHash("sha256").update(tenantId).digest("hex")}:${revision}`;
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
  constructor(private readonly ports: TenantModelConfigPorts, private readonly secrets: SecretBox) {
    if (!ports || typeof ports.authorize !== "function" || typeof ports.repository?.read !== "function" || typeof ports.repository?.compareAndSwap !== "function" || !secrets) throw new ModelGatewayError("CONFIG_INVALID");
  }

  private snapshot(value: unknown): unknown {
    try { return structuredClone(value); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  private async authorize(context: GatewayContext, action: "read" | "manage" | "invoke") {
    if (!context || [context.tenantId, context.workspaceId, context.actorId].some(v => typeof v !== "string" || !/^[\w.:-]{1,128}$/u.test(v))) {
      throw new ModelGatewayError("INVALID_REQUEST");
    }
    // Capture identity before yielding. A caller cannot mutate the original object
    // between authorization and a repository/vault operation.
    const scope = Object.freeze({ tenantId: context.tenantId, workspaceId: context.workspaceId, actorId: context.actorId });
    try { await this.ports.authorize(scope, action); } catch { throw new ModelGatewayError("FORBIDDEN"); }
    return scope;
  }

  private async readRecord(tenantId: string, legacy?: LegacyModelConfigurationBasis) {
    const record = this.snapshot(await this.ports.repository.read(tenantId, legacy)) as TenantModelRecord | null;
    if (record && record.tenantId !== tenantId) throw new ModelGatewayError("FORBIDDEN");
    if (!record) return null;
    tenantModelMode(record);
    tenantModelServiceEnabled(record);
    if (!record.settings) return record;
    const parsed = settingsSchema.omit({ apiKey: true, expectedRevision: true, secretChange: true }).safeParse(record.settings);
    if (!parsed.success || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= Number.MAX_SAFE_INTEGER || typeof record.credentialsEncrypted !== "string") throw new ModelGatewayError("CONFIG_INVALID");
    return { ...record, settings: parsed.data };
  }

  private decrypt(record: TenantModelRecord) {
    try {
      if (!record.settings || !record.credentialsEncrypted) throw new Error();
      const secret = this.secrets.decrypt(record.credentialsEncrypted);
      // Bind ciphertext to tenant and destination; a copied row cannot reuse another tenant's key.
      if (secret.tenantId !== record.tenantId || secret.protocol !== record.settings.protocol || secret.baseUrl !== record.settings.baseUrl || secret.model !== record.settings.model || typeof secret.apiKey !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(secret.apiKey)) throw new Error();
      return secret.apiKey;
    } catch { throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE"); }
  }

  private reference(record: TenantModelRecord) {
    return tenantModelCredentialReference(record.tenantId, record.revision);
  }

  private summary(record: TenantModelRecord) {
    if (tenantModelMode(record) === "platform_managed") return { mode: "platform_managed" as const, serviceName: "Rental OS AI", revision: record.revision,
      enabled: tenantModelServiceEnabled(record), availability: "not_verified" as const };
    return { ...record.settings, enabled: tenantModelServiceEnabled(record) && record.settings?.enabled === true,
      mode: "tenant_managed" as const, revision: record.revision, keyConfigured: Boolean(record.credentialsEncrypted) };
  }

  async get(context: GatewayContext) {
    context = await this.authorize(context, "read");
    const record = await this.readRecord(context.tenantId);
    await this.authorize(context, 'read');
    if (!record) return { mode: "platform_managed" as const, serviceName: "Rental OS AI", revision: 0, enabled: false, availability: "not_verified" as const };
    if (record.credentialsEncrypted) this.decrypt(record);
    return this.summary(record);
  }

  async save(context: GatewayContext, value: unknown) {
    const request = this.snapshot(value);
    context = await this.authorize(context, "manage");
    const parsed = settingsSchema.safeParse(request);
    if (!parsed.success) throw new ModelGatewayError("CONFIG_INVALID");
    const { expectedRevision } = parsed.data;
    const previous = await this.readRecord(context.tenantId);
    if ((previous?.revision ?? 0) !== expectedRevision) throw new ModelGatewayError("CONFIG_INVALID");
    const prepared = this.prepareTenantSettings(context.tenantId, previous, parsed.data);
    const mode = previous?.mode ?? 'tenant_managed';
    const next: TenantModelRecord = { tenantId: context.tenantId, mode, revision: expectedRevision + 1, ...prepared,
      serviceEnabled: mode === 'tenant_managed' ? prepared.settings.enabled : tenantModelServiceEnabled(previous) };
    await this.authorize(context, 'manage');
    if (!await this.ports.repository.compareAndSwap(context.tenantId, expectedRevision, next, context)) throw new ModelGatewayError('CONFIG_INVALID');
    return this.summary(next);
  }

  private prepareTenantSettings(tenantId: string, previous: TenantModelRecord | null, input: z.infer<typeof settingsSchema>) {
    const { apiKey, secretChange, expectedRevision: _, ...settings } = input;
    if (apiKey !== undefined && secretChange !== undefined) throw new ModelGatewayError("CONFIG_INVALID");
    const suppliedKey = secretChange?.operation === "replace" ? secretChange.apiKey : apiKey;
    if (suppliedKey !== undefined && !/^[\x21-\x7e]{1,8192}$/.test(suppliedKey.trim())) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    settings.baseUrl = normalizeTenantModelBaseUrl(settings.baseUrl);
    // Never silently forward a stored key to a changed endpoint/protocol.
    if (secretChange?.operation !== "clear" && !suppliedKey?.trim() && (!previous?.settings || previous.settings.baseUrl !== settings.baseUrl || previous.settings.protocol !== settings.protocol)) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    const clear = secretChange?.operation === "clear";
    const key = clear ? undefined : suppliedKey?.trim() || this.decrypt(previous!);
    if (clear) settings.enabled = false;
    let encrypted: string;
    try { encrypted = clear ? "" : this.secrets.encrypt({ apiKey: key!, tenantId, protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model }); }
    catch { throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE"); }
    return { settings, credentialsEncrypted: encrypted };
  }

  private publicSummary(tenantId: string, record: TenantModelRecord | null): AiTenantModelSettingsSummaryDraft {
    const base = { draftVersion: AI_USAGE_DRAFT_VERSION, tenantId, configId: tenantId,
      configRevision: record?.revision ?? 0, enabled: tenantModelServiceEnabled(record), connectionState: 'not_verified' as const };
    if (tenantModelMode(record) === 'platform_managed') return { ...base, mode: 'platform_managed',
      serviceName: 'Rental OS AI', routing: 'automatic', availability: 'not_verified' };
    if (!record?.settings) throw new ModelGatewayError('CONFIG_INVALID');
    let credentialState: 'configured' | 'missing' | 'rotation_required' = 'missing';
    if (record.credentialsEncrypted) {
      try { this.decrypt(record); credentialState = 'configured'; }
      catch { credentialState = 'rotation_required'; }
    }
    return { ...base, enabled: base.enabled && record.settings.enabled, mode: 'tenant_managed',
      protocol: record.settings.protocol, baseUrl: record.settings.baseUrl, model: record.settings.model, credentialState };
  }

  /** Existing C07 management projection; identity comes from the actual request
   * authority. A configuration read does not attest capability or connection. */
  async readSettings(context: GatewayContext): Promise<AiTenantModelSettingsSummaryDraft> {
    context = await this.authorize(context, 'read');
    const before = await this.readRecord(context.tenantId);
    await this.authorize(context, 'read');
    const latest = await this.readRecord(context.tenantId);
    await this.authorize(context, 'read');
    if (requestFingerprint(before) !== requestFingerprint(latest)) throw new AiModelConfigurationRevisionConflictError();
    return this.publicSummary(context.tenantId, latest);
  }

  /** Mode + independent service gate + retained/replaced/cleared credential
   * commit once with the existing Profile CAS. Never two sequential saves. */
  async saveSettings(context: GatewayContext, value: unknown): Promise<AiTenantModelSettingsSummaryDraft> {
    const request = this.snapshot(value);
    if (!validPublicSettings(request)) throw new ModelGatewayError('INVALID_REQUEST');
    const input = request;
    context = await this.authorize(context, 'manage');
    if (input.configId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
    const commandHash = input.operationKey === undefined ? undefined : this.secrets.fingerprint(requestFingerprint({ context, input }));
    if (input.operationKey !== undefined) {
      if (!this.ports.repository.readOperation) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      const original = await this.ports.repository.readOperation(context, input.operationKey, commandHash);
      await this.authorize(context, 'manage');
      if (original.state === 'recorded') {
        if (!('tenantId' in original.result) || original.result.tenantId !== context.tenantId) throw new ModelGatewayError('CONFIG_INVALID');
        return original.result;
      }
    }
    let legacy: LegacyModelConfigurationBasis | undefined;
    const legacySource = input.mode === 'tenant_managed' ? input.legacySource : undefined;
    if (legacySource !== undefined) {
      if (input.mode !== 'tenant_managed' || input.expectedRevision !== 0 || input.enabled || !input.operationKey
        || input.secretChange.operation !== 'replace' || /\*|•|…/u.test(input.secretChange.apiKey)) throw new ModelGatewayError('INVALID_REQUEST');
      if (!this.ports.repository.readLegacyState) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      const state = structuredClone(await this.ports.repository.readLegacyState(context.tenantId));
      await this.authorize(context, 'manage');
      if (state.configured || !state.source || legacySource.fingerprint !== this.secrets.fingerprint(requestFingerprint(state.source))
        || legacySource.parameterSetId !== state.source.id || legacySource.versionNo !== state.source.versionNo) throw new AiModelConfigurationRevisionConflictError();
      const old = state.source.content as { aiModel?: { provider?: unknown } };
      if (!['OPENAI', 'OPENAI_COMPATIBLE'].includes(old.aiModel?.provider as string)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      legacy = { parameterSetId: state.source.id, versionNo: state.source.versionNo, hash: requestFingerprint(state.source) };
    }
    const previous = await this.readRecord(context.tenantId, legacy);
    if ((previous?.revision ?? 0) !== input.expectedRevision) throw new AiModelConfigurationRevisionConflictError();
    let next: TenantModelRecord = { ...previous, tenantId: context.tenantId, mode: input.mode,
      serviceEnabled: input.enabled, revision: input.expectedRevision + 1 };
    if (input.mode === 'tenant_managed') {
      const parsed = settingsSchema.safeParse({ ...(previous?.settings ?? {}), enabled: input.enabled,
        protocol: input.protocol, baseUrl: input.baseUrl, model: input.model,
        secretChange: input.secretChange, expectedRevision: input.expectedRevision });
      if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
      const prepared = this.prepareTenantSettings(context.tenantId, previous, parsed.data);
      next = { ...next, ...prepared, serviceEnabled: prepared.settings.enabled };
    }
    await this.authorize(context, 'manage');
    const result = this.publicSummary(context.tenantId, next);
    const operation = input.operationKey === undefined ? undefined : { operationKey: input.operationKey,
      expectedRevision: input.expectedRevision, commandHash: commandHash!, result };
    if (!await this.ports.repository.compareAndSwap(context.tenantId, input.expectedRevision, next, context, operation, legacy)) throw new AiModelConfigurationRevisionConflictError();
    try {
      await this.authorize(context, 'manage');
      return result;
    } catch { throw new AiModelConfigurationResultUnknownError(); }
  }

  async readSettingsOperation(context: GatewayContext, key: unknown): Promise<AiModelConfigurationOperationDraft> {
    if (!modelConfigurationOperationKey.safeParse(key).success) throw new ModelGatewayError('INVALID_REQUEST');
    context = await this.authorize(context, 'read');
    if (!this.ports.repository.readOperation) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const result = await this.ports.repository.readOperation(context, key as string);
    await this.authorize(context, 'read');
    return structuredClone(result);
  }

  /** Review only: preserve the old object, expose no key/mask/log/prompt, and
   * never turn a historical connection success into current capability proof. */
  async readLegacySettings(context: GatewayContext): Promise<AiLegacyModelConfigurationDraft> {
    context = await this.authorize(context, 'read');
    if (!this.ports.repository.readLegacyState) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const before = structuredClone(await this.ports.repository.readLegacyState(context.tenantId));
    await this.authorize(context, 'read');
    const latest = structuredClone(await this.ports.repository.readLegacyState(context.tenantId));
    await this.authorize(context, 'read');
    if (requestFingerprint(before) !== requestFingerprint(latest)) throw new AiModelConfigurationRevisionConflictError();
    const base = { currentConfiguration: latest.configured ? 'present' as const : 'absent' as const,
      automaticImport: false as const, sourcePreserved: true as const, execution: 'not_granted' as const };
    if (!latest.source) return { ...base, state: 'not_recorded', source: null };
    const old = latest.source.content as { aiModel?: { provider?: unknown } };
    return { ...base, state: 'review_required', source: { parameterSetId: latest.source.id, versionNo: latest.source.versionNo,
      fingerprint: this.secrets.fingerprint(requestFingerprint(latest.source)) },
      supportedProtocol: ['OPENAI', 'OPENAI_COMPATIBLE'].includes(old.aiModel?.provider as string) ? 'openai_chat_completions' : null,
      credential: 'replacement_required', conversion: 'explicit_disabled_replacement_only' };
  }

  async profile(context: GatewayContext): Promise<GatewayProfile> {
    context = await this.authorize(context, "invoke");
    const record = await this.readRecord(context.tenantId);
    await this.authorize(context, 'invoke');
    if (!record || tenantModelMode(record) !== "tenant_managed") throw new ModelGatewayError("PROVIDER_UNAVAILABLE");
    if (!record.settings) throw new ModelGatewayError("CONFIG_INVALID");
    return { enabled: tenantModelServiceEnabled(record) && record.settings.enabled, provider: record.settings.protocol,
      baseUrl: normalizeTenantModelBaseUrl(record.settings.baseUrl), allowedModels: [record.settings.model],
      credentialRef: this.reference(record), timeoutMs: record.settings.timeoutMs,
      maxConcurrent: record.settings.maxConcurrent, maxOutputTokens: record.settings.maxOutputTokens };
  }

  async credential(reference: string, context: GatewayContext) {
    context = await this.authorize(context, "invoke");
    const record = await this.readRecord(context.tenantId);
    await this.authorize(context, 'invoke');
    if (!record || !tenantModelServiceEnabled(record) || tenantModelMode(record) !== "tenant_managed" || !record.settings?.enabled || this.reference(record) !== reference) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    return this.decrypt(record);
  }

  private async select(context: GatewayContext, action: 'read' | 'invoke') {
    context = await this.authorize(context, action);
    const record = await this.readRecord(context.tenantId);
    await this.authorize(context, action);
    if (action === 'invoke' && !tenantModelServiceEnabled(record)) throw new ModelGatewayError('DISABLED');
    return { mode: tenantModelMode(record), revision: record?.revision ?? 0 };
  }

  async selection(context: GatewayContext) { return this.select(context, 'read'); }
  async selectionForInvocation(context: GatewayContext) { return this.select(context, 'invoke'); }

  /** Server application policy entry, not a model capability claim or public DTO.
   * Only the atomic config/Profile adapter can implement this operation. */
  async setAllowedCapabilities(context: GatewayContext, value: unknown) {
    const parsed = z.object({ expectedRevision: z.number().int().min(1).max(4294967294),
      allowedCapabilities: z.array(capabilityNameSchema).max(8).refine(items => new Set(items).size === items.length)
    }).strict().safeParse(this.snapshot(value));
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    context = await this.authorize(context, 'manage');
    if (typeof this.ports.repository.setAllowedCapabilities !== 'function') throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    return this.ports.repository.setAllowedCapabilities(context, parsed.data.expectedRevision, parsed.data.allowedCapabilities);
  }

  /** Mode selection is not a credential deletion operation. */
  async changeMode(context: GatewayContext, value: unknown) {
    const request = this.snapshot(value);
    context = await this.authorize(context, "manage");
    const input = z.object({ mode: z.enum(["platform_managed", "tenant_managed"]), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2) }).strict().safeParse(request);
    if (!input.success) throw new ModelGatewayError("CONFIG_INVALID");
    const previous = await this.readRecord(context.tenantId);
    if ((previous?.revision ?? 0) !== input.data.expectedRevision) throw new ModelGatewayError("CONFIG_INVALID");
    if (input.data.mode === "tenant_managed" && (!previous?.settings || !previous.credentialsEncrypted)) throw new ModelGatewayError("CREDENTIAL_UNAVAILABLE");
    if (input.data.mode === 'tenant_managed') this.decrypt(previous!);
    const next: TenantModelRecord = { ...previous, tenantId: context.tenantId, mode: input.data.mode,
      serviceEnabled: tenantModelServiceEnabled(previous), revision: input.data.expectedRevision + 1 };
    await this.authorize(context, 'manage');
    if (!await this.ports.repository.compareAndSwap(context.tenantId, input.data.expectedRevision, next, context)) throw new ModelGatewayError("CONFIG_INVALID");
    return this.summary(next);
  }
}
