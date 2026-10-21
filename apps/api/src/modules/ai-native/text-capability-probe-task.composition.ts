import type { PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiTextCapabilityAccountingResponseDraft } from '@rental-os/shared';
import { z } from 'zod';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { composeAuthorizedPersistentTaskInputRunner } from './runner/authorized-persistent-task-input.composition';
import { PrismaTaskPlanInputSource } from './runner/prisma-task-plan-input.source';
import { PrismaTaskRunEvidenceRepository } from './runner/prisma-task-run-evidence.repository';
import { PrismaTaskExecutionScopeAuthority } from './runner/prisma-task-execution-scope.authority';
import { PrismaTextProbeStepEvidenceAuthority } from './prisma-text-probe-step-evidence.authority';
import { textProbeCommandSchema, textProbeIntent, textProbeCapability, textProbeMode, TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE, type TextProbeCommand } from './text-capability-probe';
import { PrismaTextCapabilityReceiptRepository } from './prisma-text-capability-receipt.repository';
import { PrismaTaskRecoverySnapshotRepository } from './runner/prisma-task-recovery-snapshot.repository';
import type { TextCapabilityProbeApplication } from './text-capability-probe.application';
import type { PersistedBudgetEvidenceSource } from './budget/budget-dependency-adapters';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from './runner/prisma-task-application';
import type { AiTaskRunnerRepositoryCommandFactory } from './runner/ai-task-runner.repository-adapter';
import type { AiTaskInputSource } from './task-input/task-input.ports';
import type { AiTaskRegisteredExecutor } from './runner/prisma-task-measured-effects';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerClock, AiTaskRunnerLease, AiTaskRunnerStepRef } from './runner/ai-task-runner.ports';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { composeAuthorizedTextProbeTaskProducer } from './prisma-text-probe-original-request.repository';
import { composeTaskActionPolicyManagement } from './task-action-policy-management.composition';
import type { AiTaskActionPolicyMutation } from './prisma-task-action-policy.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { composePersistedTaskAccountingRecovery } from './task-model-gateway.composition';
import { presentTaskBudgetUsageRecord } from './budget/task-budget-usage.reader';
import { BudgetError } from './budget/budget.ports';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const cancellationSchema = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
const originalCancellationSchema = cancellationSchema.extend({ creationKey: id.max(128), inputRef: id }).strict();

export function textProbeTaskCreationKey(requestKey: string) {
  return `text-probe-task:${requestFingerprint({ requestKey: id.max(128).parse(requestKey) })}`;
}

const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  command: textProbeCommandSchema, priceVersion: id.max(64), limits: aiTaskRunnerLimitsSchema }).strict();
type TextProbeTask = z.infer<typeof taskSchema>;

export type TextCapabilityProbeTaskComposition = Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'> & {
  db: PrismaClient;
  host: AiTaskApplicationHost;
  task: TextProbeTask;
  probe: Pick<TextCapabilityProbeApplication, 'prepare' | 'runHeldCurrent' | 'prepareHeldInvocationCurrent'>;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  clock?: () => Date;
  monotonic?: () => number;
  runnerClock?: AiTaskRunnerClock;
};

/** Server-only composition for the capability challenge. The task/run/step is
 * created by the caller's existing task producer; this function only publishes
 * the immutable command after a lease, saves one probe step and executes through
 * the existing Gateway/ledger path. No route, worker or policy is registered. */
