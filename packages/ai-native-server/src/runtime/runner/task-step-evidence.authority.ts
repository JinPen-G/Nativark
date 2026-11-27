import type { Prisma, PrismaClient, AiStep, AiTaskResultArtifact, AiTaskExecutionCharge } from '@prisma/client';
import { AI_ERROR_CODES, type AiErrorCode, type AiStepStateDraft } from '@rental-os/platform-contracts/ai-task';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../task-persistence.repository';
import type { AiStepTransitionAuthority, AiStepTransitionCommand, AiStepTransitionGrant } from '../task-step-transition.repository';
import type { AiStepRegistrationCommand, AiStepOriginalRegistrationGrant } from '../task-step-registration.repository';
import { aiTaskRunPlanSchema, type TaskRunPlanAuthority } from './task-run-plan.repository';
import { taskStepChargesValid } from './task-model-count-charge';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge'>;
type PlanEvidence = Pick<TaskRunPlanAuthority, 'authorize'> & {
  resolveOriginal?(command: AiStepRegistrationCommand, transaction?: Prisma.TransactionClient): Promise<AiStepOriginalRegistrationGrant>;
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = ({ authorizedAt: _at, requestId: _id, ...context }: AiExecutionContext) => requestFingerprint(context);

/** The registered host checks the exact tool and its additional evidence.
 * Complete read/model results may finish the original RUNNING step under a
 * newly authorized lease. Business approval and execution stay in their Core.
 * The transition repository retains task/run locks, revision CAS and events.
 */
export abstract class TaskStepEvidenceAuthority<Tool extends string> implements AiStepTransitionAuthority<AiStepStateDraft<Tool>> {
  protected readonly modelStep: boolean = false;
  /** Specialized effect authorities may opt into a durable POSSIBLE marker.
   * This does not add their tools to the readonly ceiling or grant execution. */
  protected get possibleEffect(): boolean { return this.modelStep; }
  protected get startEffect(): 'none' | 'possible' { return this.possibleEffect ? 'possible' : 'none'; }
  protected async additionalEvidence(_step: AiStep, _artifact: AiTaskResultArtifact | null,
    _charges: AiTaskExecutionCharge[], _context: AiExecutionContext, _tx?: Prisma.TransactionClient): Promise<unknown> { return null; }
  protected current(taskId: string, _reason: AiStepTransitionCommand['reason'], _tx?: Prisma.TransactionClient) {
    return this.authorization.resolve(taskId, 'transition_task');
  }
  protected abstract accepts(step: AiStep, operation: string): boolean;
  constructor(private readonly db: Db, private readonly authorization: AiTaskRepositoryAuthority,
    private readonly plans: PlanEvidence, private readonly wall: () => Date = () => new Date()) {
    if (typeof authorization?.resolve !== 'function' || typeof plans?.authorize !== 'function'
      || !['aiTask', 'aiRun', 'aiStep', 'aiTaskRunPlan', 'aiTaskResultArtifact', 'aiTaskExecutionCharge']
        .every(name => typeof (db?.[name as keyof Db] as { findFirst?: unknown } | undefined)?.findFirst === 'function')) throw unavailable();
  }

  async resolve(raw: Readonly<AiStepTransitionCommand>, tx?: Prisma.TransactionClient): Promise<AiStepTransitionGrant<AiStepStateDraft<Tool>>> {
    const command = structuredClone(raw);
    // Inside the transition transaction, evidence reads must share its view:
    // the transition has already CAS-incremented the run revision, so a
    // separate snapshot would see the pre-transition lease and falsely deny.
    const db = tx ?? this.db;
    if (!command?.lease || !['start', 'result_observed', ...(this.possibleEffect ? ['result_unknown'] : [])].includes(command.reason)) throw unavailable();
    const context = structuredClone(await this.current(command.taskId, command.reason, tx));
    const access = aiTaskAccessFromContext(context, command.taskId, this.wall());
    const task = await db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== command.taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || !['RUNNING', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(task.status)) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id, runId: command.lease.runId };
    const run = await db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    if (!run || run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.id !== key.runId
      || run.actorKind !== access.actorKind || run.actorId !== access.actorId || run.leaseOwnerId !== command.lease.holderId
      || run.fencingToken.toFixed(0) !== command.lease.fencingToken || !run.leaseExpiresAt || run.leaseExpiresAt <= this.wall()
      || !['QUEUED', 'RUNNING'].includes(run.status)) throw denied();
    const step = await db.aiStep.findFirst({ where: { ...key, id: command.stepId } });
    const saved = await db.aiTaskRunPlan.findFirst({ where: key });
    if (!step || step.id !== command.stepId || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
      || step.revision !== command.expectedStepRevision || !saved || saved.scopeId !== key.scopeId
      || saved.taskId !== key.taskId || saved.runId !== key.runId) throw denied();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(saved.payload));
    if (plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash) throw denied();
    const matching = plan.steps.filter(p => step.actionId === `ai-action-${requestFingerprint({
      version: 'ai-step-registration-1', scope: access.scope, taskId: key.taskId, registrationRef: p.registrationRef })}`);
    if (matching.length !== 1 || !this.accepts(step, matching[0].operation) || matching[0].toolCode !== step.toolCode
      || matching[0].toolVersion !== step.toolVersion || step.effect !== (this.possibleEffect && command.reason !== 'start' ? 'POSSIBLE' : 'NONE')) throw unavailable();
    const lease = { taskId: key.taskId, ...command.lease, expiresAt: run.leaseExpiresAt.toISOString() };
    const original = command.reason !== 'start' && this.plans.resolveOriginal
      ? structuredClone(await this.plans.resolveOriginal({ taskId: task.id, registrationRef: matching[0].registrationRef,
        expectedTaskRevision: task.revision,
        lease: { ...command.lease, revision: command.lease.revision + (tx ? 1 : 0) } }, tx)) : null;
    if (original && (original.registrationAllowed !== false || original.taskId !== task.id
      || original.registrationRef !== matching[0].registrationRef || original.inputRef !== step.inputRef
      || original.requestFingerprint !== step.requestFingerprint || original.toolCode !== step.toolCode
      || original.toolVersion !== step.toolVersion || identity(original.context) !== identity(context)
      || !/^[a-f0-9]{64}$/u.test(saved.authorityHash) || typeof saved.policyVersion !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(saved.policyVersion))) throw denied();
    // Completing a measured original result is not a new tool invocation.
    // Legacy adapters without original evidence retain their stricter gate.
    // The legacy authorize fallback deliberately keeps the unbumped lease and
    // its own committed view: at in-tx-resolve time the run CAS is uncommitted,
    // so the committed revision still equals it, and the digest comparison
    // fail-closes on drift. Teaching it post-CAS revisions would false-deny.
    const proof = original ? { authorityHash: saved.authorityHash, policyVersion: saved.policyVersion,
      expiresAt: run.leaseExpiresAt.toISOString() }
      : structuredClone(await this.plans.authorize(structuredClone(plan), lease, this.planTransaction(tx)));
    if (proof.authorityHash !== saved.authorityHash || proof.policyVersion !== saved.policyVersion
      || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    const previous: AiStepStateDraft<Tool> = { stepId: step.id, runId: step.runId, sequence: step.sequence, revision: step.revision,
      toolCode: step.toolCode as Tool, toolVersion: step.toolVersion, actionId: step.actionId,
      requestFingerprint: step.requestFingerprint, outcome: command.reason === 'start' ? { status: 'pending', effect: 'none' }
        : { status: 'running', effect: this.possibleEffect ? 'possible' : 'none' } };
    if (step.status !== (command.reason === 'start' ? 'PENDING' : 'RUNNING') || step.resultRef !== null || step.errorCode !== null) throw denied();
    let resultRef: string | null = null;
    let resultBinding: unknown = null;
    let outcome: AiStepStateDraft['outcome'] = { status: 'running', effect: this.startEffect };
    if (command.reason === 'start') {
      if (command.evidenceId !== `start-${step.id}` || task.status !== 'RUNNING' || task.cancelRequestedAt !== null) throw denied();
      resultBinding = await this.additionalEvidence(step, null, [], context, tx);
    } else {
      const artifact = await db.aiTaskResultArtifact.findFirst({ where: { ...key, stepId: step.id, id: command.evidenceId } });
      if (!artifact || artifact.id !== command.evidenceId || artifact.scopeId !== key.scopeId || artifact.taskId !== key.taskId
        || artifact.runId !== key.runId || artifact.stepId !== step.id || artifact.actionId !== step.actionId
        || artifact.stepFingerprint !== step.requestFingerprint
        || (command.reason === 'result_unknown' ? artifact.completeMeasurement || !['UNKNOWN', 'RUNNING'].includes(artifact.outcome)
          : !artifact.completeMeasurement || !['SUCCEEDED', 'FAILED'].includes(artifact.outcome))
        || (artifact.outcome === 'SUCCEEDED' && artifact.errorCode !== null)
        || (artifact.outcome === 'FAILED' && (!AI_ERROR_CODES.includes(artifact.errorCode as AiErrorCode) || artifact.errorCode === 'AI_RESULT_UNKNOWN'))) throw unavailable();
      const artifactFence = artifact.fencingToken.toFixed(0), currentFence = run.fencingToken.toFixed(0);
      // Reading an immutable complete result does not regrant execution to its
      // old worker. The transition transaction still CASes only the current
      // lease. Same-fence/another-holder and future generations are corruption.
      if (!/^[1-9][0-9]{0,19}$/u.test(artifactFence) || typeof artifact.leaseOwnerId !== 'string' || !artifact.leaseOwnerId.length
        || BigInt(artifactFence) > BigInt(currentFence)
        || (artifactFence === currentFence && artifact.leaseOwnerId !== run.leaseOwnerId)) throw denied();
      const bytes = Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8');
      const startedMarker = this.possibleEffect && command.reason === 'result_unknown' && artifact.outcome === 'RUNNING';
      if (requestFingerprint(artifact.payload) !== artifact.contentHash
        || (startedMarker ? artifact.contentHash !== requestFingerprint({}) || artifact.outputBytes !== 0n || artifact.activeMs !== 0n
          : BigInt(bytes) !== artifact.outputBytes)
        || bytes > plan.limits.maxOutputBytes || artifact.activeMs < 0n || artifact.activeMs > BigInt(plan.limits.maxStepMs)) throw denied();
      const charges = await db.aiTaskExecutionCharge.findMany({ where: { ...key, stepId: step.id }, take: 6 });
      if (!taskStepChargesValid(charges)
        || charges.some(c => c.scopeId !== key.scopeId || c.taskId !== key.taskId || c.runId !== key.runId || c.stepId !== step.id
          || c.actionId !== step.actionId || c.stepFingerprint !== step.requestFingerprint || c.leaseOwnerId !== artifact.leaseOwnerId
          || c.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0) || !['RESERVED', 'RECORDED', 'UNKNOWN'].includes(c.status)
          || (c.resource === 'CALLS' && !c.gatewayInvocationId))) throw denied();
      resultRef = artifact.id;
      const additional = await this.additionalEvidence(step, artifact, charges, context, tx);
      resultBinding = { additional, artifact: { id: artifact.id, contentHash: artifact.contentHash, outputBytes: artifact.outputBytes.toString(),
        activeMs: artifact.activeMs.toString(), outcome: artifact.outcome, errorCode: artifact.errorCode,
        holder: artifact.leaseOwnerId, fence: artifact.fencingToken.toFixed(0) },
        charges: charges.map(c => ({ id: c.chargeId, resource: c.resource, status: c.status, fingerprint: c.requestFingerprint,
          invocation: c.gatewayInvocationId })).sort((a, b) => a.id.localeCompare(b.id)) };
      outcome = command.reason === 'result_unknown' ? { status: 'unknown', effect: 'possible', error: {
        code: 'AI_RESULT_UNKNOWN', message: '模型调用结果待核对，不自动重新派发。', retryable: false, nextAction: 'reconcile', missingFields: [] } }
        : artifact.outcome === 'SUCCEEDED' ? { status: 'succeeded', effect: 'none', facts: [] }
        : { status: 'failed', effect: 'none', error: { code: artifact.errorCode as Exclude<AiErrorCode, 'AI_RESULT_UNKNOWN'>,
          message: this.possibleEffect ? '模型步骤未完成，请通过人工入口处理。' : '只读步骤未完成，请通过人工入口处理。',
          retryable: false, nextAction: 'manual', missingFields: [] } };
    }
    const current = structuredClone(await this.current(command.taskId, command.reason, tx));
    if (identity(context) !== identity(current) || run.leaseExpiresAt <= this.wall() || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    return { context: current, transitionAllowed: true, authorizationKey: `persisted-${this.possibleEffect ? 'model' : 'readonly'}-${requestFingerprint({
      planHash: saved.planHash, authorityHash: proof.authorityHash, policyVersion: proof.policyVersion, resultBinding })}`, taskId: key.taskId,
      evidenceId: command.evidenceId, evidenceRevision: step.revision, expiresAt: new Date(Math.min(run.leaseExpiresAt.getTime(), Date.parse(proof.expiresAt))).toISOString(),
      reason: command.reason, previous, next: { ...previous, revision: previous.revision + 1, outcome }, previousResultRef: null, resultRef };
  }

  protected planTransaction(_tx?: Prisma.TransactionClient): Prisma.TransactionClient | undefined { return undefined; }
}
