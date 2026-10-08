import type { AiProfileCapability, AiProfileScope, AiProviderProfileRecord } from './provider-profile.ports';

export type AiCapabilityEvidenceStatus = 'supported' | 'unsupported' | 'unverified';
export type AiCapabilityEvidenceSource = 'connection_test' | 'declared' | 'manual';
export interface AiProviderCapabilityEvidenceRecord {
  id: string; profileId: string; scope: AiProfileScope; capability: AiProfileCapability;
  status: AiCapabilityEvidenceStatus; source: AiCapabilityEvidenceSource;
  observedRevision: number; evidenceHash: string; checkedAt: Date; expiresAt: Date | null;
  details?: Readonly<Record<string, unknown>>;
}
export interface RecordCapabilityEvidenceInput {
  profile: AiProviderProfileRecord; capability: AiProfileCapability;
  status: AiCapabilityEvidenceStatus; source: AiCapabilityEvidenceSource;
  evidenceHash: string; checkedAt: Date; expiresAt?: Date | null;
  details?: Readonly<Record<string, unknown>>;
}
export interface ProviderCapabilityEvidenceRepository {
  list(profile: AiProviderProfileRecord): Promise<AiProviderCapabilityEvidenceRecord[]>;
  upsert(input: RecordCapabilityEvidenceInput): Promise<AiProviderCapabilityEvidenceRecord>;
}
