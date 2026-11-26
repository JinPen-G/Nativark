/** Original Profile-bound capability evidence parser and read query. No write or probe authority. */
import type { Prisma, PrismaClient, AiProviderCapabilityEvidence } from '@prisma/client';
import { z } from 'zod';
import type { AiProviderProfileRecord } from '@rental-os/platform-server/ai-gateway';
import { capabilityNameSchema, type AiProviderCapabilityEvidenceRecord } from '@rental-os/platform-server/ai-gateway';

const id = z.string().min(1).max(36), revision = z.number().int().min(1).max(4294967295);
const capabilityCount = capabilityNameSchema.options.length;
export const capabilityEvidenceProfileSchema = z.object({ id, scopeId: id, scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']),
  profileKey: z.string().min(1).max(64), role: z.enum(['DEFAULT', 'REASONING', 'VISION', 'EMBEDDING']),
  serviceMode: z.enum(['platform_managed', 'tenant_managed']), protocol: z.string().min(1).max(64),
  provider: z.string().min(1).max(128), model: z.string().min(1).max(256), credentialRef: z.string().min(1).max(191),
  configRevision: revision, enabled: z.boolean(), disabledAt: z.date().nullable(),
  allowedCapabilities: z.array(capabilityNameSchema).max(capabilityCount).refine(values => new Set(values).size === values.length)
});
export const capabilityEvidenceFields = { capability: capabilityNameSchema, status: z.enum(['supported', 'unsupported', 'unverified']),
  source: z.enum(['connection_test', 'declared', 'manual']), evidenceHash: z.string().min(1).max(128),
  checkedAt: z.date(), expiresAt: z.date().nullable().optional(), details: z.record(z.unknown()).nullable().optional() };
const rowSchema = z.object({ ...capabilityEvidenceFields, id, profileId: id, scopeId: id,
  scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']), observedRevision: revision });
export function capabilityEvidenceDetails(value: unknown): Prisma.InputJsonObject | null {
  if (value == null) return null;
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
export function parseCapabilityEvidenceRow(value: AiProviderCapabilityEvidence): AiProviderCapabilityEvidenceRecord {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  const row = parsed.data;
  if (row.expiresAt != null && row.expiresAt <= row.checkedAt) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  capabilityEvidenceDetails(row.details);
  return { id: row.id, profileId: row.profileId, scope: { id: row.scopeId, kind: row.scopeKind },
    capability: row.capability, status: row.status, source: row.source, observedRevision: row.observedRevision,
    evidenceHash: row.evidenceHash, checkedAt: row.checkedAt, expiresAt: row.expiresAt ?? null,
    ...(row.details == null ? {} : { details: row.details }) };
}
export async function listCapabilityEvidence(db: Pick<PrismaClient, 'aiProviderCapabilityEvidence'>, value: AiProviderProfileRecord) {
  const profile = capabilityEvidenceProfileSchema.strict().parse(structuredClone(value));
  const rows = await db.aiProviderCapabilityEvidence.findMany({ where: { profileId: profile.id,
    scopeId: profile.scopeId, scopeKind: profile.scopeKind }, orderBy: { capability: 'asc' }, take: capabilityCount + 1 });
  if (rows.length > capabilityCount) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  const result = rows.map(parseCapabilityEvidenceRow);
  if (result.some(row => row.profileId !== profile.id || row.scope.id !== profile.scopeId || row.scope.kind !== profile.scopeKind)
    || new Set(result.map(row => row.capability)).size !== result.length) throw new Error('AI_CAPABILITY_EVIDENCE_INVALID_ROW');
  return result;
}
