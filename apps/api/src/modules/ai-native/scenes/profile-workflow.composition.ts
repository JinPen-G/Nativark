/** Explicit ordinary-name workflow from an immutable change to one original
 * creation receipt and durable host. Human decisions/continuations are separate
 * mutations. No controller, policy mutation, generated action or implicit retry. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeApprovedProfileApplication } from '../approval-execution/approved-profile-application.composition';
import { composeProfileTaskCreation } from '../approval-execution/profile-task-creation.composition';
import { ApprovedProfileTaskAuthority, profileDenied, profileConflict, profileUnavailable,
  type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { profileChangeInputSchema, aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { composeTaskProfileHost } from '../runner/profile-task-host.composition';
import { snapshotAiTaskRunnerClaimLease, AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from '../runner/prisma-task-application';
import { composeAiProfileBusinessConsumer } from './profile-business-consumer.composition';
import { composeProfileReconfirmation } from './profile-reconfirmation.composition';
import { composeProfileTaskObservation } from './profile-task-observation.composition';
import { composeProfileTaskActionPolicies } from './profile-task-policies.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import type { AiTaskRunnerRecoveryLease } from '../runner/ai-task-runner.ports';

export function composeProfileWorkflow(d: ApprovedProfileApplicationDependencies, host: AiTaskApplicationHost,
  taskPolicyConfiguration: { executionEnabled: boolean; ttlMs: number } = { executionEnabled: false, ttlMs: 120000 }) {
  host = Object.freeze(structuredClone(host));
  if (host.holderId !== d.holderId) throw profileDenied();
  const app = composeApprovedProfileApplication(d), creation = composeProfileTaskCreation(d), authority = new ApprovedProfileTaskAuthority(d);
  const taskPolicies = composeProfileTaskActionPolicies(d, taskPolicyConfiguration);
  const authorization = composePersistedTaskAuthorization(d);
  const transitions = new AiTaskTransitionRepository(d.db, authorization.authority, d.clock);
  // Cancellation and receipt reads must not construct an execution host or
  // require a live plan policy for a never-started original task.
  const canonical = async (value: unknown) => {
    const reference = profileChangeInputSchema.parse(structuredClone(value)), receipt = await creation.read(reference);
    if (!('task' in receipt.receipt) || receipt.receipt.state !== 'observed' || !receipt.receipt.task) throw profileUnavailable();
    const task = receipt.receipt.task, before = await authority.resolve(task.taskId, 'read');
    const verify = async () => {
      const current = await creation.read(reference);
      if (!('task' in current.receipt) || current.receipt.state !== 'observed' || !current.receipt.task
        || current.receipt.task.taskId !== task.taskId || current.receipt.task.runId !== task.runId
        || requestFingerprint(current.original) !== requestFingerprint(receipt.original)
        || (await authority.resolve(task.taskId, 'read')).access.bindingKey !== before.access.bindingKey) throw profileDenied();
    };
    await verify();
    return { reference, task, before, verify };
  };
  const reconfirmation = composeProfileReconfirmation(d, canonical);
  const target = async (value: unknown) => {
    const found = await canonical(value), { reference, task, before } = found;
    const saved = await d.db.aiTaskRunPlan.findFirst({ where: { scopeId: before.scopeId, taskId: task.taskId, runId: task.runId } });
    let limits;
    if (saved) {
      const plan = aiTaskRunPlanSchema.parse(saved.payload);
      if (plan.taskId !== task.taskId || plan.runId !== task.runId || requestFingerprint(plan) !== saved.planHash
        || plan.steps.length !== 1 || plan.steps[0].toolCode !== 'membership.profile.commit'
        || plan.steps[0].registrationRef !== `profile-change:${reference.changeId}`) throw profileDenied();
      limits = plan.limits;
    } else {
      const policy = await d.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: before.scopeId, sceneCode: d.scene.code, sceneVersion: d.scene.version } });
      const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools);
      if (!policy || !tools.success || !tools.data.some(tool => tool.code === 'membership.profile.commit' && tool.version === AI_TOOL_DRAFT_VERSION)) throw profileUnavailable();
      limits = aiTaskRunnerLimitsSchema.parse(policy.limits);
    }
    const root = composeTaskProfileHost({ ...d, host, task: { taskId: task.taskId, runId: task.runId,
      registrationRef: `profile-change:${reference.changeId}`, change: reference, limits } });
    await found.verify();
    return { ...found, root };
  };
  const observation = async (value: unknown) => {
    const found = await target(value), { reference, task, root } = found;
    const snapshot = await root.application.inspect({ taskId: task.taskId, runId: task.runId });
    const steps = snapshot.steps.filter(row => row.toolCode === 'membership.profile.commit' && row.inputRef === reference.changeId && row.fingerprint === reference.changeHash);
    if (steps.length !== 1) throw profileUnavailable();
    const step = steps[0];
    // Same server-owned binding as the original executor. This locates a stored
    // proposal only; no invented lease is needed for a released/terminal run.
    const digest = requestFingerprint({ scopeId: found.before.scopeId, taskId: task.taskId, runId: task.runId,
      stepId: step.stepId, actionId: step.actionId, inputRef: reference.changeId, fingerprint: reference.changeHash });
    const preparation = { taskId: task.taskId, runId: task.runId, stepId: step.stepId,
      proposalId: `ap-${digest.slice(0, 32)}`, proposalRevision: 1 as const, ...reference };
    const { runId: _, ...body } = preparation;
    const prepared = await root.profile.application.readPreparationReceipt(body);
    if (prepared.state !== 'prepared') throw profileUnavailable();
    const consumer = composeAiProfileBusinessConsumer({ ...d, profileHost: root }), result = await consumer.read({ preparation });
    await found.verify();
    return { ...found, proposalReference: prepared.reference, preparation, consumer, result };
  };
  const taskObservation = composeProfileTaskObservation(d, canonical, async (reference, detail) => {
    const found = await canonical(reference), step = detail.steps[0];
    if (!step) throw profileUnavailable();
    const digest = requestFingerprint({ scopeId: found.before.scopeId, taskId: found.task.taskId, runId: found.task.runId,
      stepId: step.stepId, actionId: step.actionId, inputRef: reference.changeId, fingerprint: reference.changeHash });
    const prepared = await app.readPreparationReceipt({ taskId: found.task.taskId, stepId: step.stepId,
      proposalId: `ap-${digest.slice(0, 32)}`, proposalRevision: 1, ...reference });
    await found.verify();
    // Only the original authorized absence response is unavailable. Permission,
    // corruption or storage errors still fail closed; no R1 reference is invented.
    return prepared.state === 'prepared' ? (await observation(reference)).result : null;
  });
  const deliverMutation = async <T>(found: Pick<Awaited<ReturnType<typeof canonical>>, 'verify'>, result: T) => {
    try { await found.verify(); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    return result;
  };
  const cancellationSchema = profileChangeInputSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
  const cancellation = async (value: unknown, mode: 'request' | 'settle_unstarted' | 'read_request' | 'read_settlement') => {
    const command = cancellationSchema.parse(structuredClone(value)), { expectedRevision, ...reference } = command;
    const found = await canonical(reference), original = { taskId: found.task.taskId, expectedRevision };
    const mutating = mode === 'request' || mode === 'settle_unstarted';
    if (mutating) {
      await authorization.authority.resolve(found.task.taskId, 'transition_task');
      await found.verify();
    }
    let receipt;
    try {
      receipt = mode === 'request' ? await transitions.transition({ ...original, to: 'cancel_requested', reason: 'cancel_requested' })
        : mode === 'settle_unstarted' ? await transitions.settleUnstartedCancellation({ ...original, to: 'cancelled', reason: 'cancel_settled' }, found.task.runId)
          : mode === 'read_request' ? await transitions.readCancellationReceipt(original) : await transitions.readCancellationSettlementReceipt(original);
    } catch (error) {
      // A returned CAS conflict is the repository's definite rejection. Other
      // failures after delegation may have followed its original metadata COMMIT.
      if (mutating && (!(error && typeof error === 'object' && 'code' in error) || !['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(String(error.code))))
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      throw error;
    }
    const result = { receipt, cancellation: 'not_business_rollback' as const, automaticRetry: false as const,
      businessWrite: 'not_attempted_by_cancellation' as const };
    if (mutating) return deliverMutation(found, result);
    await found.verify(); return result;
  };
  return Object.freeze({ ...reconfirmation, ...taskObservation, prepareChange: app.prepareChange, readCurrent: app.readCurrent, readChange: app.readChangeReceipt,
    createTask: creation.create, readCreation: creation.read,
    configureTaskActions: taskPolicies.configure, readTaskActionAdmission: taskPolicies.read,
    requestCancellation: (value: unknown) => cancellation(value, 'request'),
    settleUnstartedCancellation: (value: unknown) => cancellation(value, 'settle_unstarted'),
    readCancellation: (value: unknown) => cancellation(value, 'read_request'),
    readCancellationSettlement: (value: unknown) => cancellation(value, 'read_settlement'),
    async recoverOriginal(value: unknown, signal?: AbortSignal) {
      const reference = profileChangeInputSchema.parse(structuredClone(value));
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const found = await waitForTaskApplicationDependency(() => target(reference), false, signal);
      const task = await found.root.authorization.tasks.readMetadata(found.task.taskId);
      const run = await d.db.aiRun.findFirst({ where: { id: found.task.runId, taskId: found.task.taskId, scopeId: found.before.scopeId } });
      if (!run) throw profileDenied();
      const command = { taskId: found.task.taskId, runId: found.task.runId, holderId: host.holderId, leaseMs: host.leaseMs,
        expectedTaskRevision: task.revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
      await found.verify();
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      let lease: AiTaskRunnerRecoveryLease;
      try {
        const received = structuredClone(await waitForTaskApplicationDependency(() => found.root.authorization.tasks.claimRecoveryRun(command), true, signal));
        if (received.purpose !== 'recovery_only') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        lease = { ...snapshotAiTaskRunnerClaimLease(command, received), purpose: received.purpose };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'AI_STORAGE_UNAVAILABLE') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      }
      if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      // Pass ONLY the acknowledged CAS tuple to the original recovery engine.
      // Do not query a held lease back into execute/continue after losing ACK.
      const outcome = await found.root.runner.recover(lease, signal);
      return deliverMutation(found, { kind: 'run_outcome' as const, outcome, execution: 'recovery_only_no_redispatch' as const });
    },
    async start(value: unknown, signal?: AbortSignal) {
      const found = await waitForTaskApplicationDependency(() => target(value), false, signal);
      const result = await found.root.application.start({ taskId: found.task.taskId, runId: found.task.runId }, signal);
      return deliverMutation(found, result);
    },
    async read(value: unknown) { return (await observation(value)).result; },
    async humanHandoff(value: unknown) {
      const found = await observation(value); return found.consumer.humanHandoff({ preparation: found.preparation });
    },
    async decide(value: unknown) {
      const command = profileChangeInputSchema.extend({ decision: z.enum(['approve', 'reject']) }).strict().parse(structuredClone(value));
      const { decision, ...reference } = command, found = await observation(reference);
      if (!found.result.confirmation) throw profileUnavailable();
      const result = await found.root.profile.application.decide({ ...found.proposalReference, decision });
      return deliverMutation(found, result);
    },
    async continueConfirmation(value: unknown, signal?: AbortSignal) {
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const found = await waitForTaskApplicationDependency(() => observation(value), false, signal);
      const checkpoint = found.result.confirmation;
      if (!checkpoint || found.result.decision?.state !== 'recorded') throw profileUnavailable();
      const run = await d.db.aiRun.findFirst({ where: { id: found.task.runId, taskId: found.task.taskId, scopeId: found.before.scopeId } });
      const task = await found.root.authorization.tasks.readMetadata(found.task.taskId);
      if (!run) throw profileDenied();
      const command = { taskId: found.task.taskId, runId: found.task.runId, holderId: host.holderId, leaseMs: host.leaseMs,
        expectedTaskRevision: task.revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
      // Only a positive original CAS acknowledgement is usable. A lost claim
      // response is unknown; it is never recovered by reading a lease to execute.
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      snapshotAiTaskRunnerClaimLease(command, await waitForTaskApplicationDependency(() => found.root.authorization.tasks.claimRecoveryRun(command), true, signal));
      const result = await found.root.application.continueConfirmation({ taskId: found.task.taskId, runId: found.task.runId,
        checkpointRef: checkpoint.checkpointRef }, signal);
      return deliverMutation(found, result);
    }
  });
}
