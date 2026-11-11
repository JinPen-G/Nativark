/** Prepares and issues minimum original-task action policies under a published
 * scene policy and current business Guard. Original CAS receipts are observed
 * independently; no Run, business approval or Core operation is executed here. */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { originalRequestReferenceSchema } from './task-request/original-request.validation';
import type { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { taskActionPolicyOperations, type AiTaskActionPolicyOperation,
  type PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutationResult } from './prisma-task-action-policy.repository';
import { TaskExecutionAdmissionAuthority, type TaskExecutionAdmissionSigningDependencies } from './task-execution-admission.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967294);
const permissions = z.array(id).min(1).max(64).refine(values => new Set(values).size === values.length);
const operation = z.custom<AiTaskActionPolicyOperation>(value => typeof value === 'string' && taskActionPolicyOperations.includes(value));
const policyView = z.object({ taskId: id.max(36), operation, revision, requiredPermissions: permissions,
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const intent = z.enum(['explicit_start', 'explicit_rule_preparation', 'explicit_calendar_preparation']);
const preparation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('business_rule'), targetId: id }).strict(),
  z.object({ kind: z.literal('business_calendar'), targetId: id, version: id,
    year: z.number().int().min(1900).max(2200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    revision: z.number().int().min(0).max(4294967294) }).strict()
]);
const actionReference = z.object({ operation, mode: z.enum(['configure', 'retain']), expectedRevision: revision.nullable(), requiredPermissions: permissions,
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const taskReference = z.object({ taskId: id.max(36), runId: id.max(36), scopeId: id.max(36), ownerId: id,
  sceneCode: id, sceneVersion: id.max(64), inputRevision: revision, inputHash: hash, creationFingerprint: hash,
  ownershipHash: hash }).strict();
const publicationView = z.object({ scopeId: id.max(36), sceneCode: id.max(64), sceneVersion: id.max(64), revision,
  enabled: z.boolean(), expiresAt: z.string().datetime({ offset: true }), tools: aiPersistedPlanToolsSchema,
  limits: aiTaskRunnerLimitsSchema, contentHash: hash }).strict();
const referenceSchema = z.object({ version: z.literal('task-execution-admission-2'), intent, preparation: preparation.optional(), original: originalRequestReferenceSchema,
  task: taskReference, state: z.object({ taskRevision: revision, runRevision: revision }).strict(),
  publication: publicationView, actions: z.array(actionReference).min(1).max(12)
    .refine(values => new Set(values.map(value => value.operation)).size === values.length), intentHash: hash }).strict();
const prepareSchema = z.object({ original: originalRequestReferenceSchema, intent, preparation: preparation.optional() }).strict()
  .refine(value => value.intent === 'explicit_rule_preparation' ? value.preparation?.kind === 'business_rule'
    : value.intent === 'explicit_calendar_preparation' ? value.preparation?.kind === 'business_calendar' : value.preparation === undefined);

export type TaskExecutionAdmissionReference = z.infer<typeof referenceSchema>;
export interface TaskExecutionAdmissionPolicyReceipt {
  operation: AiTaskActionPolicyOperation; expectedRevision: number | null;
  state: 'recorded' | 'not_observed' | 'retained_policy'; policy: AiTaskActionPolicyMutationResult | null;
  matchesPreparedContent: boolean;
}
export type TaskExecutionAdmissionReceiptView = {
  phase: 'receipt_participant_unavailable'; original: TaskExecutionAdmissionReference['original']; taskId: string;
  missing: readonly ['current_owner_original_policy_cas_receipt_reader']; execution: 'not_started'; automaticRetry: false;
} | {
  phase: 'policy_cas_receipts'; original: TaskExecutionAdmissionReference['original']; taskId: string; runId: string;
  entries: TaskExecutionAdmissionPolicyReceipt[]; completeRecorded: boolean;
  publicationBinding: 'not_attested_by_legacy_policy_receipt'; admission: 'not_granted'; execution: 'not_started';
  businessApproval: 'not_granted'; automaticRetry: false; absenceSemantics: 'not_observed_is_not_proof_of_no_write';
  consistency: 'revalidated_reads_not_atomic_snapshot';
};
export interface TaskExecutionAdmissionIssueResult {
  phase: 'not_issued' | 'original_receipts' | 'policy_admission_recorded' | 'issuance_requires_original_receipt';
  reference: TaskExecutionAdmissionReference; receipt?: TaskExecutionAdmissionReceiptView;
  signing?: 'already_recorded_or_retained' | 'recorded' | 'unknown';
  admission?: 'not_granted_by_replay' | 'current_publication_and_role_revalidated' | 'not_granted';
  execution: 'not_started'; businessApproval?: 'not_granted'; automaticRetry?: false;
}
export type TaskExecutionAdmissionReceiptParticipant = Pick<PrismaTaskActionPolicyRepository, 'readMutation'>
  & Partial<Pick<PrismaTaskActionPolicyRepository, 'read'>>;
export interface TaskExecutionAdmissionDependencies {
  db: Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiTaskPlanPolicy' | 'aiTaskActionPolicy'>;
  /** Already authenticated original metadata/resource reader. Its historical
   * locator does not reopen erased text or require new-execution configuration. */
  originals: Pick<PrismaOriginalRequestRepository, 'readTaskLocator'>;
  /** Must retain its original current-read authority. No permissive default
   * reader is constructed when the ordinary-owner participant is unavailable. */
  receipts?: TaskExecutionAdmissionReceiptParticipant;
  clock?: () => Date;
  maximumAdmissionMs?: number;
}

const sceneTools = {
  order_explanation: { permission: 'rental-os:order:view', tools: ['ai.model.text', 'rental.order.explain'] },
  quote_clarification: { permission: 'rental-os:order:create', tools: [
    'ai.model.text', 'rental.catalog.search', 'rental.availability.check', 'membership.customer.resolve', 'rental.order.commit'] },
  opening_diagnosis: { permission: 'rental-os:price:manage', tools: [
    'ai.model.text', 'tenant.opening.diagnose', 'tenant.config.propose', 'tenant.notifications.commit'] }
} as const;
type Scene = keyof typeof sceneTools;
const initialOperations: readonly AiTaskActionPolicyOperation[] = ['read_metadata', 'read_events', 'read_step_terminal',
  'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'takeover_run'];
const invalid = () => new AiTaskRepositoryError('AI_INVALID_INPUT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const corrupt = () => new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const referenceHash = (value: Omit<TaskExecutionAdmissionReference, 'intentHash'>) => requestFingerprint(value);

/** The ready result describes existing policies or a concrete signing request.
 * Issuance still needs a participant that locks/rechecks this publication,
 * current owner/role and explicit start intent with the original policy CAS. */
export function composeTaskExecutionAdmission(d: TaskExecutionAdmissionDependencies, signing?: TaskExecutionAdmissionSigningDependencies) {
  if (typeof d?.originals?.readTaskLocator !== 'function' || typeof d.db?.aiTask?.findFirst !== 'function'
    || typeof d.db.aiRun?.findFirst !== 'function' || typeof d.db.aiTaskPlanPolicy?.findFirst !== 'function'
    || typeof d.db.aiTaskActionPolicy?.findMany !== 'function'
    || d.receipts !== undefined && typeof d.receipts.readMutation !== 'function') throw unavailable();
  if (signing && (!Object.is(signing.db, d.db) || !Object.is(signing.originals, d.originals))) throw denied();
  const maximumMs = z.number().int().min(1).max(120000).parse(d.maximumAdmissionMs ?? 120000);
  const clock = d.clock ?? (() => new Date());
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const read = <T>(work: () => Promise<T>, signal?: AbortSignal) => waitForTaskApplicationDependency(work, false, signal);

  const bound = async (original: z.infer<typeof originalRequestReferenceSchema>, signal?: AbortSignal,
    tx?: import('@prisma/client').Prisma.TransactionClient) => {
    const db = tx ?? d.db;
    const locator = structuredClone(await read(() => d.originals.readTaskLocator(structuredClone(original), tx), signal));
    if (locator.receipt.inputRef !== original.inputRef || locator.receipt.state === 'revoked'
      || locator.task.state !== 'observed' || locator.context.actor.kind !== 'user'
      || locator.context.audience !== 'operator' || locator.context.scope.kind !== 'workspace') throw denied();
    const canonical = locator.task, access = aiTaskAccessFromContext(locator.context, canonical.taskId, now());
    const task = structuredClone(await read(() => db.aiTask.findFirst({ where: access.where, select: {
      id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true, contractVersion: true,
      sceneCode: true, sceneVersion: true, revision: true, status: true, cancelRequestedAt: true, archivedAt: true,
      inputRef: true, inputRevision: true, inputHash: true, creationKey: true, creationFingerprint: true,
      scope: { select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } }
    } }), signal));
    if (!task || task.id !== canonical.taskId || task.scopeKind !== 'WORKSPACE' || task.audience !== access.audience
      || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId || task.archivedAt !== null
      || !task.scope || task.scope.id !== task.scopeId || task.scope.kind !== access.scope.kind
      || task.scope.scopeKey !== access.scope.scopeKey || task.scope.tenantId !== access.scope.tenantId
      || task.scope.workspaceId !== access.scope.workspaceId
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.inputRef !== original.inputRef
      || task.inputRevision !== locator.receipt.revision || task.inputHash !== locator.receipt.contentHash
      || task.sceneCode !== locator.receipt.sceneCode || task.sceneVersion !== locator.receipt.sceneVersion
      || task.creationKey !== `scene-request:${original.inputRef}` || !hash.safeParse(task.creationFingerprint).success
      || task.revision !== canonical.revision || task.status.toLowerCase() !== canonical.status) throw denied();
    const run = structuredClone(await read(() => db.aiRun.findFirst({ where: {
      scopeId: task.scopeId, taskId: task.id, id: canonical.runId }, select: {
      id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, sequence: true, revision: true,
      status: true, leaseOwnerId: true, leaseExpiresAt: true
    } }), signal));
    if (!run || run.id !== canonical.runId || run.scopeId !== task.scopeId || run.taskId !== task.id
      || run.actorKind !== task.ownerKind || run.actorId !== task.ownerId || run.sequence !== 1
      || !revision.safeParse(run.revision).success) throw denied();
    const fixed = taskReference.parse({ taskId: task.id, runId: run.id, scopeId: task.scopeId, ownerId: task.ownerId,
      sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, inputRevision: task.inputRevision, inputHash: task.inputHash,
      creationFingerprint: task.creationFingerprint, ownershipHash: requestFingerprint(access.ownershipBindingKey) });
    return { locator, access, task, run, fixed };
  };
  const recheck = async (before: Awaited<ReturnType<typeof bound>>, original: z.infer<typeof originalRequestReferenceSchema>,
    signal?: AbortSignal, mutable = false) => {
    const after = await bound(original, signal);
    if (!isDeepStrictEqual(before.fixed, after.fixed) || before.access.bindingKey !== after.access.bindingKey) throw denied();
    if (!mutable && (!isDeepStrictEqual(before.task, after.task) || !isDeepStrictEqual(before.run, after.run))) throw changed();
    return after;
  };
  const policies = async (task: Awaited<ReturnType<typeof bound>>['task'], selected: readonly AiTaskActionPolicyOperation[], signal?: AbortSignal,
    tx?: import('@prisma/client').Prisma.TransactionClient) => {
    const rows = structuredClone(await read(() => (tx ?? d.db).aiTaskActionPolicy.findMany({ where: {
      scopeId: task.scopeId, taskId: task.id, operation: { in: [...selected] } }, take: selected.length + 1,
      select: { scopeId: true, taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true }
    }), signal));
    if (rows.length > selected.length || new Set(rows.map(row => row.operation)).size !== rows.length) throw corrupt();
    return rows.map(row => {
      if (row.scopeId !== task.scopeId || row.taskId !== task.id || !selected.includes(row.operation as AiTaskActionPolicyOperation)
        || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw corrupt();
      const parsed = policyView.safeParse({ taskId: row.taskId, operation: row.operation, revision: row.revision,
        requiredPermissions: row.requiredPermissions, expiresAt: row.expiresAt.toISOString() });
      if (!parsed.success) throw corrupt();
      return parsed.data;
    });
  };
  const parseReference = (value: unknown) => {
    const parsed = referenceSchema.safeParse(structuredClone(value)); if (!parsed.success) throw invalid();
    const reference = parsed.data, { intentHash, ...locator } = reference, { contentHash, ...publication } = reference.publication;
    if (reference.intent === 'explicit_rule_preparation' ? reference.preparation?.kind !== 'business_rule'
      : reference.intent === 'explicit_calendar_preparation' ? reference.preparation?.kind !== 'business_calendar'
        : reference.preparation !== undefined) throw invalid();
    if (intentHash !== referenceHash(locator) || contentHash !== requestFingerprint({ version: 'task-plan-publication-1', ...publication })) throw invalid();
    return reference;
  };
  const minimumPermissions = (scene: Scene, reference: { preparation?: z.infer<typeof preparation> }): string[] =>
    reference.preparation?.kind === 'business_calendar' ? ['rental-os:calendar:edit']
      : reference.preparation ? ['rental-os:rules:manage'] : [sceneTools[scene].permission];
  const operationsFor = (publication: z.infer<typeof publicationView>, scene: string) => {
    const selected = [...initialOperations];
    if (publication.tools.some(tool => tool.code === 'ai.model.text') && scene === 'quote_clarification') selected.push('request_input', 'submit_input', 'resume_input');
    if (publication.tools.some(tool => ['rental.order.commit', 'tenant.notifications.commit'].includes(tool.code))) selected.push('decide_approval');
    return selected;
  };
  const verifySource = async (value: TaskExecutionAdmissionReference, purpose: 'issue' | 'observe',
    tx?: import('@prisma/client').Prisma.TransactionClient) => {
    const reference = parseReference(value), before = await bound(reference.original, undefined, tx);
    if (!isDeepStrictEqual(before.fixed, reference.task)) throw denied();
    if (purpose === 'observe') return before.locator.context;
    if (before.locator.material !== 'retained' || before.locator.receipt.state !== 'stored'
      || before.task.status !== 'QUEUED' || before.task.cancelRequestedAt !== null || before.run.status !== 'QUEUED'
      || before.run.leaseOwnerId !== null || before.run.leaseExpiresAt !== null
      || before.task.revision !== reference.state.taskRevision || before.run.revision !== reference.state.runRevision) throw changed();
    const policy = await (tx ?? d.db).aiTaskPlanPolicy.findFirst({ where: { scopeId: before.task.scopeId,
      sceneCode: before.task.sceneCode, sceneVersion: before.task.sceneVersion } });
    if (!policy || !policy.enabled || policy.expiresAt <= now()) throw unavailable();
    const tools = aiPersistedPlanToolsSchema.parse(structuredClone(policy.allowedTools));
    const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(policy.limits));
    const basis = { scopeId: policy.scopeId, sceneCode: policy.sceneCode, sceneVersion: policy.sceneVersion, revision: policy.revision,
      enabled: policy.enabled, expiresAt: policy.expiresAt.toISOString(), tools, limits };
    if (limits.maxStepMs > limits.maxTotalMs || !isDeepStrictEqual(reference.publication, { ...basis,
      contentHash: requestFingerprint({ version: 'task-plan-publication-1', ...basis }) })) throw changed();
    if (!Object.prototype.hasOwnProperty.call(sceneTools, before.task.sceneCode)) throw unavailable();
    const scene = before.task.sceneCode as Scene, supported = sceneTools[scene].tools as readonly string[];
    if (tools.some(tool => !supported.includes(tool.code)) || reference.preparation
      && (scene !== 'opening_diagnosis' || !tools.some(tool => tool.code === 'tenant.config.propose'))) throw unavailable();
    const selected = operationsFor(reference.publication, scene);
    if (!isDeepStrictEqual([...selected].sort(), reference.actions.map(action => action.operation).sort())) throw denied();
    const current = await policies(before.task, selected, undefined, tx), minimum = minimumPermissions(scene, reference);
    const held = 'access' in before.locator.context ? before.locator.context.access.permissions : [];
    for (const action of reference.actions) {
      const existing = current.find(policy => policy.operation === action.operation);
      const expected = [...new Set([...minimum, ...(existing?.requiredPermissions ?? [])])].sort();
      if (!isDeepStrictEqual(expected, [...action.requiredPermissions].sort()) || expected.some(permission => !held.includes(permission))) throw denied();
      if (action.mode === 'retain') {
        if (!existing || existing.revision !== action.expectedRevision || existing.expiresAt !== action.expiresAt
          || Date.parse(existing.expiresAt) <= now().getTime()) throw changed();
      } else if (Date.parse(action.expiresAt) <= now().getTime() || Date.parse(action.expiresAt) > Math.min(
        now().getTime() + maximumMs, Date.parse(reference.publication.expiresAt), Date.parse(before.locator.receipt.expiresAt))) throw unavailable();
    }
    return before.locator.context;
  };

  const application = Object.freeze({
    async prepare(value: unknown, signal?: AbortSignal) {
      const parsed = prepareSchema.safeParse(structuredClone(value)); if (!parsed.success) throw invalid();
      const command = parsed.data, before = await bound(command.original, signal), at = now().getTime();
      const missing: string[] = [];
      if (before.locator.material !== 'retained' || before.locator.receipt.state !== 'stored') missing.push('original_input_not_current');
      if (before.task.status !== 'QUEUED' || before.task.cancelRequestedAt !== null || before.run.status !== 'QUEUED'
        || before.run.leaseOwnerId !== null || before.run.leaseExpiresAt !== null) missing.push('original_run_requires_observation');
      const scene = Object.prototype.hasOwnProperty.call(sceneTools, before.task.sceneCode) ? sceneTools[before.task.sceneCode as Scene] : undefined;
      const key = { scopeId: before.task.scopeId, sceneCode: before.task.sceneCode, sceneVersion: before.task.sceneVersion };
      const policy = structuredClone(await read(() => d.db.aiTaskPlanPolicy.findFirst({ where: key, select: {
        scopeId: true, sceneCode: true, sceneVersion: true, revision: true, enabled: true, allowedTools: true, limits: true, expiresAt: true }
      }), signal));
      if (!scene) missing.push('scene_not_supported_by_start_host');
      if (!policy) missing.push('published_plan_policy_missing');
      let publication: z.infer<typeof publicationView> | null = null;
      if (policy) {
        if (Object.entries(key).some(([name, expected]) => policy[name as keyof typeof policy] !== expected)) throw denied();
        const tools = aiPersistedPlanToolsSchema.safeParse(structuredClone(policy.allowedTools));
        const limits = aiTaskRunnerLimitsSchema.safeParse(structuredClone(policy.limits));
        if (!revision.safeParse(policy.revision).success || typeof policy.enabled !== 'boolean' || !tools.success || !limits.success
          || limits.data.maxStepMs > limits.data.maxTotalMs || !(policy.expiresAt instanceof Date)
          || !Number.isFinite(policy.expiresAt.getTime())) missing.push('published_plan_policy_invalid');
        else {
          if (!policy.enabled) missing.push('published_plan_policy_disabled');
          if (policy.expiresAt.getTime() <= at) missing.push('published_plan_policy_expired');
          if (scene && tools.data.some(tool => !(scene.tools as readonly string[]).includes(tool.code))) missing.push('published_tools_not_supported_by_scene');
          const basis = { ...key, revision: policy.revision, enabled: policy.enabled,
            expiresAt: policy.expiresAt.toISOString(), tools: tools.data, limits: limits.data };
          publication = { ...basis, contentHash: requestFingerprint({ version: 'task-plan-publication-1', ...basis }) };
        }
      }
      const selected = [...initialOperations];
      if (publication?.tools.some(tool => tool.code === 'ai.model.text') && before.task.sceneCode === 'quote_clarification')
        selected.push('request_input', 'submit_input', 'resume_input');
      if (publication?.tools.some(tool => ['rental.order.commit', 'tenant.notifications.commit'].includes(tool.code))) selected.push('decide_approval');
      const current = await policies(before.task, selected, signal);
      const rolePermissions = 'access' in before.locator.context ? before.locator.context.access.permissions : [];
      const minimum: string[] = scene ? command.preparation?.kind === 'business_calendar' ? ['rental-os:calendar:edit']
        : command.preparation ? ['rental-os:rules:manage'] : [scene.permission] : [];
      if (command.preparation) {
        if (before.task.sceneCode !== 'opening_diagnosis' || !publication?.tools.some(tool => tool.code === 'tenant.config.propose'))
          missing.push(command.preparation.kind === 'business_calendar' ? 'calendar_preparation_tool_not_published' : 'rule_preparation_tool_not_published');
      }
      if (minimum.some(permission => !rolePermissions.includes(permission))) missing.push('current_business_permission_missing');
      const expiry = publication ? Math.min(at + maximumMs, Date.parse(publication.expiresAt), Date.parse(before.locator.receipt.expiresAt)) : at;
      const actions = selected.map(operation => {
        const existing = current.find(policy => policy.operation === operation) ?? null;
        const requiredPermissions = [...new Set([...minimum, ...(existing?.requiredPermissions ?? [])])];
        const active = !!existing && Date.parse(existing.expiresAt) > at && minimum.every(permission => existing.requiredPermissions.includes(permission))
          && existing.requiredPermissions.every(permission => rolePermissions.includes(permission));
        return { operation, expectedRevision: existing?.revision ?? null, requiredPermissions, current: existing, active };
      });
      if (actions.some(action => action.requiredPermissions.some(permission => !rolePermissions.includes(permission)))) missing.push('existing_stricter_permission_not_held');
      if (actions.some(action => !action.active && action.expectedRevision === 4294967294)) missing.push('original_policy_cas_exhausted');
      const locator = publication && minimum.length && expiry > at ? {
        version: 'task-execution-admission-2', intent: command.intent, ...(command.preparation ? { preparation: command.preparation } : {}),
        original: command.original, task: before.fixed, publication,
        state: { taskRevision: before.task.revision, runRevision: before.run.revision },
        actions: actions.map(({ operation, expectedRevision, requiredPermissions, active, current }) => ({ operation,
          mode: active ? 'retain' as const : 'configure' as const, expectedRevision, requiredPermissions,
          expiresAt: active ? current!.expiresAt : new Date(expiry).toISOString() })) } as const : null;
      const reference = locator ? referenceSchema.parse({ ...locator, intentHash: referenceHash(locator) }) : null;
      const afterPolicy = structuredClone(await read(() => d.db.aiTaskPlanPolicy.findFirst({ where: key, select: {
        scopeId: true, sceneCode: true, sceneVersion: true, revision: true, enabled: true, allowedTools: true, limits: true, expiresAt: true }
      }), signal));
      if (!isDeepStrictEqual(policy, afterPolicy) || !isDeepStrictEqual(current, await policies(before.task, selected, signal))) throw changed();
      await recheck(before, command.original, signal);
      const deliveredAt = now().getTime();
      if (publication && Date.parse(publication.expiresAt) <= deliveredAt) missing.push('published_plan_policy_expired');
      if (reference && expiry <= deliveredAt) missing.push('prepared_admission_window_expired');
      for (const action of actions) if (action.current && Date.parse(action.current.expiresAt) <= deliveredAt) action.active = false;
      const needsIssuance = actions.some(action => !action.active);
      return { phase: missing.length ? 'blocked' as const : 'prepared' as const, original: command.original,
        task: { ...before.fixed, taskRevision: before.task.revision, runRevision: before.run.revision }, publication, actions, reference,
        missing: [...new Set(missing)], admission: missing.length ? 'not_granted' as const : needsIssuance
          ? 'requires_publication_bound_policy_participant' as const : 'existing_policies_available' as const,
        requiredParticipant: needsIssuance ? 'current_publication_and_owner_authority_in_original_policy_cas_transaction' as const : null,
        participantMissing: needsIssuance && !signing ? ['published_plan_policy_mutation_authority', 'same_transaction_policy_cas'] : [],
        signing: 'not_issued' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const,
        consistency: 'revalidated_reads_not_atomic_snapshot' as const, automaticRetry: false as const };
    },
    async readReceipt(value: unknown, signal?: AbortSignal): Promise<TaskExecutionAdmissionReceiptView> {
      const reference = parseReference(value);
      const before = await bound(reference.original, signal);
      if (!isDeepStrictEqual(before.fixed, reference.task) || reference.publication.scopeId !== before.task.scopeId
        || reference.publication.sceneCode !== before.task.sceneCode || reference.publication.sceneVersion !== before.task.sceneVersion) throw denied();
      const participant = signing ? new TaskExecutionAdmissionAuthority(signing, reference, 'observe', verifySource).reader() : d.receipts;
      if (!participant) {
        await recheck(before, reference.original, signal, true);
        return { phase: 'receipt_participant_unavailable' as const, original: reference.original, taskId: before.task.id,
          missing: ['current_owner_original_policy_cas_receipt_reader'] as const, execution: 'not_started' as const, automaticRetry: false as const };
      }
      const entries: TaskExecutionAdmissionPolicyReceipt[] = [];
      for (const expected of reference.actions) {
        if (expected.mode === 'retain') {
          if (!participant.read) throw unavailable();
          const current = await read(() => participant.read!(before.task.id, expected.operation), signal);
          const policy = current.state === 'observed' ? policyView.parse(current.policy) : null;
          entries.push({ operation: expected.operation, expectedRevision: expected.expectedRevision, state: 'retained_policy' as const, policy,
            matchesPreparedContent: !!policy && policy.revision === expected.expectedRevision && policy.expiresAt === expected.expiresAt
              && isDeepStrictEqual([...policy.requiredPermissions].sort(), [...expected.requiredPermissions].sort()) });
          continue;
        }
        const observed = structuredClone(await read(() => participant.readMutation(before.task.id, expected.operation,
          expected.expectedRevision, 'configure'), signal));
        if (!observed || !['recorded', 'not_observed'].includes(observed.state) || observed.retryable !== false) throw corrupt();
        if (observed.state === 'recorded') {
          const policy = policyView.safeParse(observed.policy);
          if (!policy.success || policy.data.taskId !== before.task.id || policy.data.operation !== expected.operation
            || policy.data.revision !== (expected.expectedRevision ?? 0) + 1) throw corrupt();
          entries.push({ operation: expected.operation, expectedRevision: expected.expectedRevision, state: 'recorded' as const, policy: policy.data,
            matchesPreparedContent: isDeepStrictEqual([...policy.data.requiredPermissions].sort(), [...expected.requiredPermissions].sort())
              && policy.data.expiresAt === expected.expiresAt });
        } else entries.push({ operation: expected.operation, expectedRevision: expected.expectedRevision, state: 'not_observed' as const, policy: null,
          matchesPreparedContent: false });
      }
      await recheck(before, reference.original, signal, true);
      return { phase: 'policy_cas_receipts' as const, original: reference.original, taskId: before.task.id, runId: before.run.id, entries,
        completeRecorded: entries.every(entry => ['recorded', 'retained_policy'].includes(entry.state) && entry.matchesPreparedContent),
        // The legacy policy receipt records its CAS/content, not this publication
        // or a start intent. It cannot substitute for the missing issue participant.
        publicationBinding: 'not_attested_by_legacy_policy_receipt' as const, admission: 'not_granted' as const,
        execution: 'not_started' as const, businessApproval: 'not_granted' as const, automaticRetry: false as const,
        absenceSemantics: 'not_observed_is_not_proof_of_no_write' as const,
        consistency: 'revalidated_reads_not_atomic_snapshot' as const };
    },
    async issue(value: unknown, signal?: AbortSignal): Promise<TaskExecutionAdmissionIssueResult> {
      if (!signing) throw unavailable();
      const input = z.object({ reference: referenceSchema, intent }).strict().safeParse(structuredClone(value));
      if (!input.success || input.data.intent !== input.data.reference.intent) throw invalid();
      const reference = parseReference(input.data.reference);
      if (signal?.aborted) return { phase: 'not_issued' as const, reference, execution: 'not_started' as const };
      const original = await application.readReceipt(reference, signal);
      if (original.phase === 'policy_cas_receipts' && original.completeRecorded) return { phase: 'original_receipts' as const,
        reference, receipt: original, signing: 'already_recorded_or_retained' as const, admission: 'not_granted_by_replay' as const,
        execution: 'not_started' as const, businessApproval: 'not_granted' as const, automaticRetry: false as const };
      const issuer = new TaskExecutionAdmissionAuthority(signing, reference, 'issue', verifySource);
      await read(() => issuer.assertCurrent(), signal);
      // Install cleanup/recovery/continuation policies first. A concurrent normal
      // start cannot claim this new run until the last claim_run CAS is present.
      const ordered = reference.actions.filter(action => action.mode === 'configure').sort((a, b) =>
        Number(a.operation === 'claim_run') - Number(b.operation === 'claim_run'));
      let attempted = false;
      try {
        for (const action of ordered) {
          if (signal?.aborted) throw unavailable();
          const observer = new TaskExecutionAdmissionAuthority(signing, reference, 'observe', verifySource).reader();
          const observed = await read(() => observer.readMutation(reference.task.taskId, action.operation, action.expectedRevision, 'configure'), signal);
          if (observed.state === 'recorded') {
            if (observed.policy.expiresAt !== action.expiresAt || !isDeepStrictEqual([...observed.policy.requiredPermissions].sort(),
              [...action.requiredPermissions].sort())) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            continue;
          }
          attempted = true;
          await waitForTaskApplicationDependency(() => issuer.writer(action).put({ taskId: reference.task.taskId,
            operation: action.operation, requiredPermissions: action.requiredPermissions, expiresAt: new Date(action.expiresAt) },
          action.expectedRevision, true), true, signal);
        }
        const receipt = await application.readReceipt(reference, undefined);
        await read(() => issuer.assertCurrent());
        if (receipt.phase !== 'policy_cas_receipts' || !receipt.completeRecorded) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { phase: 'policy_admission_recorded' as const, reference, receipt, signing: 'recorded' as const,
          admission: 'current_publication_and_role_revalidated' as const, execution: 'not_started' as const,
          businessApproval: 'not_granted' as const, automaticRetry: false as const };
      } catch (error) {
        if (!attempted) throw error;
        // Never update expectedRevision or invent another key after a possible
        // write. Current policy is not a substitute for these original receipts.
        const receipt = await application.readReceipt(reference, undefined);
        return { phase: 'issuance_requires_original_receipt' as const, reference, receipt, signing: 'unknown' as const,
          admission: 'not_granted' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const,
          automaticRetry: false as const };
      }
    }
  });
  return application;
}
