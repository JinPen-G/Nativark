/** Original automation-policy boundary in the manager's existing transaction.
 * Scope and limits come from the recorded policy/subject; current Auth, manager
 * CAS and execution remain caller responsibilities. Missing history is never
 * backfilled, and this receipt cannot enable tools, recipients or a retry. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AiAutomationPolicy, AiAutomationSubject, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_AUTOMATION_POLICY_HTTP_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_EVENTS_DRAFT_VERSION, AI_SCOPE_DRAFT_SCHEMAS,
  type AiAutomationPolicyConstraintsDraft, type AiAutomationPolicyDraft } from '@rental-os/shared';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';

export type AutomationPolicyConstraints = AiAutomationPolicyConstraintsDraft;
type Db = Pick<Prisma.TransactionClient, 'aiScope' | 'aiAutomationPolicy' | 'aiAutomationSubject' | 'operationLog'>;
type RecordInput = { scopeId: string; actorId: string; policy: AiAutomationPolicy; subject: AiAutomationSubject;
  constraints: AutomationPolicyConstraints };
const invalid = () => new AiTaskRepositoryError('AI_INVALID_INPUT');
const storage = () => new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const date = z.date().refine(value => Number.isFinite(value.getTime()));
const uniqueIds = (maximum: number) => z.array(id).min(1).max(maximum)
  .refine(values => new Set(values).size === values.length);
const provenance = { enabledBy: id.nullish(), enabledAudience: z.literal('operator').nullish(), enabledAt: date.nullish() };
const policyRow = z.object({ id: id.max(36), tenantId: id, workspaceId: id, subjectId: id.max(36), revision,
  mode: z.enum(['disabled', 'shadow', 'manual_confirmation']), sceneCode: id.max(64), sceneVersion: id.max(64),
  allowedEventTypes: z.array(z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception',
    'fulfillment.resource_shortage', 'opening.missing_configuration'])).min(1).max(5)
    .refine(values => new Set(values).size === values.length), maxTasksPerDay: z.number().int().min(0).max(10000),
  cooldownSeconds: z.number().int().min(1).max(86400), validFrom: date, expiresAt: date, revokedAt: date.nullable(), ...provenance });
const subjectRow = z.object({ id: id.max(36), tenantId: id, workspaceId: id, authorizationRevision: revision,
  enabled: z.boolean(), permissions: z.array(z.enum(['system:integration:manage', 'rental-os:finance:view',
    'rental-os:order:view'])).min(1).max(3).refine(values => new Set(values).size === values.length),
  locationScope: z.discriminatedUnion('mode', [z.object({ mode: z.literal('all'), locationIds: z.tuple([]) }).strict(),
    z.object({ mode: z.literal('selected'), locationIds: uniqueIds(100) }).strict()]),
  expiresAt: date, revokedAt: date.nullable(), ...provenance });
const policySelect = { id: true, tenantId: true, workspaceId: true, subjectId: true, revision: true, mode: true,
  sceneCode: true, sceneVersion: true, allowedEventTypes: true, maxTasksPerDay: true, cooldownSeconds: true,
  validFrom: true, expiresAt: true, revokedAt: true, enabledBy: true, enabledAudience: true, enabledAt: true } satisfies Prisma.AiAutomationPolicySelect;
const subjectSelect = { id: true, tenantId: true, workspaceId: true, authorizationRevision: true, enabled: true,
  permissions: true, locationScope: true, expiresAt: true, revokedAt: true,
  enabledBy: true, enabledAudience: true, enabledAt: true } satisfies Prisma.AiAutomationSubjectSelect;

const definitions = JSON.parse(JSON.stringify({ ...AI_EVENTS_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS,
  AiAutomationPolicyConstraintsDraft: AI_AUTOMATION_POLICY_HTTP_SCHEMAS.AiAutomationPolicyConstraintsDraft })
  .replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validBoundary = ajv.compile<AiAutomationPolicyDraft>({ $ref: '#/$defs/AiAutomationPolicyDraft', $defs: definitions });
const validConstraints = ajv.compile<AutomationPolicyConstraints>({ $ref: '#/$defs/AiAutomationPolicyConstraintsDraft', $defs: definitions });
const action = 'ai_native_automation_policy_boundary';
const payloadShape = z.object({ version: z.literal('automation-policy-boundary-1'), scopeId: id.max(36), actorId: id,
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u), subjectHash: z.string().regex(/^[a-f0-9]{64}$/u), boundary: z.unknown() }).strict();
const detailShape = z.object({ payload: payloadShape, payloadHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type Target = ReturnType<typeof target>;
type Payload = Omit<z.infer<typeof payloadShape>, 'boundary'> & { boundary: AiAutomationPolicyDraft };
const receiptId = (scopeId: string, policyId: string, policyRevision: number) =>
  `automation-policy:${hash({ version: 'automation-policy-boundary-1', scopeId, policyId, revision: policyRevision })}`;
const audit = (value: z.infer<typeof policyRow> | z.infer<typeof subjectRow>) => ({ enabledBy: value.enabledBy ?? null,
  enabledAudience: value.enabledAudience ?? null, enabledAt: value.enabledAt?.toISOString() ?? null });

function target(policy: unknown, subject: unknown, management = false) {
  let copies: [unknown, unknown];
  try { copies = structuredClone([policy, subject]); } catch { throw invalid(); }
  const p = policyRow.safeParse(copies[0]), s = subjectRow.safeParse(copies[1]);
  if (!p.success || !s.success || p.data.subjectId !== s.data.id || p.data.tenantId !== s.data.tenantId
    || p.data.workspaceId !== s.data.workspaceId || p.data.validFrom >= p.data.expiresAt
    || !management && p.data.expiresAt > s.data.expiresAt) throw invalid();
  const policyValue = { ...p.data, validFrom: p.data.validFrom.toISOString(), expiresAt: p.data.expiresAt.toISOString(),
    revokedAt: p.data.revokedAt?.toISOString() ?? null, ...audit(p.data) };
  const subjectValue = { ...s.data, expiresAt: s.data.expiresAt.toISOString(), revokedAt: s.data.revokedAt?.toISOString() ?? null,
    ...audit(s.data) };
  // Preparation counters and updatedAt change without a policy revision. Bind
  // the original configuration and instants, never those live usage counters.
  return { policy: p.data, subject: s.data, policyHash: hash(policyValue), subjectHash: hash(subjectValue),
    columns: aiPersistenceScopeColumns({ kind: 'workspace', tenantId: p.data.tenantId, workspaceId: p.data.workspaceId }) };
}

function boundaryFor(value: Target, constraints: unknown): AiAutomationPolicyDraft {
  let selected: unknown;
  try { selected = structuredClone(constraints); } catch { throw invalid(); }
  if (!validConstraints(selected)) throw invalid();
  const { policy, subject } = value;
  if (policy.mode !== 'disabled' && (selected.allowedTools.length || selected.allowedRecipientIds.length
    || !subject.enabled || subject.revokedAt !== null || policy.revokedAt !== null)) throw invalid();
  if (new Set(selected.allowedTools.map(tool => tool.toolCode)).size !== selected.allowedTools.length) throw invalid();
  const proposed = { draftVersion: AI_EVENTS_DRAFT_VERSION, policyId: policy.id, revision: policy.revision,
    scope: { kind: 'workspace', tenantId: policy.tenantId, workspaceId: policy.workspaceId },
    subject: { subjectId: subject.id, authorizationRevision: subject.authorizationRevision }, mode: policy.mode,
    allowedTools: selected.allowedTools, allowedWorkspaces: [policy.workspaceId],
    allowedLocations: subject.locationScope.locationIds, allowedRecipientIds: selected.allowedRecipientIds,
    limits: { maxRunsPerDay: policy.maxTasksPerDay, cooldownSeconds: policy.cooldownSeconds, ...selected.limits },
    validFrom: policy.validFrom.toISOString(), expiresAt: policy.expiresAt.toISOString(), r3Policy: 'human_and_original_approval' };
  // Do not clamp zero/oversized legacy values into a different signed policy.
  if (!validBoundary(proposed)) throw invalid();
  return structuredClone(proposed);
}

async function current(db: Db, expected: Target, expectedScopeId?: string, management = false) {
  if ([db?.aiScope?.findFirst, db?.aiAutomationPolicy?.findFirst, db?.aiAutomationSubject?.findFirst,
    db?.operationLog?.findUnique].some(method => typeof method !== 'function')) throw storage();
  const scope = await db.aiScope.findFirst({ where: expected.columns });
  if (!scope || !id.max(36).safeParse(scope.id).success || expectedScopeId !== undefined && scope.id !== expectedScopeId
    || Object.entries(expected.columns).some(([key, value]) => scope[key as keyof typeof scope] !== value)) throw storage();
  const owner = { tenantId: expected.policy.tenantId, workspaceId: expected.policy.workspaceId };
  const [policy, subject] = await Promise.all([
    db.aiAutomationPolicy.findFirst({ where: { ...owner, id: expected.policy.id, subjectId: expected.subject.id }, select: policySelect }),
    db.aiAutomationSubject.findFirst({ where: { ...owner, id: expected.subject.id }, select: subjectSelect })
  ]);
  if (!policy || !subject) throw conflict();
  let latest: Target;
  try { latest = target(policy, subject, management); } catch { throw storage(); }
  if (latest.policyHash !== expected.policyHash || latest.subjectHash !== expected.subjectHash) throw conflict();
  return scope.id;
}

async function original(db: Db, expected: Target, scopeId: string, management = false) {
  const key = receiptId(scopeId, expected.policy.id, expected.policy.revision);
  const row = await db.operationLog.findUnique({ where: { id: key }, select: {
    id: true, tenantId: true, workspaceId: true, userId: true, action: true, detail: true, createdAt: true } });
  if (!row) return { payload: undefined, fingerprint: hash(null) };
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof detailShape>>;
  try {
    if (Buffer.byteLength(JSON.stringify(row.detail) ?? '', 'utf8') > 65536) throw storage();
    parsed = detailShape.safeParse(structuredClone(row.detail));
  } catch { throw storage(); }
  if (!parsed.success || !validBoundary(parsed.data.payload.boundary) || !date.safeParse(row.createdAt).success) throw storage();
  const payload: Payload = { ...parsed.data.payload, boundary: parsed.data.payload.boundary };
  if (row.id !== key || row.action !== action || row.tenantId !== expected.policy.tenantId || row.workspaceId !== expected.policy.workspaceId
    || row.userId !== payload.actorId || payload.scopeId !== scopeId || parsed.data.payloadHash !== hash(payload)
    || payload.policyHash !== expected.policyHash) throw storage();
  if (payload.subjectHash !== expected.subjectHash) {
    // A shared subject can change through another policy. Its old constraints
    // remain configuration history for a current manager, never execution proof.
    // Require an earlier recorded revision and the exact unchanged policy; do
    // not reconstruct old subject permissions/expiry from current values.
    const boundary = payload.boundary, policy = expected.policy;
    if (!management || boundary.subject.subjectId !== expected.subject.id
      || boundary.subject.authorizationRevision >= expected.subject.authorizationRevision
      || boundary.draftVersion !== AI_EVENTS_DRAFT_VERSION || boundary.policyId !== policy.id || boundary.revision !== policy.revision
      || boundary.mode !== policy.mode || boundary.scope.kind !== 'workspace' || boundary.scope.tenantId !== policy.tenantId
      || boundary.scope.workspaceId !== policy.workspaceId || hash(boundary.allowedWorkspaces) !== hash([policy.workspaceId])
      || boundary.limits.maxRunsPerDay !== policy.maxTasksPerDay || boundary.limits.cooldownSeconds !== policy.cooldownSeconds
      || boundary.validFrom !== policy.validFrom.toISOString() || boundary.expiresAt !== policy.expiresAt.toISOString()
      || boundary.r3Policy !== 'human_and_original_approval'
      || !validConstraints({ allowedTools: boundary.allowedTools, allowedRecipientIds: boundary.allowedRecipientIds,
        limits: { maxActionsPerRun: boundary.limits.maxActionsPerRun, maxQuantity: boundary.limits.maxQuantity,
          maxCausalDepth: boundary.limits.maxCausalDepth } })
      || new Set(boundary.allowedTools.map(tool => tool.toolCode)).size !== boundary.allowedTools.length) throw storage();
    return { payload, fingerprint: hash({ ...row, detail: parsed.data, createdAt: row.createdAt.toISOString() }) };
  }
  let generated: AiAutomationPolicyDraft;
  try { generated = boundaryFor(expected, { allowedTools: payload.boundary.allowedTools,
    allowedRecipientIds: payload.boundary.allowedRecipientIds, limits: {
      maxActionsPerRun: payload.boundary.limits.maxActionsPerRun, maxQuantity: payload.boundary.limits.maxQuantity,
      maxCausalDepth: payload.boundary.limits.maxCausalDepth } }); } catch { throw storage(); }
  if (hash(generated) !== hash(payload.boundary)) throw storage();
  return { payload, fingerprint: hash({ ...row, detail: parsed.data, createdAt: row.createdAt.toISOString() }) };
}

async function stableOriginal(db: Db, expected: Target, expectedScopeId?: string, management = false) {
  const scopeId = await current(db, expected, expectedScopeId, management), first = await original(db, expected, scopeId, management);
  await current(db, expected, scopeId, management);
  const second = await original(db, expected, scopeId, management);
  await current(db, expected, scopeId, management);
  const final = await original(db, expected, scopeId, management);
  await current(db, expected, scopeId, management);
  if (first.fingerprint !== second.fingerprint || second.fingerprint !== final.fingerprint) throw conflict();
  return { scopeId, payload: final.payload };
}

/** Exact original policy revision only. The caller encloses this storage read
 * in its current authority; absence never becomes a default or new signature. */
