import { randomUUID } from 'node:crypto';
import { rentalPrismaNulls } from '@rental-os/rental-core/prisma-null-values';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityEvidenceRepository, RecordCapabilityEvidenceInput } from './provider-capability.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { capabilityEvidenceDetails, capabilityEvidenceFields, capabilityEvidenceProfileSchema, listCapabilityEvidence, parseCapabilityEvidenceRow } from '../configuration/provider-capability-evidence';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';

export interface ProviderCapabilityEvidenceTransactions {
  begin(tx: Prisma.TransactionClient, profile: AiProviderProfileRecord): Promise<{
    revalidate(): Promise<void>;
    close(): void;
  }>;
}

const inputSchema = z.object({ ...capabilityEvidenceFields, profile: capabilityEvidenceProfileSchema.strict() }).strict();
function payload(value: { status: string; source: string; evidenceHash: string; checkedAt: Date; expiresAt?: Date | null; details?: unknown }) {
  return requestFingerprint({ status: value.status, source: value.source, evidenceHash: value.evidenceHash,
    checkedAt: value.checkedAt, expiresAt: value.expiresAt ?? null, details: value.details ?? null });
}
/** Storage binding only, not action authorization or proof of live capability.
 * Current Profile fencing serializes probes with config changes. The caller
 * application still supplies current authority and the evidence verifier. */
export class PrismaProviderCapabilityEvidenceRepository implements ProviderCapabilityEvidenceRepository {
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiProviderProfile' | 'aiProviderCapabilityEvidence'>,
    private readonly transactions?: ProviderCapabilityEvidenceTransactions) {
    if ([db?.$transaction, db?.aiProviderProfile?.updateMany, db?.aiProviderProfile?.findFirst,
      db?.aiProviderCapabilityEvidence?.findMany, db?.aiProviderCapabilityEvidence?.findUnique,
      db?.aiProviderCapabilityEvidence?.upsert].some(method => typeof method !== 'function')) throw new Error('AI_CAPABILITY_EVIDENCE_PRISMA_UNAVAILABLE');
  }
  list(value: AiProviderProfileRecord) { return listCapabilityEvidence(this.db, value); }
  async upsert(value: RecordCapabilityEvidenceInput) {
    const input = inputSchema.parse(structuredClone(value)), p = input.profile;
    if (!p.enabled || p.disabledAt) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
    const json = capabilityEvidenceDetails(input.details) ?? rentalPrismaNulls.DbNull;
    if (input.expiresAt != null && input.expiresAt <= input.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_TIME');
    const data = { profileId: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, capability: input.capability,
      status: input.status, source: input.source, observedRevision: p.configRevision, evidenceHash: input.evidenceHash,
      checkedAt: input.checkedAt, expiresAt: input.expiresAt ?? null, details: json };
    return this.db.$transaction(async tx => {
      const participant = hasRentalBusinessTenantFence() ? await this.transactions?.begin(tx, p) : undefined;
      if (hasRentalBusinessTenantFence() && !participant) throw new Error('AI_CAPABILITY_EVIDENCE_AUTHORITY_UNAVAILABLE');
      try {
        const where = { id: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, configRevision: p.configRevision, enabled: true, disabledAt: null };
        // A same-revision conditional update takes the existing Profile row lock;
        // it does not grant dispatch rights or advance the configuration revision.
        if ((await tx.aiProviderProfile.updateMany({ where, data: { configRevision: p.configRevision } })).count !== 1) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
        const current = await tx.aiProviderProfile.findFirst({ where });
        if (!current || capabilityProfileFingerprint(capabilityEvidenceProfileSchema.parse(current)) !== capabilityProfileFingerprint(p)) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
        const key = { profileId_capability: { profileId: p.id, capability: input.capability } };
        const previous = await tx.aiProviderCapabilityEvidence.findUnique({ where: key });
        if (previous) {
          const old = parseCapabilityEvidenceRow(previous);
          if (old.scope.id !== p.scopeId || old.scope.kind !== p.scopeKind || old.observedRevision > p.configRevision) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
          if (old.observedRevision === p.configRevision) {
            if (old.checkedAt > input.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_STALE');
            if (old.checkedAt.getTime() === input.checkedAt.getTime()) {
              if (payload(input) !== payload(old)) throw new Error('AI_CAPABILITY_EVIDENCE_CONFLICT');
              await participant?.revalidate();
              return old;
            }
          }
        }
        const saved = parseCapabilityEvidenceRow(await tx.aiProviderCapabilityEvidence.upsert({ where: key, create: { id: randomUUID(), ...data }, update: data }));
        if (saved.profileId !== p.id || saved.scope.id !== p.scopeId || saved.scope.kind !== p.scopeKind
          || saved.capability !== input.capability || saved.observedRevision !== p.configRevision
          || payload(saved) !== payload(input)) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
        await participant?.revalidate();
        return saved;
      } finally { participant?.close(); }
    });
  }
}
