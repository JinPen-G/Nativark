/** Explicit initial policies for a Core-prepared notification change and its
 * original creation receipt. Only an untouched QUEUED Task/first Run qualifies.
 * No creation/read call signs; existing waits and unknown work cannot restart. */
import { hasEffectivePermission } from '../../../common/permission-match';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import { ApprovedSettingsRouteAuthority } from '../../rental-core/approved-settings-route.authority';
import { ApprovedSettingsChangeService } from '../../rental-core/approved-settings-change.service';
import { settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import type { AiTaskActionPolicyOperation, AiTaskActionPolicyMutationResult } from '../prisma-task-action-policy.repository';
import { ApprovedSettingsTaskAuthority, settingsTransactionDb, type ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { PrismaApprovedSettingsParticipant } from './prisma-approved-settings.participant';
import { composeApprovedSettingsApplication } from './approved-settings-application.composition';
import { SettingsStartAdmissionAuthority } from './settings-start-admission.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294), time = z.string().datetime({ offset: true });
const originalSchema = z.object({ creationKey: id.max(128), changeKey: id.max(128) }).strict();
const intent = z.literal('explicit_settings_start');
// Match the original settings lifecycle templates; expose claim_run last so a
// partial acknowledgement never becomes a complete initial start admission.
const initialOperations = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_recovery_run',
  'release_run', 'transition_task', 'decide_approval', 'claim_run'] as const satisfies readonly AiTaskActionPolicyOperation[];
const operation = z.enum(initialOperations), permissions = z.array(id).min(1).max(64).refine(value => new Set(value).size === value.length);
const action = z.object({ operation, mode: z.enum(['retain', 'configure']), expectedRevision: revision.nullable(), requiredPermissions: permissions, expiresAt: time }).strict();
const targetSchema = z.object({ taskId: shortId, runId: shortId, scopeId: shortId, tenantId: id, workspaceId: id, ownerId: id,
  audience: z.enum(['operator', 'staff']), sceneCode: id.max(128), sceneVersion: id.max(64), creationFingerprint: hash,
  change: settingsChangeReferenceSchema, inputRevision: z.literal(1), baseRevision: revision, baseSettingsHash: hash,
  categoryVersionId: id, categoryAdoptionRevision: revision, expiresAt: time }).strict();
const referenceSchema = z.object({ version: z.literal('settings-start-admission-1'), intent, original: originalSchema,
  target: targetSchema, stageHash: hash, publicationHash: hash, actions: z.array(action).length(8), intentHash: hash }).strict();
export type SettingsStartAdmissionReference = z.infer<typeof referenceSchema>;
export interface SettingsStartAdmissionDependencies extends ApprovedSettingsApplicationDependencies {
  currentRuntimeEnabled(sceneCode: string, sceneVersion: string): Promise<boolean>;
  maximumAdmissionMs?: number;
}
export interface SettingsStartAdmissionReceipt {
  phase: 'original_settings_start_policy_receipts'; reference: SettingsStartAdmissionReference;
  entries: { operation: AiTaskActionPolicyOperation; state: 'recorded' | 'not_observed' | 'retained_policy';
    policy: AiTaskActionPolicyMutationResult | null; matchesPreparedContent: boolean }[];
  completeRecorded: boolean; admission: 'not_granted_by_receipt'; execution: 'not_started'; businessApproval: 'not_granted';
  automaticRetry: false; creationBinding: 'not_attested_by_legacy_policy_receipt';
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED'), unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const snapshotHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, entry) => typeof entry === 'bigint' ? { nativeBigInt: entry.toString() } : entry)));
const minimumPermission = (held: readonly string[], existing: readonly string[] = []) => existing.includes('rental-os:price:manage') ? 'rental-os:price:manage'
  : existing.includes('rental-os:rules:manage') ? 'rental-os:rules:manage' : hasEffectivePermission(held, 'rental-os:price:manage') ? 'rental-os:price:manage'
    : hasEffectivePermission(held, 'rental-os:rules:manage') ? 'rental-os:rules:manage' : undefined;

export function composeSettingsStartAdmission(d: SettingsStartAdmissionDependencies) {
  if (typeof d.db?.$transaction !== 'function' || typeof d.auth?.resolveAccessContext !== 'function' || typeof d.guard?.canActivate !== 'function'
    || typeof d.credentials?.current !== 'function' || typeof d.core?.readVersionedBusinessSettings !== 'function'
    || typeof d.currentRuntimeEnabled !== 'function') throw unavailable();
  const clock = d.clock ?? (() => new Date()), maximumMs = d.maximumAdmissionMs ?? 120000;
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 120000) throw unavailable();
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const read = <T>(work: () => Promise<T>, signal?: AbortSignal) => waitForTaskApplicationDependency(work, false, signal);
  const parseReference = (value: unknown) => {
    const parsed = referenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = parsed.data, { intentHash, ...body } = reference;
    if (requestFingerprint(body) !== intentHash || !isDeepStrictEqual([...initialOperations].sort(), reference.actions.map(row => row.operation).sort())) throw denied();
    return reference;
  };
  const bound = async (original: z.infer<typeof originalSchema>, tx?: Prisma.TransactionClient, signal?: AbortSignal) => {
    const db = tx ? settingsTransactionDb(d.db, tx) : d.db;
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock), clock);
    const first = await read(() => scopes.resolveCurrent(), signal), identity = originalIdentityHash(first.context);
    const settings = composeApprovedSettingsApplication({ ...d, db });
    const authorize = async () => {
      if (signal?.aborted) throw denied();
      const current = await scopes.resolveCurrent(), context = current.context;
      if (current.scope.id !== first.scope.id || originalIdentityHash(context) !== identity || context.actor.kind !== 'user'
        || context.scope.kind !== 'workspace' || (context.audience !== 'operator' && context.audience !== 'staff') || !('access' in context)) throw denied();
      const actor = { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId: context.actor.userId };
      await new ApprovedSettingsRouteAuthority(d.guard, d.credentials).withAuthorization('read', async (guarded, revalidate) => {
        const request = getRequestIdentity();
        if (!isDeepStrictEqual(actor, guarded) || !request || request.isSaasAdmin || request.staffApi !== (context.audience === 'staff')
          || !isDeepStrictEqual(request.dataScope, context.access.dataScope) || !isDeepStrictEqual(request.locationScope, context.access.locationScope)
          || (request.organizationId ?? undefined) !== (context.access.organizationId ?? undefined)) throw denied();
        await revalidate();
      });
      // The original historical receipt, not a fabricated scene input, owns
      // the immutable change id/hash and its actual preparation deadline.
      const receipt = await settings.readChangeReceipt({ changeKey: original.changeKey });
      if (receipt.state !== 'prepared_not_approved') throw unavailable();
      const change = await db.rentalApprovedSettingsChange.findUnique({ where: { id: receipt.change.changeId } });
      if (!change || change.tenantId !== actor.tenantId || change.workspaceId !== actor.workspaceId || change.actorId !== actor.actorId
        || change.changeKey !== original.changeKey || change.changeHash !== receipt.change.changeHash) throw denied();
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== current.scope.id || originalIdentityHash(after.context) !== identity || signal?.aborted) throw denied();
      return { context, actor, scopeId: current.scope.id, change, receipt };
    };
    const before = await read(authorize, signal);
    const creation = AiTaskCreationRepository.receiptReader(db, { resolve: async (sceneCode, inputRef) => {
      const current = await authorize();
      if (sceneCode !== d.scene.code || inputRef !== current.change.id || current.change.id !== before.change.id
        || current.change.changeHash !== before.change.changeHash) throw denied();
      return { context: current.context, sceneCode: d.scene.code, sceneVersion: d.scene.version,
        inputRef: current.change.id, inputRevision: 1, inputHash: current.change.changeHash };
    } }, clock);
    const created = await read(() => creation.readCreation({ creationKey: original.creationKey, sceneCode: d.scene.code, inputRef: before.change.id }), signal);
    if (created.state !== 'observed' || !created.task) throw unavailable();
    const access = aiTaskAccessFromContext(before.context, created.task.taskId, now());
    const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: before.scopeId }] }, include: { scope: true } });
    const run = await db.aiRun.findFirst({ where: { scopeId: before.scopeId, taskId: created.task.taskId, id: created.task.runId } });
    if (!task || task.id !== created.task.taskId || task.scopeId !== before.scopeId || task.scopeKind !== 'WORKSPACE'
      || task.ownerKind !== 'USER' || task.ownerId !== before.actor.actorId || task.audience !== before.context.audience.toUpperCase()
      || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.creationKey !== original.creationKey
      || !hash.safeParse(task.creationFingerprint).success || task.sceneCode !== d.scene.code || task.sceneVersion !== d.scene.version
      || task.inputRef !== before.change.id || task.inputRevision !== 1 || task.inputHash !== before.change.changeHash
      || !run || run.id !== created.task.runId || run.scopeId !== before.scopeId || run.taskId !== task.id
      || run.actorKind !== 'USER' || run.actorId !== before.actor.actorId || run.sequence !== 1) throw denied();
    const after = await authorize();
    if (originalIdentityHash(after.context) !== identity || snapshotHash(after.change) !== snapshotHash(before.change)) throw conflict();
    return { ...before, db, task, run, created, access, authorize };
  };
  const stage = async (original: z.infer<typeof originalSchema>, tx?: Prisma.TransactionClient, signal?: AbortSignal) => {
    const source = await bound(original, tx, signal), { db, task, run, change, actor } = source;
    if (task.status !== 'QUEUED' || task.revision !== 1 || task.cancelRequestedAt !== null || task.resultRef !== null
      || task.eventCursor !== 0n || run.status !== 'QUEUED' || run.revision !== 1 || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
      || run.inputReceiptId !== null || !run.fencingToken.equals(0) || source.created.task!.status !== 'queued' || source.created.task!.revision !== 1) throw unavailable();
    const runs = await db.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 2 });
    if (runs.length !== 1 || runs[0].id !== run.id) throw unavailable();
    if (await db.aiTaskRunPlan.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiTaskResultArtifact.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiTaskExecutionPhaseStart.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiTaskExecutionPhaseReceipt.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiTaskRunPreparation.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiProposal.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiProposalVersion.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiApproval.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.aiApprovalConsumption.findFirst({ where: { scopeId: task.scopeId, taskId: task.id } })
      || await db.rentalApprovedSettingsOperation.findFirst({ where: { tenantId: actor.tenantId, workspaceId: actor.workspaceId, changeId: change.id } })) throw unavailable();
    await new ApprovedSettingsRouteAuthority(d.guard, d.credentials).withAuthorization('write', async (current, revalidate) => {
      if (!isDeepStrictEqual(current, actor)) throw denied();
      await revalidate();
    });
    const participant = new PrismaApprovedSettingsParticipant(new ApprovedSettingsTaskAuthority({ ...d, db }));
    const domain = new ApprovedSettingsChangeService(db, d.core, new ApprovedSettingsRouteAuthority(d.guard, d.credentials), participant, clock);
    const current = await domain.readAuthorizedChange({ changeId: change.id, changeHash: change.changeHash });
    if (!(change.expiresAt instanceof Date) || change.expiresAt <= now() || current.changeId !== change.id || current.changeHash !== change.changeHash
      || current.baseRevision !== change.baseRevision || current.expiresAt !== change.expiresAt.toISOString()) throw conflict();
    const target = targetSchema.parse({ taskId: task.id, runId: run.id, scopeId: task.scopeId, tenantId: actor.tenantId,
      workspaceId: actor.workspaceId, ownerId: actor.actorId, audience: source.context.audience, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion,
      creationFingerprint: task.creationFingerprint, change: { changeId: change.id, changeHash: change.changeHash }, inputRevision: 1,
      baseRevision: change.baseRevision, baseSettingsHash: change.baseSettingsHash, categoryVersionId: change.categoryVersionId,
      categoryAdoptionRevision: change.categoryAdoptionRevision, expiresAt: change.expiresAt.toISOString() });
    await source.authorize();
    return { target, context: source.context, stageHash: snapshotHash({ identity: originalIdentityHash(source.context), task, run, change, created: source.created, current }) };
  };
  const publication = async (target: SettingsStartAdmissionReference['target'], tx?: Prisma.TransactionClient) => {
    if (await d.currentRuntimeEnabled(target.sceneCode, target.sceneVersion) !== true) throw unavailable();
    const key = { scopeId: target.scopeId, sceneCode: target.sceneCode, sceneVersion: target.sceneVersion }, row = await (tx ?? d.db).aiTaskPlanPolicy.findFirst({ where: key });
    if (!row || Object.entries(key).some(([field, value]) => row[field as keyof typeof row] !== value) || row.enabled !== true
      || !revision.safeParse(row.revision).success || !(row.expiresAt instanceof Date) || row.expiresAt <= now()) throw unavailable();
    const tools = aiPersistedPlanToolsSchema.parse(structuredClone(row.allowedTools)), limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (!tools.some(tool => tool.code === AI_APPROVED_SETTINGS_TOOL_CODE && tool.version === AI_TOOL_DRAFT_VERSION)
      || tools.some(tool => !['ai.model.text', 'tenant.opening.diagnose', 'tenant.config.propose', AI_APPROVED_SETTINGS_TOOL_CODE].includes(tool.code))
      || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    return { hash: snapshotHash({ ...row, allowedTools: tools, limits }), expiresAt: row.expiresAt.getTime() };
  };
  const policies = async (reference: SettingsStartAdmissionReference, tx?: Prisma.TransactionClient) => {
    const rows = await (tx ?? d.db).aiTaskActionPolicy.findMany({ where: { scopeId: reference.target.scopeId, taskId: reference.target.taskId,
      operation: { in: [...initialOperations] } }, take: 9 });
    if (rows.length > 8 || new Set(rows.map(row => row.operation)).size !== rows.length) throw unavailable();
    for (const row of rows) if (row.scopeId !== reference.target.scopeId || row.taskId !== reference.target.taskId || !revision.safeParse(row.revision).success
      || !permissions.safeParse(row.requiredPermissions).success || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
    return rows;
  };
  const verify = async (value: SettingsStartAdmissionReference, purpose: 'issue' | 'observe', tx?: Prisma.TransactionClient) => {
    const reference = parseReference(value), source = await bound(reference.original, tx), target = reference.target;
    if (source.task.id !== target.taskId || source.run.id !== target.runId || source.task.scopeId !== target.scopeId
      || source.actor.actorId !== target.ownerId || source.actor.tenantId !== target.tenantId || source.actor.workspaceId !== target.workspaceId
      || source.context.audience !== target.audience || source.task.creationFingerprint !== target.creationFingerprint
      || source.change.id !== target.change.changeId || source.change.changeHash !== target.change.changeHash) throw denied();
    if (purpose === 'observe') return source.context;
    const state = await stage(reference.original, tx), published = await publication(target, tx);
    if (!isDeepStrictEqual(state.target, target) || state.stageHash !== reference.stageHash || published.hash !== reference.publicationHash) throw conflict();
    const held = state.context.access.permissions, rows = await policies(reference, tx), cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, Date.parse(target.expiresAt));
    if (!minimumPermission(held)) throw denied();
    for (const action of reference.actions) {
      const row = rows.find(value => value.operation === action.operation), minimum = minimumPermission(held, row ? row.requiredPermissions as string[] : []);
      if (!minimum || !action.requiredPermissions.includes(minimum) || action.requiredPermissions.some(value => !hasEffectivePermission(held, value))
        || Date.parse(action.expiresAt) <= now().getTime() || action.mode === 'configure' && Date.parse(action.expiresAt) > cutoff) throw denied();
      if (action.mode === 'retain') {
        if (!row || row.revision !== action.expectedRevision || row.expiresAt.toISOString() !== action.expiresAt
          || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
      } else if ((row?.revision ?? null) === action.expectedRevision) {
        if (!isDeepStrictEqual([...new Set([minimum, ...(row ? row.requiredPermissions as string[] : [])])].sort(), [...action.requiredPermissions].sort())) throw denied();
      } else if (!row || row.revision !== (action.expectedRevision ?? 0) + 1 || row.expiresAt.toISOString() !== action.expiresAt
        || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
    }
    return state.context;
  };
  const readReceipt = async (value: unknown, signal?: AbortSignal): Promise<SettingsStartAdmissionReceipt> => {
    const parsed = z.object({ reference: referenceSchema }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = parseReference(parsed.data.reference), reader = new SettingsStartAdmissionAuthority(d, reference, 'observe', verify).reader();
    const entries: SettingsStartAdmissionReceipt['entries'] = [];
    for (const row of reference.actions) {
      if (row.mode === 'retain') {
        const observed = await read(() => reader.read(reference.target.taskId, row.operation), signal), policy = observed.state === 'observed' ? observed.policy : null;
        entries.push({ operation: row.operation, state: policy ? 'retained_policy' : 'not_observed', policy,
          matchesPreparedContent: !!policy && policy.revision === row.expectedRevision && policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      } else {
        const observed = await read(() => reader.readMutation(reference.target.taskId, row.operation, row.expectedRevision), signal);
        entries.push({ operation: row.operation, state: observed.state, policy: observed.policy,
          matchesPreparedContent: !!observed.policy && observed.policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...observed.policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      }
    }
    return { phase: 'original_settings_start_policy_receipts', reference, entries, completeRecorded: entries.every(row => row.state !== 'not_observed' && row.matchesPreparedContent),
      admission: 'not_granted_by_receipt', execution: 'not_started', businessApproval: 'not_granted', automaticRetry: false,
      creationBinding: 'not_attested_by_legacy_policy_receipt' };
  };
  return Object.freeze({
    async prepare(value: unknown, signal?: AbortSignal) {
      const parsed = z.object({ original: originalSchema, intent }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const state = await stage(parsed.data.original, undefined, signal), published = await publication(state.target), held = state.context.access.permissions;
      if (!minimumPermission(held)) throw denied();
      const cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, Date.parse(state.target.expiresAt));
      if (cutoff <= now().getTime()) throw unavailable();
      const actions: SettingsStartAdmissionReference['actions'] = [];
      for (const selected of initialOperations) {
        const row = await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: { scopeId: state.target.scopeId, taskId: state.target.taskId, operation: selected } } });
        if (row && (row.scopeId !== state.target.scopeId || row.taskId !== state.target.taskId || row.operation !== selected || !revision.safeParse(row.revision).success
          || !permissions.safeParse(row.requiredPermissions).success || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()))) throw unavailable();
        const minimum = minimumPermission(held, row ? row.requiredPermissions as string[] : []);
        if (!minimum) throw denied();
        const requiredPermissions = [...new Set([minimum, ...(row ? row.requiredPermissions as string[] : [])])];
        if (requiredPermissions.some(value => !hasEffectivePermission(held, value))) throw denied();
        const retain = !!row && row.expiresAt > now() && requiredPermissions.every(value => (row.requiredPermissions as string[]).includes(value));
        actions.push(action.parse({ operation: selected, mode: retain ? 'retain' : 'configure', expectedRevision: row?.revision ?? null,
          requiredPermissions, expiresAt: retain ? row!.expiresAt.toISOString() : new Date(cutoff).toISOString() }));
      }
      const body = { version: 'settings-start-admission-1' as const, intent: parsed.data.intent, original: parsed.data.original,
        target: state.target, stageHash: state.stageHash, publicationHash: published.hash, actions };
      const reference = parseReference({ ...body, intentHash: requestFingerprint(body) });
      await read(() => verify(reference, 'issue'), signal);
      return { phase: 'prepared' as const, reference, admission: actions.every(row => row.mode === 'retain') ? 'existing_policies_available' as const
        : 'explicit_settings_start_policy_issuance_required' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const };
    },
    async issue(value: unknown, signal?: AbortSignal) {
      const parsed = z.object({ reference: referenceSchema, intent }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reference = parseReference(parsed.data.reference);
      if (reference.intent !== parsed.data.intent) throw denied();
      const previous = await readReceipt({ reference }, signal);
      if (previous.entries.some(row => row.state === 'recorded')) return { phase: 'original_receipts' as const, reference, receipt: previous,
        admission: 'not_granted_by_replay' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const };
      await read(() => verify(reference, 'issue'), signal);
      let active = !signal?.aborted, attempted = false;
      const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
      const verifier: typeof verify = async (...args) => { if (!active) throw denied(); const context = await verify(...args); if (!active) throw denied(); return context; };
      const authority = new SettingsStartAdmissionAuthority(d, reference, 'issue', verifier);
      try {
        for (const row of reference.actions) {
          if (row.mode === 'retain') continue;
          attempted = true;
          await waitForTaskApplicationDependency(() => authority.writer(row).put({ taskId: reference.target.taskId, operation: row.operation,
            requiredPermissions: row.requiredPermissions, expiresAt: new Date(row.expiresAt) }, row.expectedRevision, true), true, signal);
        }
        await read(() => verify(reference, 'issue'), signal);
        const receipt = await readReceipt({ reference }, signal);
        if (!receipt.completeRecorded) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { phase: 'settings_initial_policy_admission_recorded' as const, reference, receipt,
          admission: 'current_creation_change_category_publication_and_role_revalidated' as const,
          execution: 'not_started' as const, businessApproval: 'not_granted' as const };
      } catch (error) { if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); throw error; }
      finally { active = false; signal?.removeEventListener('abort', close); }
    }, readReceipt
  });
}
