import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileCapability, AiProviderProfileRecord } from './provider-profile.ports';
import type { AiCapabilityEvidenceStatus, ProviderCapabilityEvidenceRepository, RecordCapabilityEvidenceInput } from './provider-capability.ports';

export interface CapabilityPreflight { allowed: boolean; required: readonly AiProfileCapability[]; missing: readonly AiProfileCapability[]; stale: readonly AiProfileCapability[]; }
const now = () => Date.now();
export class ProviderCapabilityService {
  constructor(private readonly repository: ProviderCapabilityEvidenceRepository) {}
  async record(input: RecordCapabilityEvidenceInput) {
    if (input.profile.disabledAt || !input.profile.enabled || !Number.isSafeInteger(input.profile.configRevision) || input.profile.configRevision < 1) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    if (!input.evidenceHash || !input.checkedAt || input.checkedAt.getTime() > now() + 60_000) throw new ModelGatewayError('CONFIG_INVALID');
    return this.repository.upsert(input);
  }
  async preflight(profile: AiProviderProfileRecord, required: readonly AiProfileCapability[]): Promise<CapabilityPreflight> {
    const unique = [...new Set(required)];
    const rows = await this.repository.list(profile);
    const current = new Map(rows.filter(row => row.observedRevision === profile.configRevision && (!row.expiresAt || row.expiresAt.getTime() > now())).map(row => [row.capability, row]));
    const missing = unique.filter(capability => !current.has(capability) || current.get(capability)!.status !== 'supported');
    const stale = unique.filter(capability => rows.some(row => row.capability === capability && row.observedRevision !== profile.configRevision));
    return { allowed: missing.length === 0, required: unique, missing, stale };
  }
  async assert(profile: AiProviderProfileRecord, required: readonly AiProfileCapability[]) {
    const result = await this.preflight(profile, required);
    if (!result.allowed) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return result;
  }
}
