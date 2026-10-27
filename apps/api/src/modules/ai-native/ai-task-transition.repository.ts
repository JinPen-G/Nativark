import { Prisma, type PrismaClient, type AiTaskStatus } from "@prisma/client";
import { z } from "zod";
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT, AI_TOOL_DRAFT_VERSION,
  type AiTaskEventDraft, type AiTaskTransitionRequestDraft, type AiStepStatusDraft, type AiStepStateDraft, type AiProposalPayloadDraft
} from "@rental-os/shared";
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from "./ai-task.repository";
import { evaluateAiTaskTransitionDraft, evaluateAiTaskConfirmationTransitionDraft, type AiTaskTransitionStateDraft } from "./task-transition-draft";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { fingerprintAiProposalDraft } from "./proposal-binding-draft";
import { aiPersistenceScopeColumns } from "./persistence-scope";
import { aiTaskRunPlanSchema } from "./runner/prisma-task-run-evidence.repository";
import { settingsChangeReferenceSchema } from "../rental-core/approved-settings-change.validation";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const leaseSchema = z.object({
  runId: id, holderId: id, revision,
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u)
}).strict();
const commandSchema = z.object({
  taskId: id, expectedRevision: revision,
  to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT), lease: leaseSchema.optional()
}).strict().refine(value => value.to === "cancel_requested" ? value.lease === undefined : value.lease !== undefined);
const confirmationCommandSchema = z.object({ taskId: id.max(36), stepId: id.max(36), expectedTaskRevision: revision,
  expectedStepRevision: revision, checkpointRef: id.max(36),
  lease: leaseSchema.extend({ taskId: id.max(36), expiresAt: z.string().datetime({ offset: true }) }).strict()
}).strict().refine(value => value.taskId === value.lease.taskId);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const confirmationEvidenceSchema = z.object({ scopeId: id.max(36), taskId: id.max(36), runId: id.max(36), stepId: id.max(36),
  checkpointRef: id.max(36), phaseId: id.max(36), kind: z.literal('confirmation'), actionId: id, inputRef: id.max(36),
  stepRevision: revision, stepFingerprint: hash, planHash: hash, contentHash: hash,
  leaseOwnerId: id, fencingToken: leaseSchema.shape.fencingToken, runRevision: revision,
  proposalId: id.max(36), proposalRevision: revision, reviewedPayloadHash: hash }).strict();
const confirmationDecisionEvidenceSchema = confirmationEvidenceSchema.extend({ decisionRef: id.max(36), decision: z.enum(['approved', 'rejected']),
  remainingActiveMs: z.number().int().min(1).max(86400000), remainingOutputBytes: z.number().int().min(1).max(16777216) });
export interface AiTaskConfirmationCheckpointSource {
  read(input: { scopeId: string; taskId: string; runId: string; stepId: string; checkpointRef: string;
    lease: z.infer<typeof confirmationCommandSchema>['lease'] },
    tx: Prisma.TransactionClient): Promise<z.infer<typeof confirmationEvidenceSchema>>;
  readDecision?(input: Parameters<AiTaskConfirmationCheckpointSource['read']>[0], tx: Prisma.TransactionClient): Promise<z.infer<typeof confirmationDecisionEvidenceSchema>>;
}
const taskSelect = {
  id: true, scopeId: true, status: true, revision: true, contractVersion: true,
  eventCursor: true, cancelRequestedAt: true
} satisfies Prisma.AiTaskSelect;
const stepSelect = { id: true, runId: true, sequence: true, revision: true, actionId: true, status: true, effect: true } satisfies Prisma.AiStepSelect;
const maxCursor = 18446744073709551615n;
const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT");
export class AiTaskTransitionResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/**
 * Internal mutation path, deliberately not registered in a controller/worker.
 * All future step writers must lock/CAS the task row before changing its steps;
 * otherwise no aggregate task-state validation can be consistent with them.
 */
export class AiTaskTransitionRepository {
  private readonly access: AiTaskRepository;
  constructor(
    private readonly db: Pick<PrismaClient, "$transaction" | "aiTask" | "aiRun">,
    authority: AiTaskRepositoryAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly confirmations?: AiTaskConfirmationCheckpointSource
  ) {
    this.access = new AiTaskRepository(db, authority, clock);
  }

  transition(value: unknown) { return this.transitionState(value, false); }

