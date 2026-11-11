/** Explicit short policies for the original notification approval wait.
 * The original change/proposal, current category/settings checks and approved
 * transaction remain authoritative. Reads never sign, claim or revive a wait. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION,
  AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE, type AiApprovedSettingsReferenceDraft } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import { ApprovedSettingsRouteAuthority } from '../../rental-core/approved-settings-route.authority';
import { ApprovedSettingsChangeService } from '../../rental-core/approved-settings-change.service';
import { settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiTaskRepository, aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { aiStepActionId } from '../ai-step-registration.repository';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';
import { waitingPayloadSchema } from '../runner/prisma-task-confirmation-checkpoint.source';
import { PrismaTaskApplication, waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import type { AiTaskRunnerClock } from '../runner/ai-task-runner.ports';
import type { AiTaskActionPolicyOperation, AiTaskActionPolicyMutationResult } from '../prisma-task-action-policy.repository';
import { ApprovedSettingsTaskAuthority, settingsTransactionDb, type ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { PrismaApprovedSettingsParticipant } from './prisma-approved-settings.participant';
import { settingsContract, registeredSettingsTool } from './approved-settings-contracts';
import { SettingsApprovalAdmissionAuthority } from './settings-approval-admission.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294);
const time = z.string().datetime({ offset: true }), intent = z.enum(['explicit_decide', 'explicit_continue']), decision = z.enum(['approve', 'reject']);
const settingsReference = z.custom<AiApprovedSettingsReferenceDraft>(value => {
  try { settingsContract('AiApprovedSettingsReferenceDraft', value); return true; } catch { return false; }
});
const targetQuery = z.object({ taskId: shortId, runId: shortId.optional(), stepId: shortId.optional(), proposal: settingsReference.optional() }).strict();
const targetSchema = z.object({ taskId: shortId, runId: shortId, stepId: shortId, scopeId: shortId, tenantId: id, workspaceId: id,
  ownerId: id, audience: z.enum(['operator', 'staff']), sceneCode: id.max(64), sceneVersion: id.max(64),
  proposal: settingsReference, change: settingsChangeReferenceSchema, baseRevision: revision, baseSettingsHash: hash,
  categoryVersionId: id, categoryAdoptionRevision: revision, registrationRef: id, inputId: shortId, inputHash: hash,
  inputPolicyRevision: revision, actionId: id, planHash: hash, checkpointRef: shortId, expiresAt: time }).strict();
const decideOperations = ['read_metadata', 'read_step_terminal', 'decide_approval'] as const;
const continueOperations = ['read_metadata', 'read_step_terminal', 'claim_recovery_run', 'release_run', 'transition_task'] as const;
const operations = [...new Set([...decideOperations, ...continueOperations])] as AiTaskActionPolicyOperation[];
const operation = z.custom<AiTaskActionPolicyOperation>(value => typeof value === 'string' && operations.includes(value as AiTaskActionPolicyOperation));
const permissions = z.array(id).min(1).max(64).refine(value => new Set(value).size === value.length);
const action = z.object({ operation, mode: z.enum(['retain', 'configure']), expectedRevision: revision.nullable(), requiredPermissions: permissions, expiresAt: time }).strict();
const referenceSchema = z.object({ version: z.literal('settings-approval-admission-1'), intent, decision,
  target: targetSchema, stageHash: hash, publicationHash: hash, actions: z.array(action).min(1).max(5), intentHash: hash }).strict();
export type SettingsApprovalAdmissionReference = z.infer<typeof referenceSchema>;
export type SettingsApprovalAdmissionIntent = z.infer<typeof intent>;
export interface SettingsApprovalAdmissionDependencies extends ApprovedSettingsApplicationDependencies {
  /** Actual current settings execution switch from the original factory. */
  currentRuntimeEnabled(sceneCode: string, sceneVersion: string): Promise<boolean>;
  maximumAdmissionMs?: number;
  runnerClock?: AiTaskRunnerClock;
}
export interface SettingsApprovalAdmissionReceipt {
  phase: 'original_settings_policy_receipts'; reference: SettingsApprovalAdmissionReference;
  entries: { operation: AiTaskActionPolicyOperation; state: 'recorded' | 'not_observed' | 'retained_policy';
    policy: AiTaskActionPolicyMutationResult | null; matchesPreparedContent: boolean }[];
  completeRecorded: boolean; admission: 'not_granted_by_receipt'; execution: 'not_started'; businessApproval: 'not_granted';
  automaticRetry: false; waitingBinding: 'not_attested_by_legacy_policy_receipt';
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED'), unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const selectedOperations = (value: SettingsApprovalAdmissionIntent): readonly AiTaskActionPolicyOperation[] => value === 'explicit_decide' ? decideOperations : continueOperations;
const snapshotHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, entry) => typeof entry === 'bigint' ? { nativeBigInt: entry.toString() } : entry)));
type SettingsGrant = Awaited<ReturnType<ApprovedSettingsTaskAuthority['resolve']>>;
// Reuse the original participant's complete change/proposal projection through
// a genuine current resource reader. The old policy's expiry cannot be a
// prerequisite for preparing its renewal; this reader rejects every write mode.
class OriginalSettingsWaitReadAuthority extends ApprovedSettingsTaskAuthority {
  constructor(d: ApprovedSettingsApplicationDependencies, private readonly current: (taskId: string, tx?: Prisma.TransactionClient) => Promise<SettingsGrant>) { super(d); }
  override async resolve(taskId: string, mode: 'read' | 'prepare' | 'decide' | 'execute', tx?: Prisma.TransactionClient) {
    if (mode !== 'read') throw denied();
    return this.current(taskId, tx);
  }
}

