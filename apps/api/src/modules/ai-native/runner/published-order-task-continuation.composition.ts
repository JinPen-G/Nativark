/** Explicit continuation of an existing published order-only plan. Reuses the
 * original host, approval, lease CAS and cumulative budget. No start/reconcile,
 * input/plan publication, policy seed or retry of an unknown action is exposed. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { taskCenterContinueSchema } from '../task-center-continuation.composition';
import { composeTaskOrderHost, type TaskOrderHostDependencies } from './order-task-host.composition';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './prisma-task-application';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from './ai-task-runner.service';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const configurationSchema = z.object({ host: z.object({ holderId: id, leaseMs: z.number().int().min(1).max(120000) }).strict(),
  limits: aiTaskRunnerLimitsSchema }).strict();
type Configuration = z.infer<typeof configurationSchema>;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export function composePublishedOrderTaskContinuation(d: ControlledApprovedOrderDependencies & Pick<TaskOrderHostDependencies, 'monotonic'>,
  value: Configuration) {
  const parsed = configurationSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw unavailable();
  const configuration = parsed.data;
  const authorization = composePersistedTaskAuthorization(d);
  const observe = <T>(work: () => Promise<T>, signal?: AbortSignal, mutated = false) =>
    waitForTaskApplicationDependency(work, mutated, signal, d.runnerClock);
  return Object.freeze({
    async continueConfirmation(raw: unknown, signal?: AbortSignal) {
      const input = taskCenterContinueSchema.safeParse(structuredClone(raw));
      if (!input.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = input.data;
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const access = await observe(() => authorization.tasks.resolveAccess(command.taskId, 'read_metadata'), signal);
      const task = await observe(() => d.db.aiTask.findFirst({ where: access.where }), signal);
      if (!task || task.id !== command.taskId || task.inputRef !== null || task.status !== 'WAITING_CONFIRMATION'
        || task.cancelRequestedAt !== null || task.sceneCode !== d.scene.code || task.sceneVersion !== d.scene.version) throw denied();
      if (task.revision !== command.expectedTaskRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const key = { scopeId: task.scopeId, taskId: task.id, runId: command.runId };
      const saved = await observe(() => d.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } }), signal);
      if (!saved) throw unavailable();
      const plan = aiTaskRunPlanSchema.parse(saved.payload);
      if (saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
        || plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash
        || !plan.steps.length || plan.steps.some(row => row.toolCode !== 'rental.order.commit'
          || row.toolVersion !== AI_TOOL_DRAFT_VERSION || row.operation !== 'idempotent')
        || requestFingerprint(plan.limits) !== requestFingerprint(configuration.limits)) throw denied();
      const root = composeTaskOrderHost({ ...d, host: configuration.host, monotonic: d.monotonic, runnerClock: d.runnerClock,
        task: { taskId: key.taskId, runId: key.runId, registrationRef: plan.steps[0].registrationRef, limits: plan.limits } });
      const verify = async () => {
        const current = await authorization.tasks.resolveAccess(key.taskId, 'read_metadata');
        const latest = await d.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
        if (current.bindingKey !== access.bindingKey || !latest || latest.planHash !== saved.planHash
          || requestFingerprint(latest.payload) !== saved.planHash) throw denied();
      };
      const waiting = await root.application.readConfirmation({ taskId: key.taskId, runId: key.runId, stepId: command.stepId });
      if (waiting.checkpointRef !== command.checkpointRef || waiting.taskRevision !== command.expectedTaskRevision
        || requestFingerprint(waiting.proposal) !== requestFingerprint(command.proposal)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const view = await observe(() => root.orders.approvals.readProposal(key.taskId, waiting.proposal), signal);
      // The standard human host has no independent enterprise payer authority.
      // An approval from another path must not silently widen this consumer.
      if (view.facts.input.payload.bookingIdentity?.enterpriseContractAndPayer === true) throw unavailable();
      const decision = view.proposal.status === 'cancelled' ? 'reject' as const : 'approve' as const;
      const approved = await observe(() => root.orders.approvals.readReceipt(key.taskId, { ...waiting.proposal, decision }), signal);
      if (approved.kind !== 'recorded' || approved.record.decision !== (decision === 'reject' ? 'rejected' : 'approved')) throw unavailable();
      const claimAccess = await observe(() => authorization.tasks.resolveAccess(key.taskId, 'claim_recovery_run'), signal);
      const currentTask = await observe(() => d.db.aiTask.findFirst({ where: claimAccess.where }), signal);
      const run = await observe(() => d.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } }), signal);
      if (!currentTask || currentTask.revision !== command.expectedTaskRevision || currentTask.status !== 'WAITING_CONFIRMATION'
        || currentTask.cancelRequestedAt !== null || !run || run.status !== 'RUNNING'
        || run.actorKind !== claimAccess.actorKind || run.actorId !== claimAccess.actorId) throw denied();
      await observe(verify, signal);
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      // Only the original current CAS grants a fresh continuation lease. A lost
      // claim reply grants no cleanup permission and never enters the runner.
      const lease = await observe(() => root.authorization.tasks.claimRecoveryRun({ taskId: key.taskId, runId: key.runId,
        ...configuration.host, expectedTaskRevision: currentTask.revision, expectedRunRevision: run.revision,
        expectedFencingToken: run.fencingToken.toFixed(0) }), signal, true);
      let cleanupSafe = true, failed = false;
      try {
        await observe(verify, signal);
        if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
        cleanupSafe = false;
        const result = await root.application.continueConfirmation({ taskId: key.taskId, runId: key.runId,
          checkpointRef: command.checkpointRef }, signal);
        cleanupSafe = result.kind === 'not_started';
        await observe(verify, undefined, true);
        return result;
      } catch (error) { failed = true; throw error; }
      finally {
        if (cleanupSafe) {
          try {
            await callAiTaskRunnerDependency(async child => {
              const held = await d.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
                leaseOwnerId: configuration.host.holderId, fencingToken: lease.fencingToken, revision: lease.revision } });
              if (child.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
              if (held) {
                const current = await root.authorization.tasks.readMetadata(key.taskId);
                if (child.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
                await root.authorization.tasks.releaseRun({ taskId: key.taskId, runId: key.runId, holderId: configuration.host.holderId,
                  expectedTaskRevision: current.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
              }
            }, 5000, 'published_order_continuation_cleanup', undefined, d.runnerClock);
          } catch { if (!failed) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
        }
      }
    }
  });
}