  /** Observe the exact cancel request at its original revision, never infer
   * success from today's task status or replay a potentially committed write. */
  readCancellationReceipt(value: unknown) { return this.readCancelTransitionReceipt(value, 'cancel_requested'); }
  readCancellationSettlementReceipt(value: unknown) { return this.readCancelTransitionReceipt(value, 'cancelled'); }
  private async readCancelTransitionReceipt(value: unknown, target: 'cancel_requested' | 'cancelled') {
    const parsed = z.object({ taskId: id, expectedRevision: revision }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data, initial = await this.access.resolveAccess(input.taskId, 'read_metadata');
    const eventsAccess = await this.access.resolveAccess(input.taskId, 'read_events');
    if (eventsAccess.bindingKey !== initial.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let observed;
    try {
      observed = await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task || task.id !== input.taskId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION || task.eventCursor < 0n || task.eventCursor > maxCursor) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        const status = z.enum(AI_TASK_STATUSES_DRAFT).safeParse(task.status.toLowerCase());
        if (!status.success) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const rows = await tx.aiTaskEvent.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
          taskRevision: input.expectedRevision + 1, type: 'task.transition' }, take: 2,
          orderBy: { cursor: 'asc' }, select: { scopeId: true, taskId: true, taskRevision: true,
            cursor: true, type: true, payload: true, occurredAt: true } });
        if (rows.length > 1) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const row = rows[0];
        let event: AiTaskEventDraft | null = null;
        if (row) {
          const envelope = z.object({ data: z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT),
            to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT) }).strict(),
            initiator: z.object({ kind: z.enum(['user', 'worker', 'system']), id,
              actorKind: z.string(), actorId: id }).strict() }).passthrough().safeParse(row.payload);
          if (!envelope.success || row.scopeId !== task.scopeId || row.taskId !== task.id
            || row.taskRevision !== input.expectedRevision + 1 || row.type !== 'task.transition'
            || row.cursor < 1n || row.cursor > task.eventCursor || row.taskRevision > task.revision
            || !(row.occurredAt instanceof Date) || !Number.isFinite(row.occurredAt.getTime())) {
            throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
          }
          if (envelope.data.data.to === target) {
            if (!(task.cancelRequestedAt instanceof Date) || !Number.isFinite(task.cancelRequestedAt.getTime())) {
              throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
            }
            const initiator = envelope.data.initiator;
            if (envelope.data.data.reason !== (target === 'cancel_requested' ? 'cancel_requested' : 'cancel_settled')
              || initiator.kind !== (initial.actorKind === 'AUTOMATION' ? 'system' : 'user')
              || initiator.id !== initial.actorId || initiator.actorId !== initial.actorId || initiator.actorKind !== initial.actorKind) {
              throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            }
            event = { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, type: 'task.transition',
              taskRevision: row.taskRevision, cursor: row.cursor.toString(), occurredAt: row.occurredAt.toISOString(),
              data: envelope.data.data };
          }
        }
        return { taskId: task.id, expectedRevision: input.expectedRevision,
          status: event ? 'observed' as const : 'not_observed' as const, event,
          snapshot: { revision: task.revision, cursor: task.eventCursor.toString(), status: status.data },
          cancellation: target === 'cancel_requested' ? 'request_not_rollback' as const : 'task_cancelled_not_business_rollback' as const,
          remoteCancellation: 'not_attested' as const,
          automaticRetry: false as const, admission: 'not_granted' as const,
          absenceSemantics: 'not_observed_is_not_proof_of_uncommitted' as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    for (const action of ['read_metadata', 'read_events'] as const) {
      if ((await this.access.resolveAccess(input.taskId, action)).bindingKey !== initial.bindingKey) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    }
    return Object.freeze(observed);
  }

  settleCancellation(value: unknown) { return this.transitionState(value, true); }

  /** Server-only paused-input witness. No holder is minted, and the witness
   * must lock/close the original released run inside this same transaction. */
  settleInputCancellation(value: unknown, witness: (tx: Prisma.TransactionClient,
    task: { id: string; scopeId: string; revision: number }) => Promise<void>) {
    if (typeof witness !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return this.transitionState(value, true, undefined, witness);
  }

  /** Server-bound original run only. The task lock fences activation before
   * absence can attest never-started work; expiry alone proves nothing. */
  settleUnstartedCancellation(value: unknown, originalRunId: string) {
    if (!id.safeParse(originalRunId).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.settleInputCancellation(value, async (tx, task) => {
      const access = await this.access.resolveAccess(task.id, 'transition_task');
      const key = { scopeId: task.scopeId, taskId: task.id };
      const runs = await tx.aiRun.findMany({ where: key, take: 2 });
      const held = runs[0];
      if (runs.length !== 1 || !held || held.id !== originalRunId || held.taskId !== key.taskId || held.scopeId !== key.scopeId
        || held.actorKind !== access.actorKind || held.actorId !== access.actorId || held.status !== 'QUEUED'
        || held.startedAt != null || !revision.safeParse(held.revision).success
        || (held.leaseOwnerId === null ? held.leaseExpiresAt !== null
          : !(held.leaseExpiresAt instanceof Date) || !Number.isFinite(held.leaseExpiresAt.getTime())))
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const fence = held.fencingToken.toFixed(0);
      if (!/^(0|[1-9][0-9]{0,19})$/u.test(fence) || !held.fencingToken.equals(fence)
        || BigInt(fence) >= 99999999999999999999n) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const evidence = await Promise.all([
        tx.aiStep.findFirst({ where: key }), tx.aiTaskRunPlan.findFirst({ where: key }),
        tx.aiTaskActionInput.findFirst({ where: key }), tx.aiTaskResultArtifact.findFirst({ where: key }),
        tx.aiGatewayInvocation.findFirst({ where: key }), tx.aiTaskExecutionBudget.findFirst({ where: key }),
        tx.aiTaskExecutionCharge.findFirst({ where: key }),
        tx.aiBudgetReservation.findFirst({ where: { scopeId: key.scopeId, runId: held.id } })
      ]);
      if (evidence.some(Boolean)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const changed = await tx.aiRun.updateMany({ where: { id: held.id, ...key, status: 'QUEUED', revision: held.revision,
        fencingToken: held.fencingToken, leaseOwnerId: held.leaseOwnerId, leaseExpiresAt: held.leaseExpiresAt,
        actorKind: access.actorKind, actorId: access.actorId },
        data: { status: 'CANCELLED', revision: { increment: 1 }, fencingToken: { increment: 1 },
          leaseOwnerId: null, leaseExpiresAt: null, endedAt: access.now } });
      if (changed.count !== 1) throw conflict();
    });
  }

  async pauseConfirmation(value: unknown) {
    const parsed = confirmationCommandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (typeof this.confirmations?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const input = parsed.data, { taskId: _, expiresAt: __, ...lease } = input.lease;
    const result = await this.transitionState({ taskId: input.taskId, expectedRevision: input.expectedTaskRevision,
      to: 'waiting_confirmation', reason: 'confirmation_required', lease }, false, { ...input, resume: false });
    if (result.runRevision === null) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    return { ...result, runRevision: result.runRevision, runId: input.lease.runId,
      stepId: input.stepId, stepRevision: input.expectedStepRevision, checkpointRef: input.checkpointRef };
  }

  async resumeConfirmation(value: unknown) {
    const parsed = confirmationCommandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (typeof this.confirmations?.readDecision !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const input = parsed.data, { taskId: _, expiresAt: __, ...lease } = input.lease;
    const result = await this.transitionState({ taskId: input.taskId, expectedRevision: input.expectedTaskRevision,
      to: 'running', reason: 'resume', lease }, false, { ...input, resume: true });
    if (result.runRevision === null || !result.continuation) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    return { event: result.event, runId: input.lease.runId, runRevision: result.runRevision,
      stepId: input.stepId, stepRevision: input.expectedStepRevision, ...result.continuation };
  }

  private async confirmationWitness(tx: Prisma.TransactionClient, input: z.infer<typeof confirmationCommandSchema> & { resume: boolean },
    scopeId: string, access: Awaited<ReturnType<AiTaskRepository['resolveAccess']>>) {
    const key = { scopeId, taskId: input.taskId, runId: input.lease.runId, stepId: input.stepId, checkpointRef: input.checkpointRef };
    const read = { ...key, lease: structuredClone(input.lease) };
    const proof = input.resume
      ? confirmationDecisionEvidenceSchema.parse(structuredClone(await this.confirmations!.readDecision!(read, tx)))
      : confirmationEvidenceSchema.parse(structuredClone(await this.confirmations!.read(read, tx)));
    const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (Object.entries(key).some(([k, v]) => proof[k as keyof typeof proof] !== v)
      || (!input.resume && (proof.leaseOwnerId !== input.lease.holderId || proof.fencingToken !== input.lease.fencingToken || proof.runRevision !== input.lease.revision))
      || (input.resume && (BigInt(proof.fencingToken) > BigInt(input.lease.fencingToken) || proof.runRevision > input.lease.revision
        || (proof.fencingToken === input.lease.fencingToken && proof.leaseOwnerId !== input.lease.holderId)))
      || proof.stepRevision !== input.expectedStepRevision) throw denied();
    const step = await tx.aiStep.findFirst({ where: { scopeId, taskId: input.taskId, runId: input.lease.runId, id: input.stepId } });
    if (!step || step.id !== input.stepId || step.scopeId !== scopeId || step.taskId !== input.taskId || step.runId !== input.lease.runId
      || step.actionId !== proof.actionId || step.inputRef !== proof.inputRef || step.requestFingerprint !== proof.stepFingerprint
      || step.revision !== input.expectedStepRevision || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE' || step.resultRef !== null
      || !['rental.order.commit', 'tenant.notifications.commit'].includes(step.toolCode) || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
    const savedPlan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId: input.taskId, runId: input.lease.runId } } });
    if (!savedPlan || savedPlan.scopeId !== scopeId || savedPlan.taskId !== input.taskId || savedPlan.runId !== input.lease.runId
      || savedPlan.planHash !== proof.planHash || requestFingerprint(savedPlan.payload) !== proof.planHash) throw denied();
    const plan = aiTaskRunPlanSchema.parse(savedPlan.payload);
    const settings = step.toolCode === 'tenant.notifications.commit';
    const planned = plan.steps.filter(p => p.operation === 'idempotent' && p.toolCode === step.toolCode && p.toolVersion === step.toolVersion);
    if (settings && planned.length !== 1) throw denied();
    const original = await tx.aiTaskActionInput.findFirst({ where: { scopeId, taskId: input.taskId, runId: input.lease.runId,
      ...(settings ? { registrationRef: planned[0].registrationRef } : { id: proof.inputRef }) } });
    const change = settings ? settingsChangeReferenceSchema.safeParse(original?.payload) : null;
    if (!original || (!settings && original.id !== proof.inputRef) || original.scopeId !== scopeId || original.taskId !== input.taskId || original.runId !== input.lease.runId
      || requestFingerprint(original.payload) !== original.fingerprint
      || (settings ? !change?.success || change.data.changeId !== proof.inputRef || change.data.changeHash !== proof.stepFingerprint
        : original.fingerprint !== proof.stepFingerprint)
      || original.toolCode !== step.toolCode || original.toolVersion !== step.toolVersion || !(original.expiresAt instanceof Date)
      || original.expiresAt <= this.clock() || plan.taskId !== input.taskId || plan.runId !== input.lease.runId
      || !plan.steps.some(p => p.registrationRef === original.registrationRef && p.operation === 'idempotent'
        && p.toolCode === step.toolCode && p.toolVersion === step.toolVersion)) throw denied();
    const decision = input.resume ? confirmationDecisionEvidenceSchema.parse(proof) : null;
    const proposalKey = { scopeId, taskId: input.taskId, proposalId: proof.proposalId };
    const head = await tx.aiProposal.findFirst({ where: { scopeId, taskId: input.taskId, id: proof.proposalId } });
    const version = await tx.aiProposalVersion.findFirst({ where: { ...proposalKey, revision: proof.proposalRevision } });
    const actions = await tx.aiProposalAction.findMany({ where: { scopeId, taskId: input.taskId, actionId: proof.actionId }, take: 2 });
    const action = actions[0];
    if (!head || head.id !== proof.proposalId || head.scopeId !== scopeId || head.taskId !== input.taskId
      || head.status !== (decision ? decision.decision === 'approved' ? 'CONFIRMED' : 'CANCELLED' : 'PENDING_CONFIRMATION')
      || head.currentRevision !== (decision ? proof.proposalRevision : null) || !version
      || Object.entries(proposalKey).some(([k, v]) => version[k as keyof typeof version] !== v)
      || version.revision !== proof.proposalRevision || version.payloadHash !== proof.reviewedPayloadHash
      || fingerprintAiProposalDraft(version.payload) !== proof.reviewedPayloadHash || !(version.expiresAt instanceof Date)
      || version.expiresAt <= this.clock() || actions.length !== 1 || action.scopeId !== scopeId || action.taskId !== input.taskId
      || action.proposalId !== proof.proposalId || action.proposalRevision !== proof.proposalRevision
      || action.actionId !== proof.actionId || action.requestFingerprint !== proof.stepFingerprint
      || await tx.aiProposalVersion.findFirst({ where: { ...proposalKey, revision: { gt: proof.proposalRevision } } })
      || (!input.resume && await tx.aiApproval.findFirst({ where: { ...proposalKey, proposalRevision: proof.proposalRevision } }))) throw denied();
    const payload = version.payload as unknown as AiProposalPayloadDraft;
    if (payload.taskId !== input.taskId || payload.proposalId !== proof.proposalId || payload.revision !== proof.proposalRevision
      || payload.audience.toUpperCase() !== access.audience || requestFingerprint(aiPersistenceScopeColumns(payload.scope)) !== requestFingerprint(access.scope)
      || payload.atomicity !== 'single_action' || payload.actions.length !== 1 || payload.actions[0].actionId !== proof.actionId
      || payload.actions[0].toolCode !== step.toolCode || payload.actions[0].toolVersion !== step.toolVersion
      || payload.actions[0].input.contentHash !== proof.stepFingerprint || Date.parse(payload.expiresAt) !== version.expiresAt.getTime()) throw denied();
    const approval = decision ? await tx.aiApproval.findFirst({ where: { ...proposalKey, id: decision.decisionRef,
      proposalRevision: proof.proposalRevision, actorKind: access.actorKind, actorId: access.actorId } }) : null;
    if (decision && (!approval || approval.id !== decision.decisionRef || approval.scopeId !== scopeId || approval.taskId !== input.taskId
      || approval.proposalId !== proof.proposalId || approval.proposalRevision !== proof.proposalRevision || approval.payloadHash !== proof.reviewedPayloadHash
      || approval.actorKind !== access.actorKind || approval.actorId !== access.actorId || approval.audience !== access.audience
      || approval.decision !== decision.decision.toUpperCase() || !(approval.issuedAt instanceof Date) || !(approval.expiresAt instanceof Date)
      || approval.issuedAt > this.clock() || approval.issuedAt >= approval.expiresAt || approval.expiresAt <= this.clock()
      || approval.expiresAt.getTime() !== version.expiresAt.getTime()
      || await tx.aiApprovalConsumption.findFirst({ where: { scopeId, taskId: input.taskId, actionId: proof.actionId } }))) throw denied();
    const run = await tx.aiRun.findFirst({ where: { scopeId, taskId: input.taskId, id: input.lease.runId } });
    if (!run || run.id !== input.lease.runId || run.scopeId !== scopeId || run.taskId !== input.taskId || run.status !== 'RUNNING'
      || run.leaseOwnerId !== input.lease.holderId || run.revision !== input.lease.revision || run.fencingToken.toFixed(0) !== input.lease.fencingToken
      || run.actorKind !== access.actorKind || run.actorId !== access.actorId || !run.leaseExpiresAt
      || run.leaseExpiresAt.getTime() !== Date.parse(input.lease.expiresAt) || run.leaseExpiresAt <= this.clock()) throw denied();
    return { proof, decision, expiresAt: Math.min(original.expiresAt.getTime(), version.expiresAt.getTime(), approval?.expiresAt.getTime() ?? Infinity),
      binding: requestFingerprint({ proof, head, version, action, original, plan: savedPlan, approval }) };
  }

  private async transitionState(value: unknown, settleCancellation: boolean, confirmation?: z.infer<typeof confirmationCommandSchema> & { resume: boolean },
    inputWitness?: (tx: Prisma.TransactionClient, task: { id: string; scopeId: string; revision: number }) => Promise<void>) {
    const parsed = (inputWitness ? z.object({ taskId: id, expectedRevision: revision,
      to: z.literal('cancelled'), reason: z.literal('cancel_settled'), lease: z.undefined().optional() }).strict() : commandSchema).safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    if (settleCancellation && (input.to !== 'cancelled' || input.reason !== 'cancel_settled')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const initial = await this.access.resolveAccess(input.taskId, "transition_task");
    let writeAttempted = false, callbackCompleted = false;
    try {
      return await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        if (confirmation && (task.id !== input.taskId || task.status !== (confirmation.resume ? 'WAITING_CONFIRMATION' : 'RUNNING')
          || task.cancelRequestedAt !== null)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        // Input consumption and resume must share the dedicated receipt transaction.
        if (task.status === 'WAITING_INPUT' && input.to === 'running') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !AI_TASK_STATUSES_DRAFT.some(status => status === task.status.toLowerCase())) {
          throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        }
        if (task.revision !== input.expectedRevision || task.eventCursor < 0n || task.eventCursor >= maxCursor) throw conflict();
        // The update locks the task row; all reservations below roll back on any failure.
        writeAttempted = true;
        const reserved = await tx.aiTask.updateMany({
          where: { ...initial.where, scopeId: task.scopeId, revision: task.revision, eventCursor: task.eventCursor, status: task.status },
          data: { revision: { increment: 1 }, eventCursor: { increment: 1n } }
        });
        if (reserved.count !== 1) throw conflict();
        const rows = await tx.aiStep.findMany({
          where: { scopeId: task.scopeId, taskId: task.id }, select: stepSelect, orderBy: [{ runId: "asc" }, { sequence: "asc" }], take: 1001
        });
        if (inputWitness) {
          if (task.status !== 'CANCEL_REQUESTED' || !task.cancelRequestedAt) throw conflict();
          await inputWitness(tx, { id: task.id, scopeId: task.scopeId, revision: task.revision });
        }
        const checkpoint = confirmation ? await this.confirmationWitness(tx, confirmation, task.scopeId, initial) : null;
        if (confirmation && checkpoint?.binding !== (await this.confirmationWitness(tx, confirmation, task.scopeId, initial)).binding) throw conflict();
        if (confirmation?.resume) {
          const previous = await tx.aiTaskEvent.findFirst({ where: { scopeId: task.scopeId, taskId: task.id,
            cursor: task.eventCursor, taskRevision: task.revision, type: 'task.transition' } });
          const pause = z.object({ data: z.object({ from: z.literal('running'), to: z.literal('waiting_confirmation'), reason: z.literal('confirmation_required') }).strict(),
            confirmation: z.object({ checkpointRef: id.max(36), phaseId: id.max(36) }).strict() }).passthrough().safeParse(previous?.payload);
          if (!previous || previous.scopeId !== task.scopeId || previous.taskId !== task.id || previous.taskRevision !== task.revision
            || previous.cursor !== task.eventCursor || !pause.success || pause.data.confirmation.checkpointRef !== confirmation.checkpointRef
            || pause.data.confirmation.phaseId !== checkpoint?.proof.phaseId) throw conflict();
        }
        // Reauthorize after awaited reads/lock acquisition, before any status/event commit.
        const current = await this.access.resolveAccess(input.taskId, "transition_task");
        if (initial.bindingKey !== current.bindingKey || (checkpoint && checkpoint.expiresAt <= current.now.getTime())) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
        const occurredAt = current.now.toISOString();
        const state: AiTaskTransitionStateDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, revision: task.revision,
          status: task.status.toLowerCase() as AiTaskTransitionStateDraft["status"],
          steps: rows.map(row => ({
            stepId: row.id, runId: row.runId, sequence: row.sequence, revision: row.revision, actionId: row.actionId,
            outcome: { status: row.status.toLowerCase() as AiStepStatusDraft, effect: row.effect.toLowerCase() as AiStepStateDraft["outcome"]["effect"] }
          }))
        };
        // Runner counters describe this run, while task completion covers all
        // persistent runs. A failed successor cannot erase completed ancestors.
        if (!settleCancellation && input.to === 'failed' && input.reason === 'execution_failed'
          && rows.some(row => row.status === 'SUCCEEDED') && !rows.every(row => row.status === 'SUCCEEDED')) {
          input.to = 'partially_succeeded';
          input.reason = 'completed';
        }
        if (settleCancellation) {
          if (task.status !== 'CANCEL_REQUESTED') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
          if (rows.some(row => row.effect === 'COMMITTED')) {
            input.to = rows.every(row => row.status === 'SUCCEEDED') ? 'succeeded' : 'partially_succeeded';
          }
        }
        const request: AiTaskTransitionRequestDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, expectedRevision: task.revision,
          to: input.to, reason: input.reason, occurredAt,
          initiator: input.lease ? { kind: "worker", id: input.lease.holderId } : { kind: current.actorKind === "AUTOMATION" ? "system" : "user", id: current.actorId }
        };
        const decision = checkpoint ? evaluateAiTaskConfirmationTransitionDraft(state, request, {
          stepId: checkpoint.proof.stepId, runId: checkpoint.proof.runId,
          stepRevision: checkpoint.proof.stepRevision, actionId: checkpoint.proof.actionId
        }) : evaluateAiTaskTransitionDraft(state, request);
        if (!decision.allowed) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        let nextRunRevision: number | null = null;
        if (input.lease) {
          const lease = input.lease;
          const held = await tx.aiRun.updateMany({
            where: {
              id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision,
              fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId,
              leaseExpiresAt: { gt: current.now }, actorKind: current.actorKind, actorId: current.actorId,
              status: { in: ["QUEUED", "RUNNING"] }
            },
            // Activation belongs to this task+run transaction, not claimLease:
            // merely owning a lease must not start execution. A created run is
            // QUEUED until its aggregate transition has been authorized.
            data: { revision: { increment: 1 }, ...(input.to === 'running' ? { status: 'RUNNING' as const } : {}) }
          });
          if (held.count !== 1) throw conflict();
          nextRunRevision = lease.revision + 1;
        }
        const changed = await tx.aiTask.updateMany({
          where: { ...current.where, scopeId: task.scopeId, revision: decision.nextRevision, eventCursor: task.eventCursor + 1n, status: task.status },
          data: {
            status: input.to.toUpperCase() as AiTaskStatus,
            ...(input.to === "cancel_requested" ? { cancelRequestedAt: current.now } : {})
          }
        });
        if (changed.count !== 1) throw conflict();
        const event: AiTaskEventDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, cursor: (task.eventCursor + 1n).toString(),
          taskRevision: decision.nextRevision, occurredAt, type: "task.transition",
          data: { from: state.status, to: input.to, reason: input.reason }
        };
        await tx.aiTaskEvent.create({
          data: {
            scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 1n,
            taskRevision: decision.nextRevision, type: event.type, occurredAt: current.now,
            // Internal audit envelope, not the wire payload. A reader must explicitly project event.data.
            payload: { data: event.data, initiator: { ...request.initiator, actorKind: current.actorKind, actorId: current.actorId },
              ...(checkpoint ? { confirmation: { checkpointRef: checkpoint.proof.checkpointRef, phaseId: checkpoint.proof.phaseId,
                ...(checkpoint.decision ? { decisionRef: checkpoint.decision.decisionRef, decision: checkpoint.decision.decision,
                  contentHash: checkpoint.proof.contentHash, remainingActiveMs: checkpoint.decision.remainingActiveMs,
                  remainingOutputBytes: checkpoint.decision.remainingOutputBytes,
                  stepId: checkpoint.proof.stepId, stepRevision: checkpoint.proof.stepRevision, runId: input.lease!.runId,
                  runRevision: nextRunRevision!, holderId: input.lease!.holderId, fencingToken: input.lease!.fencingToken } : {}) } } : {}) }
          },
          select: { cursor: true }
        });
        // This value becomes observable only after Prisma resolves the transaction commit.
        callbackCompleted = true;
        return { event, runRevision: nextRunRevision,
          ...(checkpoint?.decision ? { continuation: { checkpointRef: checkpoint.proof.checkpointRef,
            decisionRef: checkpoint.decision.decisionRef, decision: checkpoint.decision.decision,
            remainingActiveMs: checkpoint.decision.remainingActiveMs, remainingOutputBytes: checkpoint.decision.remainingOutputBytes } } : {}) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      // Any completed mutation callback may have committed before the reply
      // was lost, not only an input-witness cancellation. Never label this as
      // a definitely-uncommitted storage failure or automatically replay it.
      if (callbackCompleted) throw new AiTaskTransitionResultUnknownError();
      if (error instanceof AiTaskRepositoryError) throw error;
      if (writeAttempted) throw new AiTaskTransitionResultUnknownError();
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }
}
