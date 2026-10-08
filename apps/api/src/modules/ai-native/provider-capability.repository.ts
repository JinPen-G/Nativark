import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiProviderCapabilityEvidence } from '@prisma/client';
import { z } from 'zod';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityEvidenceRepository, RecordCapabilityEvidenceInput, AiProviderCapabilityEvidenceRecord } from './provider-capability.ports';
import { capabilityNameSchema, capabilityProfileFingerprint } from './capability-verification';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(36), revision = z.number().int().min(1).max(4294967295);
const profileSchema = z.object({ id, scopeId: id, scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']),
  profileKey: z.string().min(1).max(64), role: z.enum(['DEFAULT', 'REASONING', 'VISION', 'EMBEDDING']),
  serviceMode: z.enum(['platform_managed', 'tenant_managed']), protocol: z.string().min(1).max(64),
  provider: z.string().min(1).max(128), model: z.string().min(1).max(256), credentialRef: z.string().min(1).max(191),
  configRevision: revision, enabled: z.boolean(), disabledAt: z.date().nullable(),
  allowedCapabilities: z.array(capabilityNameSchema).max(7).refine(values => new Set(values).size === values.length)
});
const fields = { capability: capabilityNameSchema, status: z.enum(['supported', 'unsupported', 'unverified']),
  source: z.enum(['connection_test', 'declared', 'manual']), evidenceHash: z.string().min(1).max(128),
  checkedAt: z.date(), expiresAt: z.date().nullable().optional(), details: z.record(z.unknown()).nullable().optional() };
const inputSchema = z.object({ ...fields, profile: profileSchema.strict() }).strict();
const rowSchema = z.object({ ...fields, id, profileId: id, scopeId: id,
  scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']), observedRevision: revision });
function details(value: unknown): Prisma.InputJsonObject | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull;
  try {
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item)
        || (typeof item === 'number' && !Number.isFinite(item))) throw Error();
      return item;
    });
    if (Buffer.byteLength(json, 'utf8') > 32768) throw Error();
    return JSON.parse(json) as Prisma.InputJsonObject;
  } catch { throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_DETAILS'); }
}
function record(value: AiProviderCapabilityEvidence): AiProviderCapabilityEvidenceRecord {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  const row = parsed.data;
  if (row.expiresAt != null && row.expiresAt <= row.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  details(row.details);
  return { id: row.id, profileId: row.profileId, scope: { id: row.scopeId, kind: row.scopeKind },
    capability: row.capability, status: row.status, source: row.source, observedRevision: row.observedRevision,
    evidenceHash: row.evidenceHash, checkedAt: row.checkedAt, expiresAt: row.expiresAt ?? null,
    ...(row.details == null ? {} : { details: row.details }) };
}
function payload(value: { status: string; source: string; evidenceHash: string; checkedAt: Date; expiresAt?: Date | null; details?: unknown }) {
  return requestFingerprint({ status: value.status, source: value.source, evidenceHash: value.evidenceHash,
    checkedAt: value.checkedAt, expiresAt: value.expiresAt ?? null, details: value.details ?? null });
}
/** Storage binding only, not action authorization or proof of live capability.
 * Current Profile fencing serializes probes with config changes. The caller
 * application still supplies current authority and the evidence verifier. */
export class PrismaProviderCapabilityEvidenceRepository implements ProviderCapabilityEvidenceRepository {
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiProviderProfile' | 'aiProviderCapabilityEvidence'>) {
    if ([db?.$transaction, db?.aiProviderProfile?.updateMany, db?.aiProviderProfile?.findFirst,
      db?.aiProviderCapabilityEvidence?.findMany, db?.aiProviderCapabilityEvidence?.findUnique,
      db?.aiProviderCapabilityEvidence?.upsert].some(method => typeof method !== 'function')) throw new Error('AI_CAPABILITY_EVIDENCE_PRISMA_UNAVAILABLE');
  }
  async list(value: AiProviderProfileRecord) {
    const profile = profileSchema.strict().parse(structuredClone(value));
    const rows = await this.db.aiProviderCapabilityEvidence.findMany({ where: { profileId: profile.id,
      scopeId: profile.scopeId, scopeKind: profile.scopeKind }, orderBy: { capability: 'asc' }, take: 8 });
    if (rows.length > 7) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
    const result = rows.map(record);
    if (result.some(row => row.profileId !== profile.id || row.scope.id !== profile.scopeId || row.scope.kind !== profile.scopeKind)
      || new Set(result.map(row => row.capability)).size !== result.length) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
    return result;
  }
  async upsert(value: RecordCapabilityEvidenceInput) {
    const input = inputSchema.parse(structuredClone(value)), p = input.profile;
    if (!p.enabled || p.disabledAt) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
    const json = details(input.details);
    if (input.expiresAt != null && input.expiresAt <= input.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_TIME');
    const data = { profileId: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, capability: input.capability,
      status: input.status, source: input.source, observedRevision: p.configRevision, evidenceHash: input.evidenceHash,
      checkedAt: input.checkedAt, expiresAt: input.expiresAt ?? null, details: json };
    return this.db.$transaction(async tx => {
      const where = { id: p.id, scopeId: p.scopeId, scopeKind: p.scopeKind, configRevision: p.configRevision, enabled: true, disabledAt: null };
      // A same-revision conditional update takes the existing Profile row lock;
      // it does not grant dispatch rights or advance the configuration revision.
      if ((await tx.aiProviderProfile.updateMany({ where, data: { configRevision: p.configRevision } })).count !== 1) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
      const current = await tx.aiProviderProfile.findFirst({ where });
      if (!current || capabilityProfileFingerprint(profileSchema.parse(current)) !== capabilityProfileFingerprint(p)) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
      const key = { profileId_capability: { profileId: p.id, capability: input.capability } };
      const previous = await tx.aiProviderCapabilityEvidence.findUnique({ where: key });
      if (previous) {
        const old = record(previous);
        if (old.scope.id !== p.scopeId || old.scope.kind !== p.scopeKind || old.observedRevision > p.configRevision) throw new Error('AI_CAPABILITY_PROFILE_CHANGED');
        if (old.observedRevision === p.configRevision) {
          if (old.checkedAt > input.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_STALE');
          if (old.checkedAt.getTime() === input.checkedAt.getTime()) {
            if (payload(input) !== payload(old)) throw new Error('AI_CAPABILITY_EVIDENCE_CONFLICT');
            return old;
          }
        }
      }
      const saved = record(await tx.aiProviderCapabilityEvidence.upsert({ where: key, create: { id: randomUUID(), ...data }, update: data }));
      if (saved.profileId !== p.id || saved.scope.id !== p.scopeId || saved.scope.kind !== p.scopeKind
        || saved.capability !== input.capability || saved.observedRevision !== p.configRevision
        || payload(saved) !== payload(input)) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
      return saved;
    });
  }
}
