/** Proves one notification confirmation was explicitly rejected and settled
 * without Core submission. Uses the original current read authority and frozen
 * plan/phase/event receipts; FAILED/NONE, expiry or absent writes alone do not
 * grant re-preparation. This reader starts no phase, lease, approval or action. */
import type { AiTask, AiRun, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_APPROVED_SETTINGS_TOOL_CODE, AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { settingsTransactionDb, settingsUnavailable, type ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { AiTaskRepository } from '../ai-task.repository';
import { aiStepActionId } from '../ai-step-registration.repository';
import { PrismaTaskConfirmationHistoryReader } from '../runner/prisma-task-confirmation-history.reader';
import { aiTaskResumedConfirmationSchema, aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';
import type { SettingsReconfirmationOriginalResolver } from './settings-reconfirmation.composition';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const terminalSchema = z.object({ data: z.object({ stepId: id.max(36), runId: id.max(36), stepRevision: revision,
  status: z.literal('failed'), reason: z.enum(['result_observed', 'reconciled_not_committed']) }).strict(),
  initiator: z.object({ kind: z.literal('worker'), id, actorKind: z.literal('USER'), actorId: id }).strict(),
  evidence: z.object({ id: id.max(36), revision, digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() }).passthrough();
const taskTerminalSchema = z.object({ data: z.object({ from: z.literal('running'), to: z.literal('failed'),
  reason: z.literal('execution_failed') }).strict(),
  initiator: z.object({ kind: z.literal('worker'), id, actorKind: z.literal('USER'), actorId: id }).strict() }).passthrough();
const validDate = (value: Date | null): value is Date => value instanceof Date && Number.isFinite(value.getTime());

export async function readSettingsRejectedClosure(d: ApprovedSettingsApplicationDependencies,
  found: Awaited<ReturnType<SettingsReconfirmationOriginalResolver>>, tx: Prisma.TransactionClient,
  task: AiTask, run: AiRun) {
  const { scopeId, actor, access } = found.before, { taskId, runId } = found.task, key = { scopeId, taskId };
  const clock = d.clock ?? (() => new Date()), now = clock();
  if (!d.originalReadAuthority || !validDate(now) || task.id !== taskId || task.scopeId !== scopeId
    || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.ownerKind !== 'USER' || task.ownerId !== actor.actorId
    || task.audience !== found.before.task.audience || task.sceneCode !== d.scene.code || task.sceneVersion !== d.scene.version
    || task.inputRef !== found.change.changeId || task.inputHash !== found.change.changeHash || task.inputRevision !== 1
    || task.status !== 'FAILED' || task.cancelRequestedAt !== null || task.archivedAt !== null
    || !revision.safeParse(task.revision).success || typeof task.eventCursor !== 'bigint' || task.eventCursor < 1n
    || run.id !== runId || run.scopeId !== scopeId || run.taskId !== taskId || run.status !== 'FAILED'
    || run.actorKind !== 'USER' || run.actorId !== actor.actorId || run.leaseOwnerId !== null || run.leaseExpiresAt !== null)
    throw settingsUnavailable();
  const steps = await tx.aiStep.findMany({ where: key, take: 2 }), step = steps[0];
  if (steps.length !== 1 || !step || step.scopeId !== scopeId || step.taskId !== taskId || step.runId !== runId
    || step.status !== 'FAILED' || step.effect !== 'NONE' || step.errorCode !== 'AI_BUSINESS_REJECTED' || !step.resultRef
    || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
    || step.inputRef !== found.change.changeId || step.requestFingerprint !== found.change.changeHash
    || await tx.aiApprovalConsumption.findFirst({ where: key })
    || await tx.rentalApprovedSettingsOperation.findFirst({ where: { tenantId: actor.tenantId,
      workspaceId: actor.workspaceId, changeId: found.change.changeId } })) throw settingsUnavailable();
  const input = await tx.aiTaskActionInput.findFirst({ where: { ...key, runId, id: step.inputRef,
    toolCode: AI_APPROVED_SETTINGS_TOOL_CODE, toolVersion: AI_TOOL_DRAFT_VERSION } });
  const reference = settingsChangeReferenceSchema.safeParse(input?.payload);
  const saved = await tx.aiTaskRunPlan.findFirst({ where: { ...key, runId } }), plan = aiTaskRunPlanSchema.safeParse(saved?.payload);
  if (!input || input.scopeId !== scopeId || input.taskId !== taskId || input.runId !== runId
    || input.id !== found.change.changeId || input.fingerprint !== hash({ changeId: found.change.changeId, changeHash: found.change.changeHash })
    || !reference.success || reference.data.changeId !== found.change.changeId || reference.data.changeHash !== found.change.changeHash
    || step.actionId !== aiStepActionId(access.scope, taskId, input.registrationRef)
    || !saved || saved.scopeId !== scopeId || saved.taskId !== taskId || saved.runId !== runId || !plan.success
    || hash(plan.data) !== saved.planHash || plan.data.taskId !== taskId || plan.data.runId !== runId || plan.data.steps.length !== 1
    || plan.data.steps[0].registrationRef !== input.registrationRef || plan.data.steps[0].operation !== 'idempotent'
    || plan.data.steps[0].toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || plan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION)
    throw settingsUnavailable();
  const approvals = await tx.aiApproval.findMany({ where: key, take: 2 }), approval = approvals[0];
  if (approvals.length !== 1 || !approval || approval.scopeId !== scopeId || approval.taskId !== taskId
    || approval.decision !== 'REJECTED' || approval.actorKind !== 'USER' || approval.actorId !== actor.actorId
    || approval.audience !== task.audience) throw settingsUnavailable();
  const phaseKey = { ...key, runId, stepId: step.id }, store = taskExecutionPhaseStore(tx);
  const starts = await store.readStarts(phaseKey), receipts = await store.readReceipts(phaseKey), first = starts[0], receipt = receipts[0];
  if (starts.length !== 1 || receipts.length !== 1 || !first || !receipt || first.sequence !== 1
    || first.stepRevision + 1 !== step.revision || first.previousReceiptId !== null || first.decisionRef !== null
    || receipt.id !== step.resultRef || receipt.kind !== 'confirmation' || receipt.phaseId !== first.id
    || receipt.businessResultRef !== null || receipt.decisionRef !== null || receipt.errorCode !== null
    || approval.proposalId !== receipt.proposalId || approval.proposalRevision !== receipt.proposalRevision
    || approval.payloadHash !== receipt.reviewedPayloadHash) throw settingsUnavailable();
  // Reuse the original history algorithm under the caller's current read
  // binding. Never fall back to execution policy or invent a read adapter.
  const db = settingsTransactionDb(d.db, tx), tasks = new AiTaskRepository(db, d.originalReadAuthority, clock);
  const history = await new PrismaTaskConfirmationHistoryReader(db, tasks).read({ taskId, runId, stepId: step.id });
  const resumed = await tx.aiTaskEvent.findMany({ where: { ...key, type: 'task.transition',
    payload: { path: '$.confirmation.checkpointRef', equals: step.resultRef } }, take: 3 });
  const continued = resumed.map(event => ({ event, parsed: aiTaskResumedConfirmationSchema.safeParse(event.payload) }))
    .filter(value => value.parsed.success && value.parsed.data.confirmation.decision === 'rejected');
  const changes = await tx.aiTaskEvent.findMany({ where: { ...key, type: 'step.changed',
    payload: { path: '$.data.stepId', equals: step.id } }, take: 3 });
  const settled = changes.map(event => ({ event, parsed: terminalSchema.safeParse(event.payload) })).filter(value => value.parsed.success);
  const resume = continued[0], terminal = settled[0];
  if (continued.length !== 1 || settled.length !== 1 || !resume || !terminal || !resume.parsed.success || !terminal.parsed.success)
    throw settingsUnavailable();
  const proof = resume.parsed.data.confirmation, result = terminal.parsed.data;
  if (history.phases.length !== 1 || history.phases[0].receiptId !== step.resultRef || history.phases[0].kind !== 'confirmation'
    || history.transitions.length !== 2 || history.transitions[0].kind !== 'paused' || history.transitions[1].kind !== 'continued'
    || proof.runId !== runId || proof.stepId !== step.id || proof.checkpointRef !== step.resultRef
    || proof.phaseId !== first.id || proof.stepRevision + 1 !== step.revision || proof.decisionRef !== approval.id
    || result.data.runId !== runId || result.data.stepId !== step.id || result.data.stepRevision !== step.revision
    || result.evidence.id !== step.resultRef || result.evidence.revision + 1 !== step.revision
    || result.initiator.actorId !== actor.actorId || result.initiator.id !== proof.holderId
    || terminal.event.scopeId !== scopeId || terminal.event.taskId !== taskId
    || terminal.event.taskRevision !== resume.event.taskRevision + 1 || terminal.event.taskRevision > task.revision
    || typeof terminal.event.cursor !== 'bigint' || typeof resume.event.cursor !== 'bigint'
    || terminal.event.cursor !== resume.event.cursor + 1n || terminal.event.cursor > task.eventCursor
    || !validDate(terminal.event.occurredAt) || !validDate(resume.event.occurredAt)
    || terminal.event.occurredAt < resume.event.occurredAt || terminal.event.occurredAt > now) throw settingsUnavailable();
  const completed = await tx.aiTaskEvent.findFirst({ where: { ...key, type: 'task.transition',
    cursor: task.eventCursor, taskRevision: task.revision } });
  const completion = taskTerminalSchema.safeParse(completed?.payload);
  if (!completed || completed.scopeId !== scopeId || completed.taskId !== taskId || !completion.success
    || completed.cursor !== terminal.event.cursor + 1n || completed.taskRevision !== terminal.event.taskRevision + 1
    || completion.data.initiator.id !== proof.holderId || completion.data.initiator.actorId !== actor.actorId
    || !validDate(completed.occurredAt) || completed.occurredAt < terminal.event.occurredAt || completed.occurredAt > now
    || !validDate(run.endedAt) || run.endedAt.getTime() !== completed.occurredAt.getTime()) throw settingsUnavailable();
  return { taskId, runId, taskRevision: task.revision, state: 'closed_no_business_submission' as const };
}