export function composeTextCapabilityProbeTask(input: TextCapabilityProbeTaskComposition) {
  const task = taskSchema.parse(structuredClone(input.task));
  if (typeof input.probe?.runHeldCurrent !== 'function'
    || typeof input.probe?.prepare !== 'function' || typeof input.financialEvidence?.readDispatch !== 'function') throw unavailable();
  const clock = input.clock ?? (() => new Date());
  const root = createRoot(input, task, clock);
  const application = root.createApplication(input.host, async ({ lease, taskRevision, signal }) => {
    if (signal?.aborted || lease.taskId !== task.taskId || lease.runId !== task.runId) throw unavailable();
    await root.source.publishProbeInput({ taskId: task.taskId, registrationRef: task.registrationRef,
      expectedTaskRevision: taskRevision, lease, input: structuredClone(task.command) });
    if (signal?.aborted) throw unavailable();
    await root.plans.savePlan({ taskId: task.taskId, runId: lease.runId, taskRevision,
      steps: [{ registrationRef: task.registrationRef, operation: 'external_unknown',
        toolCode: TEXT_CAPABILITY_PROBE_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION }], limits: structuredClone(task.limits) }, lease);
  });
  return Object.freeze({ ...root, application,
    // Request only: no fabricated cancelled outcome, refund or replacement run.
    // Current task action policy, owner/scope and revision are checked by the
    // existing transition repository, and the original runner converges later.
    requestCancellation(value: unknown) {
      const parsed = cancellationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return waitForTaskApplicationDependency(() => root.taskTransitions.transition({ taskId: task.taskId,
        expectedRevision: parsed.data.expectedRevision, to: 'cancel_requested', reason: 'cancel_requested' }), true, undefined, input.runnerClock);
    },
  });
}

function createRoot(input: TextCapabilityProbeTaskComposition, task: TextProbeTask, clock: () => Date) {
  const authorization = requireAuthorization(input, clock);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock, TEXT_CAPABILITY_PROBE_TOOL);
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db);
  const plans = new PrismaTaskRunEvidenceRepository(input.db, scopes, source, clock);
  const gatewayInput = {
    async resolve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
      const access = await authorization.tasks.resolveAccess(lease.taskId, 'transition_task');
      const taskRow = await input.db.aiTask.findFirst({ where: access.where, select: { scopeId: true } });
      const row = taskRow && await input.db.aiStep.findFirst({ where: { scopeId: taskRow.scopeId, taskId: lease.taskId, runId: lease.runId, id: step.registered.stepId } });
      if (!row || !row.inputRef) throw denied();
      const stored = await source.readForExecution({ taskId: lease.taskId, runId: lease.runId, stepId: row.id,
        actionId: row.actionId, inputRef: row.inputRef, fingerprint: row.requestFingerprint, lease });
      const context = stored.context;
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
      const prepared = await input.probe.prepare({ tenantId: context.scope.tenantId,
        workspaceId: context.scope.workspaceId, actorId: context.actor.userId },
        textProbeCommandSchema.parse(stored.input));
      return { stepId: row.id, mode: textProbeMode(textProbeCommandSchema.parse(stored.input)), lease: { runId: lease.runId, holderId: lease.holderId, fencingToken: lease.fencingToken },
        intent: prepared.intent, configuration: prepared.configuration, priceVersion: task.priceVersion,
        expiresAt: new Date(Math.min(Date.parse(stored.expiresAt), Date.parse(lease.expiresAt))) };
    }
  };
  // One planned model step, one first-registration handoff. Never a module
  // singleton or recoverable dispatch permission. Recovery uses stored facts.
  let pending: { stepId: string; leaseHash: string;
    prepared: Awaited<ReturnType<TextCapabilityProbeApplication['prepareHeldInvocationCurrent']>> } | undefined;
  const invocations = { async prepare(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    if (pending || typeof input.probe.prepareHeldInvocationCurrent !== 'function') throw unavailable();
    const registration = await gatewayInput.resolve(step, lease);
    if (registration.stepId !== step.registered.stepId || registration.lease.runId !== lease.runId
      || registration.lease.holderId !== lease.holderId || registration.lease.fencingToken !== lease.fencingToken
      || registration.expiresAt.getTime() > Date.parse(lease.expiresAt)) throw denied();
    const prepared = await input.probe.prepareHeldInvocationCurrent(structuredClone(task.command), {
      stepId: registration.stepId, lease: registration.lease, priceVersion: registration.priceVersion, expiresAt: registration.expiresAt,
    });
    pending = { stepId: registration.stepId, leaseHash: requestFingerprint(lease), prepared };
    return { invocationId: prepared.invocationId };
  } };
  const transition = new PrismaTextProbeStepEvidenceAuthority(input.db, authorization.authority, source,
    input.financialEvidence, task.priceVersion, clock);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      if (plan.toolCode !== TEXT_CAPABILITY_PROBE_TOOL || plan.toolVersion !== AI_TOOL_DRAFT_VERSION || plan.operation !== 'external_unknown') throw unavailable();
      const metadata = await authorization.tasks.readMetadata(lease.taskId);
      return { taskId: lease.taskId, registrationRef: plan.registrationRef, expectedTaskRevision: metadata.revision,
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    },
    transition(kind, step, lease, resultRef) {
      if (kind === 'pause' || step.plan.toolCode !== TEXT_CAPABILITY_PROBE_TOOL || (kind !== 'start' && !resultRef)) throw unavailable();
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const executors: AiTaskRegisteredExecutor = {
    async resolve(code, version) {
      if (code !== TEXT_CAPABILITY_PROBE_TOOL || version !== AI_TOOL_DRAFT_VERSION) return null;
      return { operation: 'external_unknown' as const, async execute(binding, signal) {
        const stored = await source.readForExecution(binding);
        const owned = pending;
        if (!owned || owned.stepId !== binding.stepId || owned.leaseHash !== requestFingerprint(binding.lease)
          || requestFingerprint(textProbeCommandSchema.parse(stored.input)) !== requestFingerprint(task.command)) throw denied();
        pending = undefined;
        const result = await owned.prepared.execute(signal);
        const payload = JSON.parse(JSON.stringify(result));
        if (result.status === 'completed' && result.usage.kind === 'reported') return { kind: 'succeeded' as const, payload };
        if (result.status === 'failed') return { kind: 'failed' as const, payload, errorCode: 'AI_RESOURCE_UNAVAILABLE' as const };
        return { kind: 'unknown' as const, payload };
      } };
    }
  };
  const inputSource: AiTaskInputSource = { async resolve() { return { kind: 'not_required' as const }; }, async validateAnswers() { throw unavailable(); } };
  const composed = composeAuthorizedPersistentTaskInputRunner({ db: input.db,
    authorization: { auth: input.auth, credentials: input.credentials, subscriptions: input.subscriptions }, registrationAuthority: source,
    transitionAuthority: transition, planAuthority: source, inputSource, commands, executors,
    invocations, financialEvidence: input.financialEvidence, toolCatalog: { resolve: async (code, version) =>
      code === TEXT_CAPABILITY_PROBE_TOOL && version === AI_TOOL_DRAFT_VERSION ? { modelCall: true } : null },
    wall: clock, monotonic: input.monotonic, clock: input.runnerClock });
  return Object.freeze({ ...composed, authorization, source, plans, invocations, commands, transition, executors, inputSource });
}

