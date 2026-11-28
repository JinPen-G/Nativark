/** Compose the original persistent Runner for the registered text check.
 * The host publishes one fixed input; only the original Gateway can send it. */
import { randomUUID } from 'node:crypto';
import type { AiStep, AiTaskResultArtifact, AiTaskExecutionCharge, PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { AI_TASK_TERMINAL_STATUSES_DRAFT } from '@rental-os/platform-contracts/ai-task';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { createPersistentAiTaskRunner, withAiTaskHeldPreparationDefinition, type AiTaskRunnerLease,
  type AiTaskPreparationDefinition, type AiTaskRunnerPlan } from '@rental-os/platform-server/ai-runtime';
import { gatewayRoutingBinding, type GatewayCapacityPort } from '@rental-os/platform-server/ai-gateway';
import { createPublicAiTaskMeasuredRunnerPorts } from '../task-measured-effects';
import { createPublicTenantTaskGateway } from '../public-tenant-gateway';
import { createPublicAiTaskRunnerStepPorts, createPublicAiTaskSteps, type AiStepRegistrationCommand,
  type AiStepTransitionCommand, type AiTaskRunnerRepositoryCommandFactory } from '../task-steps';
import { aiTaskRunPlanSchema, type TaskRunPlanAuthority } from '../task-runner-resources';
import { TaskStepEvidenceAuthority } from '../runtime/runner/task-step-evidence.authority';
import { createPublicAiTaskTransitions, createPublicAiTaskRunnerOutcomePort } from '../task-transitions';
import { readPublicTenantModelInput } from '../runtime/model-input/public-tenant-model-invocation';
import { readModelNonDispatchEvidence } from '../runtime/model-input/prisma-model-nondispatch.evidence';
import { textProbeIntent } from '../runtime/text-capability-probe';
import { gatewayTenantBudgetPrincipal } from '../runtime/budget/gateway-budget-principal';
import type { createPublicAiTaskPersistence } from '../task-persistence';
import type { createAiTaskTransactionBoundary } from '../task-transactions';
import type { createPublicTenantInvocationConfiguration } from '../model-configuration';
import type { PublicModelAdapter } from '../model-adapters';
import type { WorkCenterConversations } from './conversations';
import type { WorkCenterDiagnostic } from './diagnostic';
import type { WorkCenterTaskAuthority } from './task-authority';
import { WorkCenterUnknownError, admitsTool, conflict, denied, leaseMs, registrationRef, retentionMs, sceneBinding, step,
  transactionOptions, unavailable, type BoundAuthority, type Tx } from './scene';
import { diagnosticArtifact } from './task-results';

type TaskObjects = Awaited<ReturnType<WorkCenterTaskAuthority['originalForTask']>>;
type Ref = { taskId: string; runId: string; expectedRevision: number };

export function createWorkCenterRunner(input: { db: PrismaClient; authority: BoundAuthority; tasks: ReturnType<typeof createPublicAiTaskPersistence>;
  taskAuthority: WorkCenterTaskAuthority; conversations: WorkCenterConversations; diagnostic: WorkCenterDiagnostic;
  configuration: ReturnType<typeof createPublicTenantInvocationConfiguration>; transactions: ReturnType<typeof createAiTaskTransactionBoundary<Tx>>;
  adapters: readonly PublicModelAdapter[]; transport: 'live' | 'mock'; capacity: GatewayCapacityPort;
  clock: () => Date; signal: AbortSignal }) {
  const { db, authority, taskAuthority, conversations, diagnostic, configuration, transactions, clock, signal, tasks } = input;
  const once = <T>(work: () => Promise<T>) => transactions.withAiTaskTransactionAuthority(authority.transaction, work);
  const original = async (taskId: string, operation: 'transition_task' | 'read_step_terminal', tx?: Tx) => {
    const context = await (tx ? authority.actionOn(tx, taskId, operation) : authority.actions.resolve(taskId, operation));
    return { context, ...await taskAuthority.originalForTask(conversations, context, taskId, tx) };
  };

  async function definition(task: TaskObjects, runId: string, tx?: Tx): Promise<AiTaskPreparationDefinition> {
    const current = await taskAuthority.liveOriginal(conversations, task.who, task.inputRef, tx);
    if (tx) await diagnostic.verifyNative(tx, task.who.tenantId, task.input);
    if (task.row.cancelRequestedAt || task.source.contentHash !== current.row.contentHash || signal.aborted) throw denied();
    return { taskId: task.row.id, runId, steps: [{ ...step, registrationRef: registrationRef(task.inputRef) }],
      limits: current.current.limits, bindingHash: hash({ input: task.source.contentHash, policy: current.current.hash,
        scope: task.who.scopeId, subject: task.who.binding, entitlement: current.entitlementRevision }) };
  }

  const proof = async (plan: AiTaskPreparationDefinition | AiTaskRunnerPlan, lease: AiTaskRunnerLease, tx?: Tx) => {
    const task = await original(lease.taskId, 'transition_task', tx), expected = await definition(task, lease.runId, tx);
    const { bindingHash, ...base } = expected;
    const actual = 'bindingHash' in plan ? plan : { taskId: plan.taskId, runId: plan.runId, steps: plan.steps, limits: plan.limits };
    if (hash(actual) !== hash('bindingHash' in plan ? expected : base)) throw denied();
    // Resource lookups intentionally omit the deadline from their lease view.
    // The original Runner checks that held Run separately; the plan proof owns
    // only the persisted source/policy deadline.
    return { authorityHash: bindingHash, policyVersion: `text-plan:${task.source.policyRevision}`, expiresAt: task.source.expiresAt.toISOString() };
  };
  const planAuthority: Required<TaskRunPlanAuthority> = { authorize: proof, authorizePreparation: proof };

  async function registered(command: AiStepRegistrationCommand, readOnly: boolean, tx?: Tx) {
    const reader = tx ?? db;
    const task = await original(command.taskId, readOnly ? 'read_step_terminal' : 'transition_task', tx);
    const key = { scopeId: task.who.scopeId, taskId: task.row.id, runId: command.lease.runId };
    const saved = await reader.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    const plan = aiTaskRunPlanSchema.safeParse(saved?.payload), ref = registrationRef(task.inputRef);
    if (!saved || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId || !plan.success
      || saved.planHash !== hash(plan.data) || plan.data.taskId !== key.taskId || plan.data.runId !== key.runId
      || command.registrationRef !== ref || hash(plan.data.steps) !== hash([{ ...step, registrationRef: ref }])) throw denied();
    const row = await reader.aiTaskActionInput.findUnique({ where: { scopeId_taskId_runId_registrationRef: { ...key, registrationRef: ref } } });
    const challenge = textProbeIntent(task.input.command.operationId, key.scopeId, 'text');
    if (!row || row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId || row.registrationRef !== ref
      || !admitsTool(row.toolCode, row.toolVersion) || row.fingerprint !== challenge.intentHash || row.policyRevision !== task.source.policyRevision)
      throw unavailable();
    if (!readOnly) {
      const current = await definition(task, key.runId, tx);
      if (saved.authorityHash !== current.bindingHash || row.expiresAt.getTime() !== task.source.expiresAt.getTime()) throw denied();
    }
    return { context: task.context, taskId: key.taskId, registrationRef: ref, toolCode: row.toolCode, toolVersion: row.toolVersion,
      inputRef: row.id, requestFingerprint: row.fingerprint, authorizationKey: hash({ planHash: saved.planHash, action: row.id, body: hash(row.payload) }),
      expiresAt: row.expiresAt.toISOString() };
  }
  const registrations = {
    async resolve(command: AiStepRegistrationCommand, tx?: Tx) {
      return { ...await registered(command, false, tx), registrationAllowed: true as const };
    },
    async resolveOriginal(command: AiStepRegistrationCommand, tx?: Tx) {
      const { expiresAt: _, ...value } = await registered(command, true, tx);
      return { ...value, registrationAllowed: false as const };
    }
  };
  class TextStepEvidence extends TaskStepEvidenceAuthority<typeof step.toolCode> {
    protected readonly modelStep = true;
    protected accepts(row: AiStep, operation: string) { return admitsTool(row.toolCode, row.toolVersion) && operation === step.operation; }
    protected current(taskId: string, reason: AiStepTransitionCommand['reason'], tx?: Tx) {
      const operation = reason === 'start' ? 'transition_task' : 'read_step_terminal';
      return tx ? authority.actionOn(tx, taskId, operation) : authority.actions.resolve(taskId, operation);
    }
    protected planTransaction(tx?: Tx) { return tx; }
    protected async additionalEvidence(row: AiStep, artifact: AiTaskResultArtifact | null, charges: AiTaskExecutionCharge[], context: AiExecutionContext, tx?: Tx) {
      if (!artifact) {
        const published = await readPublicTenantModelInput(tx ?? db, row, context, sceneBinding, clock);
        return hash(published.prepared.intentHash);
      }
      if (!artifact.completeMeasurement) return null;
      const call = charges.find(charge => charge.resource === 'CALLS');
      const reader = tx ?? db;
      const invocation = call?.gatewayInvocationId && await reader.aiGatewayInvocation.findFirst({ where: { id: call.gatewayInvocationId,
        scopeId: row.scopeId, taskId: row.taskId, runId: row.runId, stepId: row.id } });
      if (!invocation || invocation.actionId !== row.actionId || invocation.stepFingerprint !== row.requestFingerprint) throw unavailable();
      if (artifact.outcome === 'FAILED') {
        const principal = gatewayTenantBudgetPrincipal(context);
        const evidence = await readModelNonDispatchEvidence(reader, { scopeId: row.scopeId, scopeKind: 'TENANT',
          actorId: principal.actorId, tenantId: principal.tenantId }, invocation);
        if (!evidence) throw unavailable();
        return evidence.proofHash;
      }
      const result = diagnosticArtifact.parse(artifact.payload);
      if (!result.receiptId || result.callId !== invocation.callId) throw unavailable();
      const principal = gatewayTenantBudgetPrincipal(context);
      return diagnostic.terminalEvidence(reader, { receiptId: result.receiptId, check: result.check, callId: result.callId,
        stepId: row.id, runId: row.runId, scopeId: row.scopeId, tenantId: principal.tenantId, ownerId: principal.actorId });
    }
  }

  const steps = createPublicAiTaskSteps({ db, transactions, registration: registrations, admitsTool,
    replay: { resolve: (command, tx) => tx ? authority.actionOn(tx, command.taskId, 'read_step_terminal')
      : authority.actions.resolve(command.taskId, 'read_step_terminal') },
    transition: new TextStepEvidence(db, authority.actions, { ...planAuthority, resolveOriginal: registrations.resolveOriginal }, clock),
    delivery: authority.actions, clock });
  const leaseInput = ({ runId, holderId, revision, fencingToken }: AiTaskRunnerLease) => ({ runId, holderId, revision, fencingToken });
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      if (!admitsTool(plan.toolCode, plan.toolVersion) || plan.operation !== step.operation) throw unavailable();
      const metadata = await tasks.readMetadata(lease.taskId);
      return { taskId: lease.taskId, registrationRef: plan.registrationRef, expectedTaskRevision: metadata.revision, lease: leaseInput(lease) };
    },
    transition(kind, ref, lease, resultRef) {
      if (kind === 'pause' || !admitsTool(ref.plan.toolCode, ref.plan.toolVersion) || kind !== 'start' && !resultRef) throw unavailable();
      return { taskId: lease.taskId, stepId: ref.registered.stepId, expectedTaskRevision: ref.registered.taskRevision,
        expectedStepRevision: ref.registered.stepRevision, evidenceId: kind === 'start' ? `start-${ref.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed', lease: leaseInput(lease) };
    }
  };

  const transitions = createPublicAiTaskTransitions({ db, transactions, authority, clock });
  const outcome = createPublicAiTaskRunnerOutcomePort(transitions, tasks);

  function gateway(task: TaskObjects) {
    const budgetGrant = taskAuthority.budgetGrant(conversations, authority);
    return createPublicTenantTaskGateway({ db, authority, transactions, scene: sceneBinding, selection: configuration,
      diagnostic: diagnostic.hooks(task.input),
      connections: { tenant: configuration.tenantConnection, platform: { async resolve() { throw unavailable(); } } },
      adapters: input.adapters, capacity: input.capacity, evidence: input.transport, clock, budgetGrant });
  }

  function runtime(task: TaskObjects) {
    const executor = gateway(task);
    const measured = createPublicAiTaskMeasuredRunnerPorts({ db, scopes: authority.resourceScopes, transactions, planAuthority,
      actions: authority.actions, execution: { authorize: id => authority.actions.resolve(id, 'transition_task') },
      invocations: executor.invocations, dispatchEvidence: executor.dispatchEvidence,
      toolCatalog: { async resolve(code, version) { return admitsTool(code, version) ? { modelCall: true } : null; } },
      tools: { async resolve(code, version) {
        const tool = await executor.tools.resolve(code, version);
        if (!tool) return null;
        return { operation: tool.operation, async execute(command, signal) {
          const result = await tool.execute(command, signal);
          // The check has a fixed success signal. Supplier text and model
          // credentials are never needed in the artifact or across clients.
          const challenge = textProbeIntent(task.input.command.operationId, task.who.scopeId, 'text');
          const minimal = { version: 'public-text-artifact-1' as const, callId: challenge.intent.requestId,
            check: 'unverified' as const, receiptId: null };
          if (result.kind !== 'succeeded') return { kind: result.kind === 'failed' ? 'failed' : 'unknown',
            ...(result.kind === 'failed' ? { errorCode: 'AI_PROVIDER_UNAVAILABLE' } : {}), payload: minimal };
          if (signal.aborted) return { kind: 'unknown', payload: minimal };
          const proof = await db.$transaction(tx => transactions.withAiTaskTransaction(tx, { kind: 'task', taskId: task.row.id }, async () => {
            if (signal.aborted) throw denied();
            const saved = await diagnostic.publish(tx, task.who.scopeId, task.input, task.who.tenantId);
            if (signal.aborted) throw denied();
            return saved;
          }), transactionOptions);
          if (!proof.receiptId) return { kind: 'unknown', payload: minimal };
          return { kind: 'succeeded', payload: { ...minimal, ...proof } };
        } };
      } }, wall: clock });
    const ports = createPublicAiTaskRunnerStepPorts(steps, { tasks: measured.tasks, commands });
    return { runner: createPersistentAiTaskRunner({ ...ports, plan: measured.plans, effects: measured.effects,
      resources: measured.resources, taskOutcome: outcome }), plans: measured.plans, executor };
  }

  async function readRun(task: TaskObjects, runId: string) {
    const run = await db.aiRun.findFirst({ where: { scopeId: task.who.scopeId, taskId: task.row.id, id: runId, sequence: 1,
      actorKind: 'USER', actorId: task.who.ownerId } });
    if (!run || run.id !== runId || run.taskId !== task.row.id || run.scopeId !== task.who.scopeId || run.actorKind !== 'USER'
      || run.actorId !== task.who.ownerId || run.sequence !== 1 || run.resourceOriginRunId || run.inputReceiptId) throw denied();
    return run;
  }

  async function startOrObserve(ref: Ref, recovery: boolean) {
    const task = await original(ref.taskId, 'read_step_terminal');
    const run = await readRun(task, ref.runId);
    if (task.row.revision !== ref.expectedRevision) throw conflict();
    if (recovery ? AI_TASK_TERMINAL_STATUSES_DRAFT.some(status => status === task.row.status.toLowerCase())
      : task.row.status !== 'QUEUED' || run.status !== 'QUEUED') throw conflict();
    if (!recovery && (run.fencingToken.toFixed(0) !== '0' || run.leaseOwnerId !== null || run.leaseExpiresAt !== null))
      throw new WorkCenterUnknownError();
    const service = runtime(task), command = { taskId: ref.taskId, runId: ref.runId, holderId: `public-text:${randomUUID()}`,
      expectedTaskRevision: task.row.revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0), leaseMs };
    if (recovery) return once(() => service.runner.run({ ...command, recovery: true }, signal));
    const selected = await definition(task, ref.runId), challenge = textProbeIntent(task.input.command.operationId, task.who.scopeId, 'text');
    const { actorKind: _, ...principal } = gatewayTenantBudgetPrincipal(task.context);
    // Resolve the original configured route before touching the Run; a missing
    // credential/profile or unsupported mode cannot become a fresh attempt.
    const route = await service.executor.resolveRoute(principal, ['text']);
    await configuration.tenantConnection.resolve(principal, route.route.profile);
    const prepare = withAiTaskHeldPreparationDefinition(async held => {
      const { bindingHash: _, ...plan } = selected;
      await service.plans.savePlan({ ...plan, taskRevision: held.taskRevision }, held.lease, async (tx, scopeId) => {
        if (held.signal?.aborted || signal.aborted || scopeId !== task.who.scopeId) throw denied();
        const live = await original(task.row.id, 'transition_task', tx);
        if (hash(await definition(live, ref.runId, tx)) !== hash(selected)) throw denied();
        const registration = registrationRef(task.inputRef);
        await tx.aiTaskActionInput.create({ data: { scopeId, taskId: ref.taskId, runId: ref.runId, id: randomUUID(),
          registrationRef: registration, toolCode: step.toolCode, toolVersion: step.toolVersion, fingerprint: challenge.intentHash,
          policyRevision: task.source.policyRevision, expiresAt: task.source.expiresAt,
          payload: JSON.parse(JSON.stringify({ mode: 'invoke', intent: challenge.intent, configuration: task.input.configuration,
            priceVersion: task.input.priceVersion, routingHash: gatewayRoutingBinding(route), identityHash: task.who.binding })) } });
        if (held.signal?.aborted || signal.aborted) throw denied();
      });
    }, selected);
    if (signal.aborted) throw denied();
    return once(() => service.runner.runPrepared(command, prepare, signal));
  }

  return Object.freeze({ start: (ref: Ref) => startOrObserve(ref, false), reconcile: (ref: Ref) => startOrObserve(ref, true) });
}
