import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileCapability, AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityEvidenceRepository, RecordCapabilityEvidenceInput } from './provider-capability.ports';
import { capabilityNameSchema, capabilityProfileFingerprint, capabilityVerificationSchema, type AiLiveCapabilityEvidenceVerifier } from './capability-verification';

export interface CapabilityPreflight { allowed: boolean; required: readonly AiProfileCapability[]; missing: readonly AiProfileCapability[]; stale: readonly AiProfileCapability[]; }
const id = z.string().min(1).max(191);
const profileShape = z.object({
  id, scopeId: id, scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']), profileKey: id, protocol: id, provider: id,
  model: z.string().min(1).max(256), credentialRef: id, configRevision: z.number().int().min(1).max(4294967295),
  role: z.enum(['DEFAULT', 'REASONING', 'VISION', 'EMBEDDING']), serviceMode: z.enum(['platform_managed', 'tenant_managed']),
  enabled: z.boolean(), disabledAt: z.date().nullable(), allowedCapabilities: z.array(capabilityNameSchema).max(8)
}).strict();
const evidenceFields = {
  capability: capabilityNameSchema, status: z.enum(['supported', 'unsupported', 'unverified']),
  source: z.enum(['connection_test', 'declared', 'manual']), evidenceHash: z.string().min(1).max(128),
  checkedAt: z.date(), expiresAt: z.date().nullable(), details: z.record(z.unknown()).optional()
};
const inputShape = z.object({ ...evidenceFields, profile: profileShape, expiresAt: evidenceFields.expiresAt.optional() }).strict();
const rowShape = z.object({
  ...evidenceFields, id, profileId: id, scope: z.object({ id, kind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']) }),
  observedRevision: z.number().int().min(1).max(4294967295),
  details: z.record(z.unknown()).nullish().transform(value => value ?? undefined)
});

export class ProviderCapabilityService {
  private readonly allowMock: boolean;
  private readonly verifyLive?: AiLiveCapabilityEvidenceVerifier['verify'];

  constructor(
    private readonly repository: ProviderCapabilityEvidenceRepository,
    options: { allowMock?: boolean; liveEvidenceVerifier?: AiLiveCapabilityEvidenceVerifier } = {},
    private readonly clock: () => Date = () => new Date()
  ) {
    if (!repository || typeof repository.list !== 'function' || typeof repository.upsert !== 'function'
      || !options || typeof options !== 'object' || Array.isArray(options) || typeof clock !== 'function'
      || Object.keys(options).some(key => key !== 'allowMock' && key !== 'liveEvidenceVerifier')
      || (options.allowMock !== undefined && typeof options.allowMock !== 'boolean')
      || (options.liveEvidenceVerifier !== undefined && typeof options.liveEvidenceVerifier?.verify !== 'function')) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    this.allowMock = options.allowMock === true;
    this.verifyLive = options.liveEvidenceVerifier?.verify.bind(options.liveEvidenceVerifier);
  }

  private snapshot<T>(value: T): T {
    try { return structuredClone(value); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  private now(): Date {
    try {
      const value = this.clock();
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw Error();
      return new Date(value);
    } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  private profile(value: AiProviderProfileRecord): AiProviderProfileRecord {
    const parsed = profileShape.safeParse(this.snapshot(value));
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    if (!parsed.data.enabled || parsed.data.disabledAt) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    return parsed.data;
  }

  private fresh(input: Pick<RecordCapabilityEvidenceInput, 'checkedAt' | 'expiresAt'>, now: Date): boolean {
    return input.checkedAt <= now && input.expiresAt != null && input.expiresAt > now && input.expiresAt > input.checkedAt;
  }

  private async verified(input: RecordCapabilityEvidenceInput): Promise<boolean> {
    const proof = capabilityVerificationSchema.safeParse(input.details?.verification);
    if (input.source !== 'connection_test' || !proof.success || proof.data.capability !== input.capability
      || proof.data.profileFingerprint !== capabilityProfileFingerprint(input.profile)
      || !input.profile.allowedCapabilities.includes(input.capability)) return false;
    if (proof.data.evidence === 'mock') return this.allowMock;
    if (!this.verifyLive) return false;
    try { return await this.verifyLive(this.snapshot(input)) === true; } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  async record(value: RecordCapabilityEvidenceInput) {
    const parsed = inputShape.safeParse(this.snapshot(value));
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    const input: RecordCapabilityEvidenceInput = parsed.data;
    input.profile = this.profile(input.profile);
    if (input.checkedAt > this.now() || (input.expiresAt != null && input.expiresAt <= input.checkedAt)) throw new ModelGatewayError('CONFIG_INVALID');
    if (input.status === 'supported' && (!this.fresh(input, this.now()) || !await this.verified(input) || !this.fresh(input, this.now()))) {
      input.status = 'unverified';
    }
    try { return await this.repository.upsert(input); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  async preflight(value: AiProviderProfileRecord, requested: readonly AiProfileCapability[]): Promise<CapabilityPreflight> {
    const profile = this.profile(value);
    const parsed = z.array(capabilityNameSchema).min(1).max(8).safeParse(requested);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    const required = [...new Set(parsed.data)];
    let rows;
    try {
      const records = this.snapshot(await this.repository.list(this.snapshot(profile)));
      if (!Array.isArray(records) || records.length > 100) throw Error();
      rows = records.map(row => rowShape.parse(row));
    } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.profileId !== profile.id || row.scope.id !== profile.scopeId || row.scope.kind !== profile.scopeKind) throw new ModelGatewayError('CONFIG_INVALID');
      const key = `${row.capability}:${row.observedRevision}`;
      if (seen.has(key)) throw new ModelGatewayError('CONFIG_INVALID');
      seen.add(key);
    }
    const approved = new Map<AiProfileCapability, RecordCapabilityEvidenceInput>(), stale = new Set<AiProfileCapability>();
    for (const row of rows) {
      if (!required.includes(row.capability)) continue;
      if (row.observedRevision !== profile.configRevision || !this.fresh(row, this.now())) { stale.add(row.capability); continue; }
      const input: RecordCapabilityEvidenceInput = {
        profile, capability: row.capability, status: row.status, source: row.source,
        evidenceHash: row.evidenceHash, checkedAt: row.checkedAt, expiresAt: row.expiresAt, details: row.details
      };
      if (row.status === 'supported' && await this.verified(input)) approved.set(row.capability, input);
    }
    const now = this.now(), current = new Set<AiProfileCapability>();
    for (const [capability, input] of approved) {
      if (this.fresh(input, now)) current.add(capability);
      else stale.add(capability);
    }
    const missing = required.filter(capability => !current.has(capability));
    return { allowed: missing.length === 0, required, missing, stale: missing.filter(capability => stale.has(capability)) };
  }

  async assert(profile: AiProviderProfileRecord, required: readonly AiProfileCapability[]) {
    const result = await this.preflight(profile, required);
    if (!result.allowed) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return result;
  }
}
