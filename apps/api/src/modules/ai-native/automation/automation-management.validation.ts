import { z } from 'zod';
import type { AiAutomationSubject, AiAutomationPolicy } from '@prisma/client';

export const managementId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
export const managementRevision = z.number().int().min(1).max(4294967293);
export const managementHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const managementTime = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const locations = z.array(managementId).min(1).max(100).refine(value => new Set(value).size === value.length).transform(value => value.sort());
export const subjectSettings = z.object({ enabled: z.boolean(), revoked: z.boolean(),
  permissions: z.array(z.enum(['system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'])).min(1).max(3)
    .refine(value => new Set(value).size === value.length).transform(value => value.sort()),
  locationScope: z.discriminatedUnion('mode', [z.object({ mode: z.literal('all'), locationIds: z.tuple([]) }).strict(),
    z.object({ mode: z.literal('selected'), locationIds: locations }).strict()]), expiresAt: managementTime }).strict();
export const policySettings = z.object({ mode: z.enum(['disabled', 'shadow', 'manual_confirmation']), revoked: z.boolean(),
  sceneCode: managementId.max(64), sceneVersion: managementId.max(64),
  allowedEventTypes: z.array(z.enum(['notification.failed', 'refund.failed'])).min(1).max(2)
    .refine(value => new Set(value).size === value.length).transform(value => value.sort()),
  maxTasksPerDay: z.number().int().min(0).max(10000), cooldownSeconds: z.number().int().min(1).max(86400),
  validFrom: managementTime, expiresAt: managementTime }).strict();
export const policyChange = z.object({ operationKey: managementId.max(128), subjectId: managementId.max(36).nullable(),
  policyId: managementId.max(36).nullable(), expectedSubjectRevision: managementRevision.nullable(), expectedPolicyRevision: managementRevision.nullable(),
  subject: subjectSettings, policy: policySettings }).strict().refine(value =>
    (value.subjectId === null) === (value.expectedSubjectRevision === null)
    && (value.policyId === null) === (value.expectedPolicyRevision === null) && (!value.policyId || Boolean(value.subjectId)));
export type PolicyChange = z.infer<typeof policyChange>;
export class AutomationManagementError extends Error {
  readonly retryable = false;
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'conflict') { super(code); }
}
export function managementParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AutomationManagementError('invalid_input');
  return parsed.data;
}
const enabledAudit = { enabledBy: managementId.nullable(), enabledAudience: z.literal('operator').nullable(), enabledAt: managementTime.nullable() };
export const managementResult = z.object({ subject: subjectSettings.extend({ id: managementId.max(36), authorizationRevision: managementRevision, ...enabledAudit }).strict(),
  policy: policySettings.extend({ id: managementId.max(36), subjectId: managementId.max(36), revision: managementRevision, ...enabledAudit,
    counterDay: managementTime.nullable(), preparedCount: z.number().int().min(0).max(4294967295), lastPreparedAt: managementTime.nullable() }).strict() }).strict();
export function subjectConfiguration(row: AiAutomationSubject) {
  return subjectSettings.parse({ enabled: row.enabled, revoked: row.revokedAt !== null, permissions: row.permissions,
    locationScope: row.locationScope, expiresAt: row.expiresAt.toISOString() });
}
export function policyConfiguration(row: AiAutomationPolicy) {
  return policySettings.parse({ mode: row.mode, revoked: row.revokedAt !== null, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
    allowedEventTypes: row.allowedEventTypes, maxTasksPerDay: row.maxTasksPerDay, cooldownSeconds: row.cooldownSeconds,
    validFrom: row.validFrom.toISOString(), expiresAt: row.expiresAt.toISOString() });
}
export const enabledProvenance = (row: AiAutomationSubject | AiAutomationPolicy) => ({ enabledBy: row.enabledBy,
  enabledAudience: row.enabledAudience, enabledAt: row.enabledAt?.toISOString() ?? null });