export function composeSettingsApprovalAdmission(d: SettingsApprovalAdmissionDependencies) {
  if (typeof d.db?.$transaction !== 'function' || typeof d.auth?.resolveAccessContext !== 'function'
    || typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function'
    || typeof d.core?.readVersionedBusinessSettings !== 'function' || typeof d.currentRuntimeEnabled !== 'function') throw unavailable();
  registeredSettingsTool();
  const clock = d.clock ?? (() => new Date()), maximumMs = d.maximumAdmissionMs ?? 120000;
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 120000) throw unavailable();
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const read = <T>(work: () => Promise<T>, signal?: AbortSignal) => waitForTaskApplicationDependency(work, false, signal);
  const parseReference = (value: unknown) => {
    const parsed = referenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = parsed.data, { intentHash, ...body } = reference;
    if (requestFingerprint(body) !== intentHash || reference.target.proposal.taskId !== reference.target.taskId
      || !isDeepStrictEqual([...selectedOperations(reference.intent)].sort(), reference.actions.map(row => row.operation).sort())) throw denied();
    return reference;
  };
  const metadata = async (taskId: string, tx?: Prisma.TransactionClient, signal?: AbortSignal) => {
    const scopes = new AiScopeRepository(d.db, new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock), clock);
    const first = await read(() => scopes.resolveCurrent(), signal), identity = originalIdentityHash(first.context);
    if (first.context.actor.kind !== 'user' || first.context.scope.kind !== 'workspace' || !['operator', 'staff'].includes(first.context.audience)
      || first.scope.kind !== 'WORKSPACE' || !('access' in first.context)) throw denied();
    const authorize = async (selectedTx = tx): Promise<SettingsGrant> => {
      if (signal?.aborted) throw denied();
      const current = await scopes.resolveCurrent(), context = current.context;
      if (current.scope.id !== first.scope.id || originalIdentityHash(context) !== identity || context.actor.kind !== 'user'
        || context.scope.kind !== 'workspace' || (context.audience !== 'operator' && context.audience !== 'staff') || !('access' in context)) throw denied();
      const access = aiTaskAccessFromContext(context, taskId, now()), db = selectedTx ?? d.db;
      const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: first.scope.id }] }, include: { scope: true } });
      if (!task || task.id !== taskId || task.scopeId !== first.scope.id || task.scopeKind !== 'WORKSPACE' || task.ownerKind !== 'USER'
        || task.ownerId !== context.actor.userId || task.audience !== context.audience.toUpperCase() || task.archivedAt !== null
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || !revision.safeParse(task.revision).success
        || task.sceneCode !== d.scene.code || task.sceneVersion !== d.scene.version
        || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)) throw denied();
      const actor = { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId: context.actor.userId };
      await new ApprovedSettingsRouteAuthority(d.guard, d.credentials).withAuthorization('read', async (guarded, revalidate) => {
        const identity = getRequestIdentity();
        if (!isDeepStrictEqual(actor, guarded) || !identity || identity.isSaasAdmin
          || identity.staffApi !== (context.audience === 'staff') || !isDeepStrictEqual(identity.dataScope, context.access.dataScope)
          || !isDeepStrictEqual(identity.locationScope, context.access.locationScope)
          || (identity.organizationId ?? undefined) !== (context.access.organizationId ?? undefined)) throw denied();
        await revalidate();
      });
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== first.scope.id || originalIdentityHash(after.context) !== originalIdentityHash(context) || signal?.aborted) throw denied();
      return { context: { ...context, scope: context.scope }, access, task, scopeId: task.scopeId, actor,
        bindingHash: snapshotHash({ identity: originalIdentityHash(context), task, source: 'original_settings_wait_read-1' }) };
    };
    const grant = await read(() => authorize(), signal), db = tx ? settingsTransactionDb(d.db, tx) : d.db;
    const tasks = new AiTaskRepository(db, { resolve: async (selected, requested) => {
      if (selected !== taskId || !['read_metadata', 'read_step_terminal'].includes(requested)) throw denied();
      return (await authorize()).context;
    } }, clock);
    const authority = new OriginalSettingsWaitReadAuthority({ ...d, db }, async (selected, selectedTx) => {
      if (selected !== taskId) throw denied();
      return authorize(selectedTx);
    });
    return { grant, authorize, db, tasks, participant: new PrismaApprovedSettingsParticipant(authority) };
  };
  const stage = async (query: z.infer<typeof targetQuery>, selected: SettingsApprovalAdmissionIntent, tx?: Prisma.TransactionClient, signal?: AbortSignal) => {
    const source = await metadata(query.taskId, tx, signal), { grant, db } = source, task = grant.task;
    await new ApprovedSettingsRouteAuthority(d.guard, d.credentials).withAuthorization('write', async (actor, revalidate) => {
      if (!isDeepStrictEqual(actor, grant.actor)) throw denied();
      await revalidate();
    });
    if (task.status !== 'WAITING_CONFIRMATION' || task.cancelRequestedAt !== null) throw unavailable();
    const steps = await db.aiStep.findMany({ where: { scopeId: grant.scopeId, taskId: task.id, toolCode: AI_APPROVED_SETTINGS_TOOL_CODE,
      ...(query.runId ? { runId: query.runId } : {}), ...(query.stepId ? { id: query.stepId } : {}) }, take: 2 });
    if (steps.length !== 1) throw unavailable();
    const step = steps[0], key = { scopeId: grant.scopeId, taskId: task.id, runId: step.runId }, phaseKey = { ...key, stepId: step.id };
    const run = await db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    const planRow = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (!run || run.scopeId !== key.scopeId || run.taskId !== task.id || run.id !== key.runId || run.actorKind !== 'USER'
      || run.actorId !== grant.actor.actorId || run.status !== 'RUNNING' || !revision.safeParse(run.revision).success
      || step.scopeId !== key.scopeId || step.taskId !== task.id || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE
      || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE' || step.resultRef !== null
      || !revision.safeParse(step.revision).success || !step.inputRef || !step.actionId || !planRow
      || planRow.scopeId !== key.scopeId || planRow.taskId !== task.id || planRow.runId !== run.id) throw unavailable();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(planRow.payload));
    if (plan.taskId !== task.id || plan.runId !== run.id || plan.steps.length !== 1 || requestFingerprint(plan) !== planRow.planHash
      || requestFingerprint(planRow.payload) !== planRow.planHash || plan.steps[0].toolCode !== step.toolCode
      || plan.steps[0].toolVersion !== step.toolVersion || plan.steps[0].operation !== 'idempotent') throw denied();
    const inputKey = { ...key, registrationRef: plan.steps[0].registrationRef };
    const input = await db.aiTaskActionInput.findFirst({ where: inputKey });
    if (!input || Object.entries(inputKey).some(([field, value]) => input[field as keyof typeof input] !== value)
      || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion || !revision.safeParse(input.policyRevision).success
      || !(input.expiresAt instanceof Date) || input.expiresAt <= now() || planRow.policyVersion !== `scene-policy-${input.policyRevision}`) throw denied();
    const change = settingsChangeReferenceSchema.parse(structuredClone(input.payload));
    if (requestFingerprint(change) !== input.fingerprint || change.changeId !== step.inputRef || change.changeHash !== step.requestFingerprint
      || step.actionId !== aiStepActionId(grant.access.scope, task.id, input.registrationRef)) throw denied();
    const store = taskExecutionPhaseStore(db as unknown as Prisma.TransactionClient), starts = await store.readStarts(phaseKey), receipts = await store.readReceipts(phaseKey);
    // A unique original confirmation, not missing consumption rows or an
    // expired lease, proves that this normal wait has not submitted settings.
    if (starts.length !== 1 || receipts.length !== 1 || starts[0].sequence !== 1 || receipts[0].kind !== 'confirmation') throw unavailable();
    const start = starts[0], receipt = receipts[0], waiting = waitingPayloadSchema.parse(receipt.payload);
    const expectedBinding = { ...phaseKey, actionId: step.actionId, inputRef: change.changeId, fingerprint: change.changeHash };
    if (waiting.version !== 'approved-settings-wait-1' || waiting.effectState !== 'awaiting_decision'
      || Object.entries(phaseKey).some(([field, value]) => start[field as keyof typeof start] !== value || receipt[field as keyof typeof receipt] !== value)
      || !isDeepStrictEqual(waiting.binding, expectedBinding) || start.actionId !== step.actionId || start.inputRef !== change.changeId
      || start.stepFingerprint !== change.changeHash || start.stepRevision !== step.revision || start.planHash !== planRow.planHash
      || receipt.phaseId !== start.id || receipt.createdAt < start.createdAt || receipt.createdAt > now()
      || waiting.presentedLease.taskId !== task.id || waiting.presentedLease.runId !== run.id || waiting.presentedLease.holderId !== start.leaseOwnerId
      || waiting.presentedLease.revision !== start.runRevision || waiting.presentedLease.fencingToken !== start.fencingToken
      || receipt.proposalId !== waiting.proposal.proposalId || receipt.proposalRevision !== waiting.proposal.proposalRevision
      || receipt.reviewedPayloadHash !== waiting.proposal.reviewedPayloadHash || requestFingerprint(receipt.payload) !== receipt.contentHash
      || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes) throw denied();
    const artifact = await db.aiTaskResultArtifact.findFirst({ where: { ...phaseKey, id: start.originalArtifactId } });
    if (!artifact || artifact.id !== start.originalArtifactId || Object.entries(phaseKey).some(([field, value]) => artifact[field as keyof typeof artifact] !== value)
      || artifact.actionId !== step.actionId || artifact.stepFingerprint !== change.changeHash || artifact.leaseOwnerId !== start.leaseOwnerId
      || artifact.fencingToken.toFixed(0) !== start.fencingToken || artifact.outcome !== 'RUNNING' || artifact.completeMeasurement
      || artifact.activeMs !== 0n || artifact.outputBytes !== 0n || artifact.contentHash !== requestFingerprint({})
      || requestFingerprint(artifact.payload) !== artifact.contentHash) throw denied();
    const proposal = settingsContract('AiApprovedSettingsReferenceDraft', { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: task.id,
      proposalId: waiting.proposal.proposalId, proposalRevision: waiting.proposal.proposalRevision, reviewedPayloadHash: waiting.proposal.reviewedPayloadHash });
    if (query.proposal && !isDeepStrictEqual(query.proposal, proposal)) throw conflict();
    const loaded = await source.participant.load(proposal, 'read', tx);
    if (loaded.step.id !== step.id || loaded.step.runId !== run.id || loaded.change.id !== change.changeId
      || loaded.change.changeHash !== change.changeHash || loaded.version.expiresAt <= now() || loaded.change.expiresAt <= now()
      || loaded.payload.contractVersion !== AI_PROPOSAL_DRAFT_VERSION || loaded.payload.actions[0].toolCode !== step.toolCode
      || await db.aiProposalVersion.findFirst({ where: { scopeId: grant.scopeId, taskId: task.id, proposalId: proposal.proposalId,
        revision: { gt: proposal.proposalRevision } } })) throw conflict();
    const approvalKey = { scopeId: grant.scopeId, taskId: task.id, proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision,
      actorKind: 'USER' as const, actorId: grant.actor.actorId, audience: task.audience };
    const approval = await db.aiApproval.findFirst({ where: approvalKey });
    if (approval && (Object.entries(approvalKey).some(([field, value]) => approval[field as keyof typeof approval] !== value)
      || !['APPROVED', 'REJECTED'].includes(approval.decision) || approval.payloadHash !== proposal.reviewedPayloadHash
      || !(approval.issuedAt instanceof Date) || !(approval.expiresAt instanceof Date) || approval.issuedAt > now()
      || approval.issuedAt >= approval.expiresAt || approval.expiresAt.getTime() !== Date.parse(loaded.payload.expiresAt))) throw conflict();
    if (selected === 'explicit_decide' ? !!approval || loaded.head.status !== 'PENDING_CONFIRMATION' || loaded.head.currentRevision !== null
      : !approval || loaded.head.currentRevision !== proposal.proposalRevision
        || loaded.head.status !== (approval.decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED')) throw unavailable();
    const operationKey = `as-operation-${requestFingerprint(expectedBinding)}`;
    if (await db.aiApprovalConsumption.findFirst({ where: { scopeId: grant.scopeId, taskId: task.id, actionId: step.actionId } })
      || await db.rentalApprovedSettingsOperation.findUnique({ where: { workspaceId_operationKey: { workspaceId: grant.actor.workspaceId, operationKey } } })) throw unavailable();
    const domain = new ApprovedSettingsChangeService(db, d.core, new ApprovedSettingsRouteAuthority(d.guard, d.credentials), source.participant, clock);
    const currentChange = await domain.readAuthorizedChange(change);
    if (currentChange.changeId !== change.changeId || currentChange.changeHash !== change.changeHash
      || currentChange.baseRevision !== loaded.change.baseRevision || currentChange.expiresAt !== loaded.change.expiresAt.toISOString()) throw conflict();
    const waitingRead = await PrismaTaskApplication.readConfirmation({ db, tasks: source.tasks, clock: d.runnerClock },
      { taskId: task.id, runId: run.id, stepId: step.id });
    if (waitingRead.taskRevision !== task.revision || waitingRead.checkpointRef !== receipt.id
      || !isDeepStrictEqual(waitingRead.proposal, waiting.proposal)) throw conflict();
    const expiry = Math.min(input.expiresAt.getTime(), loaded.change.expiresAt.getTime(), Date.parse(loaded.payload.expiresAt));
    if (!Number.isFinite(expiry) || expiry <= now().getTime()) throw unavailable();
    const target = targetSchema.parse({ taskId: task.id, runId: run.id, stepId: step.id, scopeId: grant.scopeId,
      tenantId: grant.actor.tenantId, workspaceId: grant.actor.workspaceId,
      ownerId: grant.actor.actorId, audience: grant.context.audience, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion,
      proposal, change, baseRevision: loaded.change.baseRevision, baseSettingsHash: loaded.change.baseSettingsHash,
      categoryVersionId: loaded.change.categoryVersionId, categoryAdoptionRevision: loaded.change.categoryAdoptionRevision,
      registrationRef: input.registrationRef, inputId: input.id, inputHash: input.fingerprint, inputPolicyRevision: input.policyRevision,
      actionId: step.actionId, planHash: planRow.planHash, checkpointRef: receipt.id, expiresAt: new Date(expiry).toISOString() });
    await source.authorize(tx);
    return { target, context: grant.context, decision: approval ? approval.decision === 'APPROVED' ? 'approve' as const : 'reject' as const : undefined,
      stageHash: snapshotHash({ identity: originalIdentityHash(grant.context), task, run, step, planRow, input, starts, receipts, artifact,
        head: loaded.head, version: loaded.version, payload: loaded.payload, action: loaded.action, change: loaded.change,
        review: loaded.review, approval, currentChange }) };
  };
  const publication = async (target: SettingsApprovalAdmissionReference['target'], tx?: Prisma.TransactionClient) => {
    if (await d.currentRuntimeEnabled(target.sceneCode, target.sceneVersion) !== true) throw unavailable();
    const key = { scopeId: target.scopeId, sceneCode: target.sceneCode, sceneVersion: target.sceneVersion }, row = await (tx ?? d.db).aiTaskPlanPolicy.findFirst({ where: key });
    if (!row || Object.entries(key).some(([field, value]) => row[field as keyof typeof row] !== value) || row.enabled !== true
      || row.revision !== target.inputPolicyRevision || !revision.safeParse(row.revision).success || !(row.expiresAt instanceof Date) || row.expiresAt <= now()) throw unavailable();
    const tools = aiPersistedPlanToolsSchema.parse(structuredClone(row.allowedTools)), limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (!tools.some(tool => tool.code === AI_APPROVED_SETTINGS_TOOL_CODE && tool.version === AI_TOOL_DRAFT_VERSION)
      || tools.some(tool => !['ai.model.text', 'tenant.opening.diagnose', 'tenant.config.propose', AI_APPROVED_SETTINGS_TOOL_CODE].includes(tool.code))
      || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    return { hash: snapshotHash({ ...row, allowedTools: tools, limits }), expiresAt: row.expiresAt.getTime() };
  };
  const minimumPermission = (held: readonly string[], existing: readonly string[] = []) => existing.includes('rental-os:price:manage') ? 'rental-os:price:manage'
    : existing.includes('rental-os:rules:manage') ? 'rental-os:rules:manage' : held.includes('rental-os:price:manage') ? 'rental-os:price:manage'
      : held.includes('rental-os:rules:manage') ? 'rental-os:rules:manage' : undefined;
  const policyRows = async (reference: SettingsApprovalAdmissionReference, tx?: Prisma.TransactionClient) => {
    const rows = await (tx ?? d.db).aiTaskActionPolicy.findMany({ where: { scopeId: reference.target.scopeId, taskId: reference.target.taskId,
      operation: { in: reference.actions.map(row => row.operation) } }, take: reference.actions.length + 1 });
    if (rows.length > reference.actions.length || new Set(rows.map(row => row.operation)).size !== rows.length) throw unavailable();
    for (const row of rows) if (row.scopeId !== reference.target.scopeId || row.taskId !== reference.target.taskId
      || !revision.safeParse(row.revision).success || !permissions.safeParse(row.requiredPermissions).success
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
    return rows;
  };
  const verify = async (value: SettingsApprovalAdmissionReference, purpose: 'issue' | 'observe', tx?: Prisma.TransactionClient) => {
    const reference = parseReference(value), source = await metadata(reference.target.taskId, tx), current = await source.authorize(tx), target = reference.target;
    if (current.scopeId !== target.scopeId || current.actor.tenantId !== target.tenantId || current.actor.workspaceId !== target.workspaceId
      || current.actor.actorId !== target.ownerId || current.context.audience !== target.audience
      || current.task.sceneCode !== target.sceneCode || current.task.sceneVersion !== target.sceneVersion) throw denied();
    if (purpose === 'observe') return current.context;
    const state = await stage({ taskId: target.taskId, runId: target.runId, stepId: target.stepId, proposal: target.proposal }, reference.intent, tx);
    const published = await publication(target, tx);
    if (!isDeepStrictEqual(state.target, target) || state.stageHash !== reference.stageHash || published.hash !== reference.publicationHash
      || reference.intent === 'explicit_continue' && state.decision !== reference.decision) throw conflict();
    const held = current.context.access.permissions, rows = await policyRows(reference, tx);
    if (!minimumPermission(held)) throw denied();
    const cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, Date.parse(target.expiresAt));
    for (const action of reference.actions) {
      const row = rows.find(value => value.operation === action.operation), minimum = minimumPermission(held, row ? row.requiredPermissions as string[] : []);
      if (!minimum || !action.requiredPermissions.includes(minimum) || action.requiredPermissions.some(value => !held.includes(value))
        || Date.parse(action.expiresAt) <= now().getTime() || action.mode === 'configure' && Date.parse(action.expiresAt) > cutoff) throw denied();
      if (action.mode === 'retain') {
        if (!row || row.revision !== action.expectedRevision || row.expiresAt.toISOString() !== action.expiresAt
          || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
      } else if ((row?.revision ?? null) === action.expectedRevision) {
        if (!isDeepStrictEqual([...new Set([minimum, ...(row ? row.requiredPermissions as string[] : [])])].sort(), [...action.requiredPermissions].sort())) throw denied();
      } else if (!row || row.revision !== (action.expectedRevision ?? 0) + 1 || row.expiresAt.toISOString() !== action.expiresAt
        || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
    }
    return current.context;
  };
  const readReceipt = async (value: unknown, signal?: AbortSignal): Promise<SettingsApprovalAdmissionReceipt> => {
    const parsed = z.object({ reference: referenceSchema }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = parseReference(parsed.data.reference), reader = new SettingsApprovalAdmissionAuthority(d, reference, 'observe', verify).reader();
    const entries: SettingsApprovalAdmissionReceipt['entries'] = [];
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
    return { phase: 'original_settings_policy_receipts', reference, entries, completeRecorded: entries.every(row => row.state !== 'not_observed' && row.matchesPreparedContent),
      admission: 'not_granted_by_receipt', execution: 'not_started', businessApproval: 'not_granted', automaticRetry: false,
      waitingBinding: 'not_attested_by_legacy_policy_receipt' };
  };
  return Object.freeze({
    async prepare(value: unknown, signal?: AbortSignal) {
      const parsed = targetQuery.extend({ intent, decision: decision.optional() }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data;
      if (command.intent === 'explicit_decide' ? !command.decision : command.decision !== undefined) throw denied();
      const state = await stage({ taskId: command.taskId, runId: command.runId, stepId: command.stepId, proposal: command.proposal }, command.intent, undefined, signal);
      const published = await publication(state.target), held = state.context.access.permissions;
      if (!minimumPermission(held)) throw denied();
      const cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, Date.parse(state.target.expiresAt));
      if (cutoff <= now().getTime()) throw unavailable();
      const actions: SettingsApprovalAdmissionReference['actions'] = [];
      for (const selected of selectedOperations(command.intent)) {
        const row = await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: { scopeId: state.target.scopeId, taskId: state.target.taskId, operation: selected } } });
        if (row && (row.scopeId !== state.target.scopeId || row.taskId !== state.target.taskId || row.operation !== selected
          || !revision.safeParse(row.revision).success || !permissions.safeParse(row.requiredPermissions).success
          || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()))) throw unavailable();
        const minimum = minimumPermission(held, row ? row.requiredPermissions as string[] : []);
        if (!minimum) throw denied();
        const requiredPermissions = [...new Set([minimum, ...(row ? row.requiredPermissions as string[] : [])])];
        if (requiredPermissions.some(value => !held.includes(value))) throw denied();
        const retain = !!row && row.expiresAt > now() && requiredPermissions.every(value => (row.requiredPermissions as string[]).includes(value));
        actions.push(action.parse({ operation: selected, mode: retain ? 'retain' : 'configure', expectedRevision: row?.revision ?? null,
          requiredPermissions, expiresAt: retain ? row!.expiresAt.toISOString() : new Date(cutoff).toISOString() }));
      }
      const body = { version: 'settings-approval-admission-1' as const, intent: command.intent,
        decision: command.intent === 'explicit_decide' ? command.decision! : state.decision!, target: state.target,
        stageHash: state.stageHash, publicationHash: published.hash, actions };
      const reference = parseReference({ ...body, intentHash: requestFingerprint(body) });
      await read(() => verify(reference, 'issue'), signal);
      return { phase: 'prepared' as const, reference, admission: actions.every(row => row.mode === 'retain')
        ? 'existing_policies_available' as const : 'explicit_settings_policy_issuance_required' as const,
      execution: 'not_started' as const, businessApproval: 'not_granted' as const };
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
      const close = () => { active = false; };
      signal?.addEventListener('abort', close, { once: true });
      const verifier: typeof verify = async (...args) => { if (!active) throw denied(); const context = await verify(...args); if (!active) throw denied(); return context; };
      const authority = new SettingsApprovalAdmissionAuthority(d, reference, 'issue', verifier);
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
        return { phase: 'settings_policy_admission_recorded' as const, reference, receipt,
          admission: 'current_wait_settings_category_publication_and_role_revalidated' as const,
          execution: 'not_started' as const, businessApproval: 'not_granted' as const };
      } catch (error) { if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); throw error; }
      finally { active = false; signal?.removeEventListener('abort', close); }
    }, readReceipt
  });
}
