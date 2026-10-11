import type { PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { z } from 'zod';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { composeAuthorizedPersistentTaskInputRunner } from './runner/authorized-persistent-task-input.composition';
import { PrismaTaskPlanInputSource } from './runner/prisma-task-plan-input.source';
import { PrismaTaskRunEvidenceRepository } from './runner/prisma-task-run-evidence.repository';
import { PrismaTaskExecutionScopeAuthority } from './runner/prisma-task-execution-scope.authority';
import { PrismaTaskGatewayInvocationPreparation } from './runner/prisma-task-gateway-invocation.preparation';
import { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import { PrismaTextProbeStepEvidenceAuthority } from './prisma-text-probe-step-evidence.authority';
import { textProbeCommandSchema, TEXT_CAPABILITY_PROBE_TOOL, type TextProbeCommand } from './text-capability-probe';
import type { TextCapabilityProbeApplication } from './text-capability-probe.application';
import type { PersistedBudgetEvidenceSource } from './budget/budget-dependency-adapters';
import type { AiTaskApplicationHost } from './runner/prisma-task-application';
import type { AiTaskHeldPreparation } from './runner/ai-task-runner.service';
import type { AiTaskRunnerRepositoryCommandFactory } from './runner/ai-task-runner.repository-adapter';
import type { AiTaskInputSource } from './task-input/task-input.ports';
import type { AiTaskRegisteredExecutor } from './runner/prisma-task-measured-effects';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef } from './runner/ai-task-runner.ports';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  command: textProbeCommandSchema, priceVersion: id.max(64), limits: aiTaskRunnerLimitsSchema }).strict();
type TextProbeTask = z.infer<typeof taskSchema>;

export type TextCapabilityProbeTaskComposition = Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'> & {
  db: PrismaClient;
  host: AiTaskApplicationHost;
  task: TextProbeTask;
  probe: Pick<TextCapabilityProbeApplication, 'prepare' | 'runHeldCurrent'>;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  clock?: () => Date;
  monotonic?: () => number;
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
  return Object.freeze({ ...root, application });
}

function createRoot(input: TextCapabilityProbeTaskComposition, task: TextProbeTask, clock: () => Date) {
  const authorization = requireAuthorization(input, clock);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock, TEXT_CAPABILITY_PROBE_TOOL);
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db);
  const plans = new PrismaTaskRunEvidenceRepository(input.db, scopes, source, clock);
  const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, clock);
  const gatewayInput = {
    async resolve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
      const access = await authorization.tasks.resolveAccess(lease.taskId, 'transition_task');
      const taskRow = await input.db.aiTask.findFirst({ where: access.where, select: { scopeId: true } });
      const row = taskRow && await input.db.aiStep.findFirst({ where: { scopeId: taskRow.scopeId, taskId: lease.taskId, runId: lease.runId, id: step.registered.stepId } });
      if (!row || !row.inputRef) throw denied();
      const stored = await source.readForExecution({ taskId: lease.taskId, runId: lease.runId, stepId: row.id,
        actionId: row.actionId, inputRef: row.inputRef, fingerprint: row.requestFingerprint, lease });
      const prepared = await input.probe.prepare(stored.context as never, textProbeCommandSchema.parse(stored.input));
      return { stepId: row.id, mode: 'invoke' as const, lease: { runId: lease.runId, holderId: lease.holderId, fencingToken: lease.fencingToken },
        intent: prepared.intent, configuration: prepared.configuration, priceVersion: task.priceVersion,
        expiresAt: new Date(stored.expiresAt) };
    }
  };
  const invocations = new PrismaTaskGatewayInvocationPreparation(bindings, gatewayInput);
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
        const result = await input.probe.runHeldCurrent(textProbeCommandSchema.parse(stored.input),
          { stepId: binding.stepId, lease: binding.lease, priceVersion: task.priceVersion, expiresAt: new Date(stored.expiresAt) }, signal);
        return { kind: 'succeeded' as const, payload: JSON.parse(JSON.stringify(result)) };
      } };
    }
  };
  const inputSource: AiTaskInputSource = { async resolve() { return { kind: 'not_required' as const }; }, async validateAnswers() { throw unavailable(); } };
  const composed = composeAuthorizedPersistentTaskInputRunner({ db: input.db,
    authorization: { auth: input.auth, credentials: input.credentials, subscriptions: input.subscriptions }, registrationAuthority: source,
    transitionAuthority: transition, planAuthority: source, inputSource, commands, executors,
    invocations, financialEvidence: input.financialEvidence, toolCatalog: { resolve: async (code, version) =>
      code === TEXT_CAPABILITY_PROBE_TOOL && version === AI_TOOL_DRAFT_VERSION ? { modelCall: true } : null },
    wall: clock, monotonic: input.monotonic });
  return Object.freeze({ ...composed, authorization, source, plans, invocations, commands, transition, executors, inputSource });
}

function requireAuthorization(input: TextCapabilityProbeTaskComposition, clock: () => Date) {
  return composePersistedTaskAuthorization({ db: input.db, auth: input.auth, credentials: input.credentials,
    subscriptions: input.subscriptions, clock });
}
