import { z } from 'zod';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import type { RecordCapabilityEvidenceInput } from './provider-capability.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export const capabilityNameSchema = z.enum(['text', 'streaming', 'tools', 'structured_output', 'vision', 'audio', 'embedding', 'reasoning']);
export const capabilityVerificationSchema = z.object({
  evidence: z.enum(['mock', 'live']), methodVersion: z.string().min(1).max(128), capability: capabilityNameSchema,
  profileFingerprint: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();
export type AiCapabilityVerification = z.infer<typeof capabilityVerificationSchema>;
export interface AiLiveCapabilityEvidenceVerifier {
  // Trusted server dependency: verify provenance and capability-specific results, not just metadata.
  verify(input: RecordCapabilityEvidenceInput): Promise<boolean>;
}
// Configuration binding is not a signature or authorization.
export function capabilityProfileFingerprint(p: AiProviderProfileRecord): string {
  return requestFingerprint({ id: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, profileKey: p.profileKey, protocol: p.protocol, provider: p.provider,
    model: p.model, credentialRef: p.credentialRef, configRevision: p.configRevision, role: p.role,
    serviceMode: p.serviceMode, allowedCapabilities: [...p.allowedCapabilities].sort() });
}