function requireAuthorization(input: TextCapabilityProbeTaskComposition, clock: () => Date) {
  return composePersistedTaskAuthorization({ db: input.db, auth: input.auth, credentials: input.credentials,
    subscriptions: input.subscriptions, clock });
}

/** Server workflow from immutable original request to the existing runner.
 * Starting/reconciling NEVER creates a replacement task or operation. Publish,
 * create, start and receipt read remain separately observable commit points.
 * This is not an HTTP registration or permission to bypass task action policy. */
export function composePersistedTextProbeWorkflow(input: Omit<TextCapabilityProbeTaskComposition, 'task' | 'probe'> & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  probe: Pick<TextCapabilityProbeApplication, 'prepare' | 'prepareCurrent' | 'runHeldCurrent' | 'reconcileCurrent' | 'preflightCurrent' | 'prepareHeldInvocationCurrent'>;
  sceneVersion: string; priceVersion: string;
}) {
  const host = z.object({ holderId: id, leaseMs: z.number().int().min(1).max(120000) }).strict().parse(structuredClone(input.host));
  const observe = <T>(operation: () => Promise<T>, signal?: AbortSignal, afterMutation = false) =>
    waitForTaskApplicationDependency(operation, afterMutation, signal, input.runnerClock);
  const producer = composeAuthorizedTextProbeTaskProducer(input.db, {
    auth: input.auth, credentials: input.credentials, guard: input.guard, probe: input.probe,
    sceneVersion: input.sceneVersion, priceVersion: input.priceVersion, clock: input.clock,
  });
  const taskPolicies = composeTaskActionPolicyManagement({ db: input.db, auth: input.auth,
    credentials: input.credentials, guard: input.guard, clock: input.clock });
  const originalTask = async (value: unknown) => {
    const found = await producer.readCreation(structuredClone(value));
    if (!found.task) throw unavailable();
    const saved = found.task;
    const task = { taskId: saved.taskId, runId: saved.runId, registrationRef: saved.registrationRef,
      command: saved.command, priceVersion: saved.priceVersion, limits: saved.limits };
    const root = composeTextCapabilityProbeTask({ ...input, host, task });
    // Reauthorize the exact persisted task before returning a runner/receipt
    // consumer. Merely finding the original creation key grants no run lease.
    await root.authorization.tasks.readMetadata(task.taskId);
    return { task, root };
  };
  // Original financial recovery never resolves today's probe configuration or
  // claims a runner lease. The immutable request determines the one call; the
  // ordinary budget service still verifies current authority and usage facts.
  const originalAccounting = async (requestKeyValue: string, operation: 'read' | 'releaseUnsent' | 'reconcile'):
    Promise<AiTextCapabilityAccountingResponseDraft> => {
    const parsed = id.max(128).safeParse(requestKeyValue);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const requestKey = parsed.data;
    const original = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
    const history = await workflow.readHistoricalOriginal(requestKey);
    if (!original || history.state !== 'historical' || !history.task || !history.run) throw unavailable();
    const context = original.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw denied();
    const taskId = history.task.taskId, runId = history.run.runId;
    const callId = textProbeIntent(original.command.operationId, original.owner.scopeId, textProbeCapability(original.command)).intent.requestId;
    const invocation = structuredClone(await observe(() => input.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: original.owner.scopeId, callId } }, select: { id: true, scopeId: true,
        taskId: true, runId: true, stepId: true, actionId: true, actorId: true, sceneCode: true, callId: true,
        priceVersion: true, intentHash: true, configurationHash: true, configuration: true, stepFingerprint: true } })));
    const receipt = await observe(() => new PrismaTextCapabilityReceiptRepository(input.db, input.clock)
      .find(original.owner.scopeId, original.command.operationId));
    if (!invocation || !receipt) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    const d = receipt.descriptor;
    if (invocation.scopeId !== original.owner.scopeId || invocation.taskId !== taskId || invocation.runId !== runId
      || invocation.actorId !== context.actor.userId || invocation.sceneCode !== TEXT_PROBE_SCENE
      || invocation.callId !== callId || invocation.priceVersion !== original.priceVersion
      || invocation.stepId !== d.stepId || invocation.runId !== d.runId || d.callId !== callId || d.scopeId !== original.owner.scopeId
      || requestFingerprint(d.command) !== requestFingerprint(original.command)
      || requestFingerprint(d.context) !== requestFingerprint({ actorId: context.actor.userId,
        tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId })
      || requestFingerprint({ ...textProbeIntent(original.command.operationId, original.owner.scopeId, textProbeCapability(original.command)),
        configuration: d.configuration }) !== original.preparationHash
      || invocation.intentHash !== d.intentHash || invocation.configurationHash !== d.configurationHash
      || requestFingerprint(invocation.configuration) !== d.configurationHash
      || invocation.stepFingerprint !== requestFingerprint(original.command)) throw denied();
    const reservation = structuredClone(await observe(() => input.db.aiBudgetReservation.findUnique({ where: {
      scopeId_scopeKind_callId: { scopeId: original.owner.scopeId, scopeKind: 'WORKSPACE', callId } }, select: {
        id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true,
        callId: true, priceVersion: true, unitKind: true } })));
    // Missing reserve/link acknowledgement is not proof of no consumption.
    if (!reservation) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (reservation.scopeId !== original.owner.scopeId || reservation.scopeKind !== 'WORKSPACE'
      || reservation.tenantId !== context.scope.tenantId || reservation.workspaceId !== context.scope.workspaceId
      || reservation.actorId !== context.actor.userId || reservation.callId !== callId
      || reservation.priceVersion !== invocation.priceVersion || !['calls', 'tokens', 'money'].includes(reservation.unitKind)) throw denied();
    const verify = async () => {
      const again = await producer.originals.readHistoricalOriginal(requestKey);
      const latest = await workflow.readHistoricalOriginal(requestKey);
      if (!again || again.inputRef !== original.inputRef || again.inputHash !== original.inputHash
        || latest.state !== 'historical' || latest.task?.taskId !== taskId || latest.run?.runId !== runId) throw denied();
    };
    let returnedMutation = false;
    try {
      await observe(verify);
      const recovery = composePersistedTaskAccountingRecovery({ db: input.db, auth: input.auth,
        credentials: input.credentials, subscriptions: input.subscriptions, guard: input.guard, taskId, clock: input.clock,
        pricing: { kind: reservation.unitKind === 'calls' ? 'calls' : 'recorded', priceVersion: invocation.priceVersion } });
      const record = await observe(() => operation === 'read' ? recovery.readCall({ callId })
        : recovery[operation]({ reservationId: reservation.id }), undefined, operation !== 'read');
      returnedMutation = operation !== 'read';
      await observe(verify, undefined, returnedMutation);
      if (record.id !== reservation.id || record.callId !== callId || record.association.runId !== runId
        || record.association.stepId !== invocation.stepId || record.association.actionId !== invocation.actionId)
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      return { requestKey, taskId, record: presentTaskBudgetUsageRecord(invocation, record),
        accounting: operation === 'read' ? 'observed' : 'original_operation_only', execution: 'not_invoked',
        automaticRetry: false, businessExecution: 'not_inferred_from_usage', admission: 'not_granted' };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
      if (error instanceof BudgetError && error.code === 'FORBIDDEN') throw denied();
      if (returnedMutation || error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION')
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      if (error instanceof BudgetError) throw error.code === 'INVALID' ? new AiTaskRepositoryError('AI_INVALID_INPUT') : unavailable();
      throw error;
    }
  };
  const workflow = Object.freeze({
    // Server management capability, never a model tool or automatic seed.
    taskPolicies,
    async readTaskPolicyMutation(requestKey: string, operation: AiTaskActionPolicyMutation['operation'], expectedRevision: number | null) {
      const original = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
      if (!original) throw unavailable();
      const where = { ...original.owner, scopeKind: 'WORKSPACE' as const, sceneCode: TEXT_PROBE_SCENE,
        sceneVersion: original.sceneVersion, creationKey: textProbeTaskCreationKey(requestKey), inputRef: original.inputRef,
        inputRevision: original.inputRevision, inputHash: original.inputHash };
      const rows = structuredClone(await observe(() => input.db.aiTask.findMany({ where, take: 2,
        select: { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true,
          sceneCode: true, sceneVersion: true, creationKey: true, inputRef: true, inputRevision: true, inputHash: true } })));
      if (rows.length !== 1 || Object.entries(where).some(([key, value]) => rows[0][key as keyof typeof rows[0]] !== value)) throw unavailable();
      const result = await observe(() => taskPolicies.readMutation(rows[0].id, operation, expectedRevision));
      const after = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
      if (!after || after.inputRef !== original.inputRef || after.inputHash !== original.inputHash
        || requestFingerprint(after.owner) !== requestFingerprint(original.owner)) throw denied();
      return result;
    },
    publishOriginal: (value: unknown) => producer.originals.publish(value),
    readOriginal: (requestKey: string) => producer.originals.readOriginal(requestKey),
    readOriginalCapability: (requestKey: string) => producer.originals.readOriginalCapability(requestKey),
    readOriginalPolicyExpiry: (requestKey: string) => producer.originals.readPolicyExpiry(requestKey),
    readOriginalAccounting: (requestKey: string) => originalAccounting(requestKey, 'read'),
    releaseOriginalUnsent: (requestKey: string) => originalAccounting(requestKey, 'releaseUnsent'),
    reconcileOriginalAccounting: (requestKey: string) => originalAccounting(requestKey, 'reconcile'),
    createTask: (value: unknown) => producer.create(value),
    readCreation: (value: unknown) => producer.readCreation(value),
    async readHistoricalOriginal(requestKey: string) {
      const original = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
      const now = (input.clock ?? (() => new Date()))();
      if (!Number.isFinite(now.getTime())) throw unavailable();
      const validity = (expiresAt: string) => Date.parse(expiresAt) <= now.getTime() ? 'expired' as const : 'historical_only' as const;
      const header = { applicability: 'historical_only' as const, currentCapability: 'not_assessed' as const, retryable: false as const,
        original: original ? { expiresAt: original.expiresAt, validity: validity(original.expiresAt) } : null };
      const absent = { ...header, state: 'not_observed' as const, task: null, run: null, resultObserved: false, configurationRevision: null, observation: null };
      if (!original) return absent;
      const where = { ...original.owner, scopeKind: 'WORKSPACE' as const, sceneCode: TEXT_PROBE_SCENE,
        sceneVersion: original.sceneVersion, creationKey: textProbeTaskCreationKey(requestKey), inputRef: original.inputRef,
        inputRevision: original.inputRevision, inputHash: original.inputHash };
      const rows = await observe(() => input.db.aiTask.findMany({ where, take: 2, select: { id: true, scopeId: true, scopeKind: true,
        audience: true, ownerKind: true, ownerId: true, sceneCode: true, sceneVersion: true, creationKey: true,
        inputRef: true, inputRevision: true, inputHash: true } }));
      if (rows.length > 1) throw unavailable();
      if (!rows.length) {
        const again = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
        if (!again || again.inputRef !== original.inputRef || again.inputHash !== original.inputHash) throw unavailable();
        return absent;
      }
      const stored = rows[0];
      if (Object.entries(where).some(([key, expected]) => stored[key as keyof typeof stored] !== expected)) throw unavailable();
      // The original key locates, never authorizes. Use current task policies,
      // without resolving today's model, plan policy or an execution lease.
      const authorization = composePersistedTaskAuthorization(input);
      const access = await observe(() => authorization.tasks.resolveAccess(stored.id, 'read_metadata'));
      const metadata = await observe(() => authorization.tasks.readMetadata(stored.id));
      const runs = await observe(() => input.db.aiRun.findMany({ where: { scopeId: stored.scopeId, taskId: stored.id, sequence: 1 }, take: 2,
        select: { id: true, scopeId: true, taskId: true, sequence: true, actorKind: true, actorId: true } }));
      if (runs.length !== 1 || runs[0].scopeId !== stored.scopeId || runs[0].taskId !== stored.id || runs[0].sequence !== 1
        || runs[0].actorKind !== access.actorKind || runs[0].actorId !== access.actorId) throw unavailable();
      const snapshot = await observe(() => new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks).read({ taskId: stored.id, runId: runs[0].id }));
      if (snapshot.task.revision !== metadata.revision || snapshot.task.status !== metadata.status
        || snapshot.steps.some(step => step.toolCode !== TEXT_CAPABILITY_PROBE_TOOL)) throw unavailable();
      const receipt = await observe(() => new PrismaTextCapabilityReceiptRepository(input.db, input.clock).find(stored.scopeId, original.command.operationId));
      let configurationRevision: number | null = null;
      let observation: { receiptId: string; methodVersion: string; mode: 'mock' | 'live';
        checkedAt: string; expiresAt: string; validity: 'expired' | 'historical_only'; matched: boolean;
        reportedUsage: { inputTokens: number; outputTokens: number } | null } | null = null;
      if (receipt) {
        const d = receipt.descriptor, context = original.context;
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
          || d.scopeId !== stored.scopeId || d.runId !== runs[0].id || !snapshot.steps.some(step => step.stepId === d.stepId)
          || requestFingerprint(d.command) !== requestFingerprint(original.command)
          || requestFingerprint(d.context) !== requestFingerprint({ tenantId: context.scope.tenantId,
            workspaceId: context.scope.workspaceId, actorId: context.actor.userId })
          || requestFingerprint({ ...textProbeIntent(original.command.operationId, stored.scopeId, textProbeCapability(original.command)), configuration: d.configuration }) !== original.preparationHash) throw unavailable();
        configurationRevision = z.number().int().min(1).max(4294967295).parse(d.configuration.configRevision);
        const o = receipt.observation;
        if (o) observation = { receiptId: receipt.id, methodVersion: d.methodVersion,
          mode: o.transport === 'node_https' ? 'live' : 'mock', checkedAt: o.checkedAt, expiresAt: o.expiresAt,
          validity: validity(o.expiresAt), matched: o.matched, reportedUsage: o.usage ? { ...o.usage } : null };
      }
      const again = await observe(() => producer.originals.readHistoricalOriginal(requestKey));
      if (!again || again.inputRef !== original.inputRef || again.inputHash !== original.inputHash
        || (await observe(() => authorization.tasks.resolveAccess(stored.id, 'read_metadata'))).bindingKey !== access.bindingKey
        || (await observe(() => authorization.tasks.resolveAccess(stored.id, 'read_step_terminal'))).bindingKey !== access.bindingKey) throw denied();
      return { ...header, state: 'historical' as const,
        task: { taskId: snapshot.task.taskId, status: snapshot.task.status, revision: snapshot.task.revision,
          cancelRequestedAt: snapshot.task.cancelRequestedAt }, run: { runId: snapshot.run.runId, status: snapshot.run.status },
        resultObserved: snapshot.steps.some(step => step.artifacts.length > 0), configurationRevision, observation };
    },
    async readTaskMetadataOriginal(value: unknown) {
      const found = await observe(() => producer.readCreation(structuredClone(value)));
      if (!found.task) throw unavailable();
      // Observing metadata must not construct an execution host, register
      // inputs or require a working Gateway/resource writer.
      const taskId = found.task.taskId, authorization = composePersistedTaskAuthorization(input);
      const before = await observe(() => authorization.tasks.resolveAccess(taskId, 'read_metadata'));
      const metadata = await observe(() => authorization.tasks.readMetadata(taskId));
      if ((await observe(() => authorization.tasks.resolveAccess(taskId, 'read_metadata'))).bindingKey !== before.bindingKey) throw denied();
      return metadata;
    },
    async startOriginal(value: unknown, signal?: AbortSignal) {
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      const { task, root } = await observe(() => originalTask(structuredClone(value)), signal);
      return root.application.start({ taskId: task.taskId, runId: task.runId }, signal);
    },
    async inspectOriginal(value: unknown) {
      const { task, root } = await observe(() => originalTask(structuredClone(value)));
      return root.application.inspect({ taskId: task.taskId, runId: task.runId });
    },
    async requestCancellationOriginal(value: unknown) {
      const parsed = originalCancellationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { creationKey, inputRef, expectedRevision } = parsed.data;
      const { root } = await observe(() => originalTask({ creationKey, inputRef }));
      return root.requestCancellation({ expectedRevision });
    },
    async reconcileOriginal(value: unknown, signal?: AbortSignal) {
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      const { task, root } = await observe(() => originalTask(structuredClone(value)), signal);
      const before = await observe(() => root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), signal);
      const snapshot = await observe(() => root.recovery.read({ taskId: task.taskId, runId: task.runId }), signal);
      const verifyReader = async () => {
        if ((await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata')).bindingKey !== before.bindingKey) throw denied();
      };
      await observe(verifyReader, signal);
      // Terminal tasks and never-started work are read-only. Recovery does not
      // turn QUEUED into a fresh start, nor claim a completed run's lease.
      if (!snapshot.plan || !['running', 'waiting_external', 'cancel_requested'].includes(snapshot.task.status)
        || !['queued', 'running'].includes(snapshot.run.status)) return { kind: 'not_started', reason: 'task_not_runnable' } as const;
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      // The original runner owns bounded acquisition, CAS and cleanup. A lost
      // claim reply cannot be reconstructed from a lease read, and recovery
      // never calls the preparation or provider execution path.
      const outcome = await root.runner.run({ taskId: task.taskId, runId: task.runId, ...host,
        expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
        expectedFencingToken: snapshot.run.fencingToken, recovery: true }, signal);
      await observe(verifyReader, undefined, true);
      return { kind: 'run_outcome' as const, outcome };
    },
    async preflightOriginal(value: unknown) {
      const { task, root } = await observe(() => originalTask(structuredClone(value)));
      const result = await observe(() => input.probe.preflightCurrent(structuredClone(task.command)));
      await observe(() => root.authorization.tasks.readMetadata(task.taskId));
      return result;
    },
    async readCapabilityReceipt(value: unknown) {
      const { task, root } = await observe(() => originalTask(structuredClone(value)));
      // Receipt reconciliation may persist capability evidence. It is not a
      // read-only observation or proof that a timed-out publication was absent.
      const result = await observe(() => input.probe.reconcileCurrent(structuredClone(task.command)), undefined, true);
      await observe(() => root.authorization.tasks.readMetadata(task.taskId), undefined, true);
      // The original capability receipt, not a runner success flag, determines
      // verified/unverified status. Re-reading it cannot dispatch a probe.
      return result;
    },
  });
  return workflow;
}