export async function readOriginalAutomationPolicyBoundary(db: Db, policy: AiAutomationPolicy, subject: AiAutomationSubject)
  : Promise<AiAutomationPolicyDraft | undefined> {
  const result = await stableOriginal(db, target(policy, subject));
  return result.payload ? structuredClone(result.payload.boundary) : undefined;
}

/** Original configuration for an authorized manager only. A prior subject
 * revision may be displayed, but the caller must explicitly CAS a new policy
 * revision before recording a fresh binding. Execution always uses the strict
 * read above; neither reader updates or backfills this historical receipt. */
export async function readRecordedAutomationPolicyBoundaryForManagement(db: Db, policy: AiAutomationPolicy, subject: AiAutomationSubject)
  : Promise<AiAutomationPolicyDraft | undefined> {
  const result = await stableOriginal(db, target(policy, subject, true), undefined, true);
  return result.payload ? structuredClone(result.payload.boundary) : undefined;
}

/** Called after the manager's original CAS, with that same transaction. A lost
 * write acknowledgement is propagated; no insert/update or COMMIT is retried. */
export async function recordOriginalAutomationPolicyBoundary(tx: Db, input: RecordInput): Promise<AiAutomationPolicyDraft> {
  let copy: RecordInput;
  try { copy = structuredClone(input); } catch { throw invalid(); }
  if (!copy || Object.keys(copy).length !== 5 || !['scopeId', 'actorId', 'policy', 'subject', 'constraints'].every(key => key in copy)
    || !id.max(36).safeParse(copy.scopeId).success || !id.safeParse(copy.actorId).success) throw invalid();
  if (typeof tx?.operationLog?.create !== 'function') throw storage();
  const expected = target(copy.policy, copy.subject), boundary = boundaryFor(expected, copy.constraints);
  const payload: Payload = { version: 'automation-policy-boundary-1', scopeId: copy.scopeId, actorId: copy.actorId,
    policyHash: expected.policyHash, subjectHash: expected.subjectHash, boundary };
  const before = await stableOriginal(tx, expected, copy.scopeId);
  if (before.payload) {
    if (hash(before.payload) !== hash(payload)) throw conflict();
    return structuredClone(before.payload.boundary);
  }
  await tx.operationLog.create({ data: { id: receiptId(copy.scopeId, expected.policy.id, expected.policy.revision),
    tenantId: expected.policy.tenantId, workspaceId: expected.policy.workspaceId, userId: copy.actorId, action,
    detail: JSON.parse(JSON.stringify({ payload, payloadHash: hash(payload) })) as Prisma.InputJsonValue } });
  const after = await stableOriginal(tx, expected, copy.scopeId);
  if (!after.payload || hash(after.payload) !== hash(payload)) throw storage();
  return structuredClone(after.payload.boundary);
}
