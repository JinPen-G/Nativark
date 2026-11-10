/** Explicit changed-name re-preparation after the original action is closed
 * with no business submission. Uses the original domain's immutable change key,
 * current Guard/ALS and name CAS; no task/approval/lease or retry is synthesized.
 * Old unknown/committed work cannot be replaced, and old resource rows remain. */
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeApprovedProfileApplication } from '../approval-execution/approved-profile-application.composition';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileConflict, profileDenied,
  profileUnavailable, type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { profileChangeInputSchema } from '../runner/prisma-task-plan-input.source';
import { aiStepActionId } from '../ai-step-registration.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { PrismaTaskConfirmationHistoryReader } from '../runner/prisma-task-confirmation-history.reader';
import { aiTaskResumedConfirmationSchema } from '../runner/prisma-task-run-evidence.repository';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reviewInput = z.object({ original: profileChangeInputSchema,
  name: z.string().trim().min(1).refine(value => Array.from(value).length <= 120),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const prepareInput = reviewInput.extend({ reviewHash: hash }).strict();
const readInput = z.object({ original: profileChangeInputSchema }).strict();
type OriginalResolver = (value: unknown) => Promise<{
  reference: z.infer<typeof profileChangeInputSchema>; task: { taskId: string; runId: string };
  before: Awaited<ReturnType<ApprovedProfileTaskAuthority['resolve']>>; verify(): Promise<void>;
}>;

export function composeProfileReconfirmation(d: ApprovedProfileApplicationDependencies, original: OriginalResolver) {
  const app = composeApprovedProfileApplication(d), clock = d.clock ?? (() => new Date());
  const key = (reference: z.infer<typeof profileChangeInputSchema>) => `profile-reconfirm-${reference.changeId}`;
  const digest = (reference: z.infer<typeof profileChangeInputSchema>, current: { customerId: string; name: string; ordinaryRevision: number },
    requested: { name: string; expiresAt: string }) => requestFingerprint({ version: 'profile-reconfirmation-1', original: reference,
      current: { customerId: current.customerId, name: current.name, ordinaryRevision: current.ordinaryRevision }, requested });
  const review = async (value: unknown) => {
    const command = reviewInput.parse(structuredClone(value)), found = await original(command.original);
    const previous = await app.readChangeReceipt(found.reference), current = await app.readCurrent({ customerId: found.reference.customerId });
    if (current.customerId !== found.reference.customerId || !Number.isSafeInteger(current.ordinaryRevision)
      || current.ordinaryRevision < 1 || current.ordinaryRevision > 4294967294 || typeof current.name !== 'string') throw profileUnavailable();
    const again = await app.readCurrent({ customerId: current.customerId });
    if (requestFingerprint(current) !== requestFingerprint(again)) throw profileConflict();
    await found.verify();
    return { command, found, previous, current, reviewHash: digest(found.reference, current, { name: command.name, expiresAt: command.expiresAt }) };
  };
  const closed = async (found: Awaited<ReturnType<OriginalResolver>>) => {
    await found.verify();
    const scopeId = found.before.scopeId, taskId = found.task.taskId, runId = found.task.runId, actor = found.before.actor;
    const observed = await d.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${scopeId} AND id = ${taskId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${taskId} AND id = ${runId} FOR UPDATE`);
      const task = await tx.aiTask.findFirst({ where: { id: taskId, scopeId, ownerKind: 'USER', ownerId: actor.actorId } });
      const runs = await tx.aiRun.findMany({ where: { taskId, scopeId }, take: 2 }), run = runs[0];
      if (!task || task.id !== taskId || task.scopeId !== scopeId
        || task.archivedAt !== null || runs.length !== 1 || !run || run.id !== runId || run.taskId !== taskId || run.scopeId !== scopeId
        || run.actorKind !== 'USER' || run.actorId !== actor.actorId
        || run.leaseOwnerId !== null || run.leaseExpiresAt !== null) throw profileUnavailable();
      if (task.status === 'FAILED' && task.cancelRequestedAt === null && run.status === 'FAILED') {
        // A normal rejected confirmation settles FAILED/NONE against the
        // immutable first receipt. It is not a cancellation or a second failed
        // business receipt. Consume the original resume/terminal witnesses only.
        const taskKey = { scopeId, taskId }, steps = await tx.aiStep.findMany({ where: taskKey, take: 2 }), step = steps[0];
        if (steps.length !== 1 || !step || step.runId !== runId || step.status !== 'FAILED' || step.effect !== 'NONE'
          || !step.resultRef || step.inputRef !== found.reference.changeId || step.requestFingerprint !== found.reference.changeHash
          || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
          || step.actionId !== aiStepActionId(found.before.access.scope, taskId, `profile-change:${found.reference.changeId}`)
          || await tx.aiApprovalConsumption.findFirst({ where: taskKey })
          || await tx.customerApprovedProfileOperation.findFirst({ where: { tenantId: actor.tenantId,
            customerId: found.reference.customerId, changeId: found.reference.changeId } })) throw profileUnavailable();
        const approvals = await tx.aiApproval.findMany({ where: taskKey, take: 2 }), approval = approvals[0];
        if (approvals.length !== 1 || !approval || approval.decision !== 'REJECTED' || approval.actorKind !== 'USER'
          || approval.actorId !== actor.actorId || approval.audience !== task.audience) throw profileUnavailable();
        const phaseKey = { ...taskKey, runId, stepId: step.id }, store = taskExecutionPhaseStore(tx);
        const starts = await store.readStarts(phaseKey), receipts = await store.readReceipts(phaseKey);
        if (starts.length !== 1 || receipts.length !== 1 || starts[0].sequence !== 1
          || starts[0].stepRevision + 1 !== step.revision || starts[0].previousReceiptId !== null || starts[0].decisionRef !== null
          || receipts[0].id !== step.resultRef || receipts[0].kind !== 'confirmation'
          || receipts[0].businessResultRef !== null || receipts[0].decisionRef !== null || receipts[0].errorCode !== null
          || approval.proposalId !== receipts[0].proposalId || approval.proposalRevision !== receipts[0].proposalRevision
          || approval.payloadHash !== receipts[0].reviewedPayloadHash) throw profileUnavailable();
        const readDb = new Proxy(d.db, { get(target, name) {
          if (name === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
          return Reflect.get(tx, name) ?? Reflect.get(target, name);
        } });
        const authorization = composePersistedTaskAuthorization({ ...d, db: readDb });
        const history = await new PrismaTaskConfirmationHistoryReader(readDb, authorization.tasks).read({ taskId, runId, stepId: step.id });
        const resumed = await tx.aiTaskEvent.findMany({ where: { ...taskKey, type: 'task.transition',
          payload: { path: '$.confirmation.checkpointRef', equals: step.resultRef } }, take: 3 });
        const continued = resumed.map(event => ({ event, parsed: aiTaskResumedConfirmationSchema.safeParse(event.payload) }))
          .filter(row => row.parsed.success && row.parsed.data.confirmation.decision === 'rejected');
        const terminalSchema = z.object({ data: z.object({ stepId: z.string(), runId: z.string(), stepRevision: z.number().int().positive(),
          status: z.literal('failed'), reason: z.enum(['result_observed', 'reconciled_not_committed']) }).strict(),
          initiator: z.object({ kind: z.literal('worker'), id: z.string(), actorKind: z.literal('USER'), actorId: z.string() }).strict(),
          evidence: z.object({ id: z.string(), revision: z.number().int().positive(), digest: hash }).strict() }).passthrough();
        const changes = await tx.aiTaskEvent.findMany({ where: { ...taskKey, type: 'step.changed',
          payload: { path: '$.data.stepId', equals: step.id } }, take: 3 });
        const settled = changes.map(event => ({ event, parsed: terminalSchema.safeParse(event.payload) })).filter(row => row.parsed.success);
        const resume = continued[0], terminal = settled[0];
        if (continued.length !== 1 || settled.length !== 1 || !resume.parsed.success || !terminal.parsed.success) throw profileUnavailable();
        const proof = resume.parsed.data.confirmation, result = terminal.parsed.data;
        if (history.phases.length !== 1 || history.phases[0].receiptId !== step.resultRef || history.phases[0].kind !== 'confirmation'
          || history.transitions.length !== 2 || history.transitions[0].kind !== 'paused' || history.transitions[1].kind !== 'continued'
          || proof.runId !== runId || proof.stepId !== step.id || proof.checkpointRef !== step.resultRef
          || proof.stepRevision + 1 !== step.revision || proof.decisionRef !== approval.id
          || result.data.runId !== runId || result.data.stepId !== step.id || result.data.stepRevision !== step.revision
          || result.evidence.id !== step.resultRef || result.evidence.revision + 1 !== step.revision
          || result.initiator.actorId !== actor.actorId || result.initiator.id !== proof.holderId
          || terminal.event.taskRevision !== resume.event.taskRevision + 1
          || !(terminal.event.occurredAt instanceof Date) || !(resume.event.occurredAt instanceof Date)
          || !Number.isFinite(terminal.event.occurredAt.getTime()) || terminal.event.occurredAt < resume.event.occurredAt
          || terminal.event.occurredAt > clock()) throw profileUnavailable();
        return { taskId, runId, taskRevision: task.revision, state: 'closed_no_business_submission' as const };
      }
      if (task.status !== 'CANCELLED' || !task.cancelRequestedAt || run.status !== 'CANCELLED') throw profileUnavailable();
      const event = await tx.aiTaskEvent.findFirst({ where: { scopeId, taskId, cursor: task.eventCursor,
        taskRevision: task.revision, type: 'task.transition' } });
      const payload = z.object({ data: z.object({ to: z.literal('cancelled'), reason: z.literal('cancel_settled') }).passthrough() }).passthrough().safeParse(event?.payload);
      if (!event || event.scopeId !== scopeId || event.taskId !== taskId || event.taskRevision !== task.revision || !payload.success) throw profileUnavailable();
      const taskKey = { scopeId, taskId }, steps = await tx.aiStep.findMany({ where: taskKey, take: 2 });
      if (await tx.aiApprovalConsumption.findFirst({ where: taskKey })
        || await tx.customerApprovedProfileOperation.findFirst({ where: { tenantId: actor.tenantId,
          customerId: found.reference.customerId, changeId: found.reference.changeId } })) throw profileUnavailable();
      if (steps.length > 1) throw profileUnavailable();
      if (steps.length === 1) {
        const step = steps[0];
        if (step.scopeId !== scopeId || step.taskId !== taskId || step.runId !== runId || step.status !== 'FAILED' || step.effect !== 'NONE'
          || step.inputRef !== found.reference.changeId || step.requestFingerprint !== found.reference.changeHash
          || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
          || step.actionId !== aiStepActionId(found.before.access.scope, taskId, `profile-change:${found.reference.changeId}`)) throw profileUnavailable();
        const approvals = await tx.aiApproval.findMany({ where: taskKey, take: 2 });
        if (approvals.length > 1 || approvals.some(approval => approval.decision !== 'REJECTED')) throw profileUnavailable();
      } else {
        const traces = await Promise.all([tx.aiTaskRunPlan.findFirst({ where: taskKey }), tx.aiTaskActionInput.findFirst({ where: taskKey }),
          tx.aiTaskResultArtifact.findFirst({ where: taskKey }), tx.aiProposal.findFirst({ where: taskKey }),
          tx.aiApproval.findFirst({ where: taskKey }), tx.aiTaskExecutionBudget.findFirst({ where: taskKey }),
          tx.aiTaskExecutionCharge.findFirst({ where: taskKey }), tx.aiGatewayInvocation.findFirst({ where: taskKey }),
          tx.aiBudgetReservation.findFirst({ where: { scopeId, runId } })]);
        if (traces.some(Boolean)) throw profileUnavailable();
      }
      return { taskId, runId, taskRevision: task.revision, state: 'closed_no_business_submission' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    // Do not hold Task locks while the original domain takes its customer lock.
    // Terminal/no-effect evidence does not become an enduring write grant.
    await found.verify(); return observed;
  };
  return Object.freeze({
    async readUpdatedDifference(value: unknown) {
      const inspected = await review(value);
      return { original: inspected.found.reference, previous: inspected.previous, current: inspected.current,
        fields: [{ field: 'name' as const, before: inspected.current.name, after: inspected.command.name }],
        originalBaseMatches: inspected.current.ordinaryRevision === inspected.previous.baseRevision
          && inspected.current.name === inspected.previous.fields[0].before,
        reviewHash: inspected.reviewHash, expiresAt: inspected.command.expiresAt,
        persistence: 'not_attempted' as const, approval: 'not_granted' as const, automaticRetry: false as const };
    },
    async prepareReconfirmedChange(value: unknown) {
      const command = prepareInput.parse(structuredClone(value)), inspected = await review({ original: command.original,
        name: command.name, expiresAt: command.expiresAt });
      if (command.reviewHash !== inspected.reviewHash) throw profileConflict();
      const closure = await closed(inspected.found);
      if (Date.parse(command.expiresAt) <= clock().getTime() || command.name === inspected.current.name) throw profileConflict();
      let change;
      try {
        change = await app.prepareChange({ customerId: command.original.customerId, changeKey: key(command.original),
          baseRevision: inspected.current.ordinaryRevision, name: command.name, expiresAt: command.expiresAt });
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      try { await closed(inspected.found); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return { original: inspected.found.reference, closure, change,
        reference: { customerId: change.customerId, changeId: change.changeId, changeHash: change.changeHash },
        approval: 'fresh_proposal_and_approval_required' as const, task: 'not_created_by_preparation' as const,
        oldResources: 'not_reset_or_reallocated' as const, automaticRetry: false as const };
    },
    async readReconfirmedChange(value: unknown) {
      const command = readInput.parse(structuredClone(value)), found = await original(command.original), actor = found.before.actor;
      const row = await d.db.customerApprovedProfileChange.findUnique({ where: { tenantId_customerId_actorId_changeKey: {
        tenantId: actor.tenantId, customerId: found.reference.customerId, actorId: actor.actorId, changeKey: key(found.reference) } } });
      if (!row) { await found.verify(); return { state: 'not_observed' as const, retryable: false as const }; }
      if (row.tenantId !== actor.tenantId || row.workspaceId !== actor.workspaceId || row.actorId !== actor.actorId
        || row.customerId !== found.reference.customerId || row.changeKey !== key(found.reference)) throw profileDenied();
      await closed(found);
      const reference = { customerId: row.customerId, changeId: row.id, changeHash: row.changeHash }, change = await app.readChangeReceipt(reference);
      await found.verify();
      return { state: 'prepared' as const, original: found.reference, reference, change,
        execution: 'read_only_no_task_or_approval_or_redispatch' as const, retryable: false as const };
    }
  });
}
