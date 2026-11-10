import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext, type AiStepStateDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { AiStepTransitionAuthority, AiStepTransitionCommand, AiStepTransitionGrant } from '../ai-step-transition.repository';
import { PrismaTaskOrderStartAuthority } from './prisma-task-order-start.authority';
import type { AiTaskPlanEvidenceAuthority, PrismaTaskRunEvidenceRepository, AiConfirmationTool } from './prisma-task-run-evidence.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = ({ requestId: _, authorizedAt: __, ...value }: AiExecutionContext) => requestFingerprint(value);
export class PrismaTaskOrderStepAuthority implements AiStepTransitionAuthority {
  private readonly start: PrismaTaskOrderStartAuthority;
  constructor(private readonly db: PrismaClient, private readonly authorization: AiTaskRepositoryAuthority,
    plans: AiTaskPlanEvidenceAuthority, private readonly results: Pick<PrismaTaskRunEvidenceRepository, 'readOrderPhaseResult'>,
    private readonly clock: () => Date = () => new Date(),
    private readonly confirmationTool: AiConfirmationTool = 'rental.order.commit') {
    this.start = new PrismaTaskOrderStartAuthority(db, authorization, plans, clock, confirmationTool);
  }
  async resolve(raw: Readonly<AiStepTransitionCommand>, tx?: Prisma.TransactionClient): Promise<AiStepTransitionGrant> {
    const command = structuredClone(raw);
    if (command.reason === 'start') return this.start.resolve(command);
    const db = tx ?? this.db;
    if (!['result_observed', 'result_unknown', 'reconciled_committed', 'reconciled_not_committed'].includes(command.reason)) throw unavailable();
    const context = await this.authorization.resolve(command.taskId, 'transition_task');
    const access = aiTaskAccessFromContext(context, command.taskId, this.clock());
    const task = await db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== command.taskId || !['RUNNING', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(task.status)) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id, runId: command.lease.runId };
    const run = await db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    const step = await db.aiStep.findFirst({ where: { ...key, id: command.stepId } });
    if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.leaseOwnerId !== command.lease.holderId
      || run.fencingToken.toFixed(0) !== command.lease.fencingToken || run.actorKind !== access.actorKind || run.actorId !== access.actorId
      || !run.leaseExpiresAt || run.leaseExpiresAt <= this.clock() || !['QUEUED', 'RUNNING'].includes(run.status)
      || !step || step.id !== command.stepId || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
      || step.revision !== command.expectedStepRevision || step.toolCode !== this.confirmationTool || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || !['RUNNING', 'UNKNOWN'].includes(step.status) || step.effect !== 'POSSIBLE'
      || (step.status === 'RUNNING' ? step.resultRef !== null || step.errorCode !== null : step.resultRef === null || step.errorCode !== 'AI_RESULT_UNKNOWN')) throw denied();
    // AiStepTransitionRepository has already CAS-locked/incremented this run
    // inside tx. Read its receipt in that transaction, never a second snapshot
    // that sees the old run or waits behind its own locks.
    const lease = { taskId: key.taskId, ...command.lease, revision: command.lease.revision + (tx ? 1 : 0), expiresAt: run.leaseExpiresAt.toISOString() };
    const evidence = await this.results.readOrderPhaseResult(lease, step.id, command.evidenceId, tx);
    if (evidence.step.id !== step.id || evidence.step.revision !== step.revision || evidence.result.resultRef !== command.evidenceId) throw denied();
    const unknown: AiStepStateDraft['outcome'] = { status: 'unknown', effect: 'possible', error: {
      code: 'AI_RESULT_UNKNOWN', message: '业务动作结果待核对，不重新派发。', retryable: false, nextAction: 'reconcile', missingFields: [] } };
    const previous: AiStepStateDraft = { stepId: step.id, runId: step.runId, sequence: step.sequence, revision: step.revision,
      actionId: step.actionId, requestFingerprint: step.requestFingerprint, toolCode: this.confirmationTool, toolVersion: step.toolVersion,
      outcome: step.status === 'UNKNOWN' ? unknown : { status: 'running', effect: 'possible' } };
    let outcome: AiStepStateDraft['outcome'];
    const reported = evidence.receipts.find(receipt => receipt.phaseId === evidence.starts[evidence.starts.length - 1]?.id);
    // Later Core visibility does not invalidate the durable unknown observation being recorded.
    if (command.reason === 'result_unknown' && step.status === 'RUNNING'
      && reported?.id === command.evidenceId && reported.kind === 'unknown' && evidence.result.kind === 'succeeded') {
      outcome = unknown;
    } else if (evidence.result.kind === 'succeeded' && evidence.businessResultRef && evidence.observedAt) {
      if (command.reason !== (step.status === 'UNKNOWN' ? 'reconciled_committed' : 'result_observed')) throw denied();
      // The ordinary-name fact references the immutable operation receipt
      // report, not today's mutable customer object or a configuration.
      outcome = { status: 'succeeded', effect: 'committed', facts: [{ scope: context.scope, resourceType: this.confirmationTool === 'rental.order.commit' ? 'order' : this.confirmationTool === 'membership.profile.commit' ? 'report' : 'configuration', resourceId: evidence.businessResultRef,
        observedAt: evidence.observedAt, basis: { kind: 'current' } }] };
    } else if (evidence.result.kind === 'failed' && ['AI_BUSINESS_REJECTED', 'AI_CANCELLED'].includes(evidence.result.errorCode)) {
      if (command.reason !== (step.status === 'UNKNOWN' ? 'reconciled_not_committed' : 'result_observed')) throw denied();
      const cancelled = evidence.result.errorCode === 'AI_CANCELLED';
      if (cancelled && (task.status !== 'CANCEL_REQUESTED' || task.cancelRequestedAt === null || evidence.consumption
        || evidence.starts.length !== 1 || reported?.kind !== 'confirmation')) throw denied();
      outcome = { status: 'failed', effect: 'none', error: { code: 'AI_BUSINESS_REJECTED',
        message: cancelled ? '原任务已请求取消，原确认阶段证明尚未提交业务变更。' : '原提案已由人工拒绝，未提交业务变更。',
        retryable: false, nextAction: 'manual', missingFields: [] } };
    } else {
      if (evidence.result.kind !== 'unknown' || step.status !== 'RUNNING' || command.reason !== 'result_unknown') throw unavailable();
      outcome = unknown;
    }
    const current = await this.authorization.resolve(command.taskId, 'transition_task');
    if (identity(current) !== identity(context) || run.leaseExpiresAt <= this.clock()) throw denied();
    return { context: current, transitionAllowed: true, taskId: task.id, evidenceId: command.evidenceId, evidenceRevision: step.revision,
      authorizationKey: `persisted-order-${requestFingerprint({ evidence: evidence.evidenceKey, stepRevision: step.revision, reason: command.reason })}`,
      expiresAt: run.leaseExpiresAt.toISOString(), reason: command.reason, previous,
      next: { ...previous, revision: previous.revision + 1, outcome }, previousResultRef: step.resultRef, resultRef: command.evidenceId };
  }
}
