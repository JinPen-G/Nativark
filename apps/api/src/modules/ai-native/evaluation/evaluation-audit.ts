import { z } from 'zod';
import { id, scopeSchema } from '../knowledge/knowledge-validation';

// Offline artifact format only, not a permission grant or production audit writer.
// Producers must hash/redact inputs before calling this formatter. No free-text
// bodies, model thoughts, credentials or internal authority envelopes are accepted.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const refs = z.array(id).max(64).refine(items => new Set(items).size === items.length);
const resultSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'unknown', 'denied', 'unavailable']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
}).strict().refine(value => value.code !== 'AI_RESULT_UNKNOWN' || value.status === 'unknown');
const auditSchema = z.object({
  version: z.literal(1), requestId: id, scope: scopeSchema,
  inputHash: hash, authorityHash: hash, planIds: refs, toolIds: refs,
  result: resultSchema,
}).strict();

export function evaluationAudit(value: unknown) {
  return structuredClone(auditSchema.parse(value));
}

const outcomeSchema = z.object({
  id,
  evidence: z.enum(['offline_service', 'transport_simulation', 'contract_static']),
  status: z.enum(['pass', 'fail', 'unavailable']),
}).strict();
const outcomesSchema = z.array(outcomeSchema).max(1000)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);

// Deterministic test outcomes do not estimate human time, language quality,
// production security or live network acceptance.
export function evaluationSummary(value: unknown) {
  const rows = outcomesSchema.parse(value);
  const counts = { pass: 0, fail: 0, unavailable: 0 };
  for (const row of rows) counts[row.status]++;
  return {
    counts, cases: structuredClone(rows),
    languageQuality: 'not_sampled' as const,
    realEgress: 'not_verified' as const,
    realDatabase: 'not_verified' as const,
    independentReview: 'pending' as const,
  };
}
