import { PrismaService } from '../database/prisma.service';
import type { AiProfileScope, AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityEvidenceRepository, RecordCapabilityEvidenceInput, AiProviderCapabilityEvidenceRecord } from './provider-capability.ports';

type Delegate = { findMany(args: unknown): Promise<unknown[]>; upsert(args: unknown): Promise<unknown> };
const scopeOf = (profile: AiProviderProfileRecord): AiProfileScope => ({ id: profile.scopeId, kind: profile.scopeKind });
function record(value: unknown): AiProviderCapabilityEvidenceRecord {
  const row = value as Record<string, unknown>;
  if (!row || typeof row.id !== 'string' || typeof row.profileId !== 'string' || typeof row.scopeId !== 'string' || typeof row.scopeKind !== 'string' || typeof row.capability !== 'string' || typeof row.status !== 'string' || typeof row.source !== 'string' || typeof row.observedRevision !== 'number' || typeof row.evidenceHash !== 'string' || !(row.checkedAt instanceof Date)) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  return { id: row.id, profileId: row.profileId, scope: { id: row.scopeId, kind: row.scopeKind as AiProviderProfileRecord['scopeKind'] }, capability: row.capability as AiProviderCapabilityEvidenceRecord['capability'], status: row.status as AiProviderCapabilityEvidenceRecord['status'], source: row.source as AiProviderCapabilityEvidenceRecord['source'], observedRevision: row.observedRevision, evidenceHash: row.evidenceHash, checkedAt: row.checkedAt, expiresAt: row.expiresAt instanceof Date ? row.expiresAt : null, details: row.details as Readonly<Record<string, unknown>> | undefined };
}
/** Prisma adapter; current-revision filtering belongs to the service to keep history explicit. */
export class PrismaProviderCapabilityEvidenceRepository implements ProviderCapabilityEvidenceRepository {
  private readonly delegate: Delegate;
  constructor(prisma: PrismaService) { this.delegate = (prisma as unknown as { aiProviderCapabilityEvidence?: Delegate }).aiProviderCapabilityEvidence!; if (!this.delegate) throw new Error('AI_CAPABILITY_EVIDENCE_PRISMA_UNAVAILABLE'); }
  async list(profile: AiProviderProfileRecord) { const rows = await this.delegate.findMany({ where: { profileId: profile.id, scopeId: profile.scopeId, scopeKind: profile.scopeKind }, orderBy: { capability: 'asc' } }); return rows.map(record); }
  async upsert(input: RecordCapabilityEvidenceInput) { const p = input.profile; const data = { profileId: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, capability: input.capability, status: input.status, source: input.source, observedRevision: p.configRevision, evidenceHash: input.evidenceHash, checkedAt: input.checkedAt, expiresAt: input.expiresAt ?? null, details: input.details ?? undefined }; const row = await this.delegate.upsert({ where: { profileId_capability: { profileId: p.id, capability: input.capability } }, create: { id: crypto.randomUUID(), ...data }, update: data }); return record(row); }
}
