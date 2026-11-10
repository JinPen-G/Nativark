import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { PrismaTaskConfirmationHistoryReader } from '../runner/prisma-task-confirmation-history.reader';
import { aiTaskResumedConfirmationSchema } from '../runner/prisma-task-run-evidence.repository';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { waitingPayloadSchema } from '../runner/prisma-task-confirmation-checkpoint.source';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';
import { AI_APPROVAL_APPLICATION_DRAFT_VERSION } from '@rental-os/shared';
import type { AiApprovalReprepareEligibilityDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { composeApprovedOrderHumanApproval } from './approved-order-human.composition';
import { approvalApplicationContract } from './approval-application-contracts';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';
import { AiApprovedOrderRouteAuthority } from './approved-order-route.authority';

type Human = ReturnType<typeof composeApprovedOrderHumanApproval>;

export function composeApprovedOrderReprepareEligibility(d: ControlledApprovedOrderDependencies, human: Human) {
  const policy = new PersistedApprovedOrderPolicyAuthority({ ...d, toolVersion: AI_TOOL_DRAFT_VERSION });
  const clock = d.clock ?? (() => new Date());
  const quoteRoute = new AiApprovedOrderRouteAuthority(d.guard, d.credentials, clock);
  return async (taskId: string, value: unknown): Promise<AiApprovalReprepareEligibilityDraft> => {
    const request = approvalApplicationContract('AiApprovalReprepareEligibilityRequestDraft', value);
    const { original } = request;
    const observe = async () => d.db.$transaction(async tx => {
      const db = tx, current = await policy.authorizeRead(taskId, tx), { context, scopeId } = current;
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw deniedOrder();
      // A no-submission observation shares the original task/run locks with
      // phase publication and Core consumption. It is not a new lease/grant.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${scopeId} AND id = ${taskId} FOR UPDATE`);
      const view = await human.readOriginal(taskId, original, tx), action = view.proposal.payload.actions[0];
      const key = { scopeId, taskId, actionId: action.actionId };
      const step = await db.aiStep.findFirst({ where: key, select: { id: true, runId: true, inputRef: true, scopeId: true, taskId: true, actionId: true,
        toolCode: true, toolVersion: true, requestFingerprint: true, status: true, effect: true, resultRef: true, revision: true } });
      if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
        || step.toolCode !== action.toolCode || step.toolVersion !== action.toolVersion
        || step.requestFingerprint !== action.input.contentHash) throw deniedOrder();
      const approval = await db.aiApproval.findFirst({ where: { scopeId, taskId, proposalId: original.proposalId,
        proposalRevision: original.proposalRevision, actorKind: 'USER', actorId: context.actor.userId }, select: { decision: true } });
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${taskId} AND id = ${step.runId} FOR UPDATE`);
      const receipt = await human.readReceipt(taskId, { ...original, decision: approval?.decision === 'REJECTED' ? 'reject' : 'approve' }, tx);
      let rejectedResult = false;
      if (step.status === 'FAILED' && step.effect === 'NONE' && step.resultRef && receipt.kind === 'recorded' && receipt.record.decision === 'rejected') {
        const phase = await db.aiTaskExecutionPhaseReceipt.findFirst({ where: { scopeId, taskId, id: step.resultRef } });
        const payload = phase?.payload as { version?: string; effectState?: string; binding?: { actionId?: string; fingerprint?: string; stepId?: string; runId?: string; scopeId?: string; taskId?: string };
          proposal?: typeof original; decisionRef?: string; decision?: string; businessResultRef?: string } | undefined;
        rejectedResult = !!phase && phase.kind === 'failed' && phase.errorCode === 'AI_APPROVAL_REJECTED' && phase.businessResultRef === null
          && phase.stepId === step.id && phase.runId === step.runId
          && phase.decisionRef === receipt.record.approvalId && phase.proposalId === original.proposalId && phase.proposalRevision === original.proposalRevision
          && phase.reviewedPayloadHash === original.reviewedPayloadHash && requestFingerprint(phase.payload) === phase.contentHash
          && payload?.version === 'approved-order-wait-1' && payload.effectState === 'rejected' && payload.decision === 'rejected'
          && payload.decisionRef === phase.decisionRef && !payload.businessResultRef && requestFingerprint(payload.proposal) === requestFingerprint(original)
          && payload.binding?.scopeId === scopeId && payload.binding.taskId === taskId && payload.binding.actionId === action.actionId
          && payload.binding.fingerprint === action.input.contentHash && payload.binding.stepId === phase.stepId && payload.binding.runId === phase.runId;
      }
      const consumption = await db.aiApprovalConsumption.findFirst({ where: key });
      const idempotencyKey = `ai-order:${requestFingerprint([scopeId, taskId, action.actionId])}`;
      const business = await db.rentalOrderIdempotencyRecord.findUnique({
        where: { workspaceId_action_idempotencyKey: { workspaceId: context.scope.workspaceId, action: 'rental.order.create', idempotencyKey } },
        select: { tenantId: true, workspaceId: true, action: true, idempotencyKey: true, requestHash: true, orderId: true, status: true }
      });
      let confirmationOnly = false;
      const rejectedCheckpoint = step.status === 'FAILED' && step.effect === 'NONE' && !!step.resultRef
        && receipt.kind === 'recorded' && receipt.record.decision === 'rejected' && !consumption && !business;
      if ((step.status === 'RUNNING' && step.effect === 'POSSIBLE' && step.resultRef === null || rejectedCheckpoint) && !consumption && !business) {
        const phaseKey = { scopeId, taskId, runId: step.runId, stepId: step.id };
        const store = taskExecutionPhaseStore(tx), starts = await store.readStarts(phaseKey), receipts = await store.readReceipts(phaseKey);
        if (starts.length === 1 && receipts.length === 1) {
          const start = starts[0], phase = receipts[0], payload = waitingPayloadSchema.safeParse(phase.payload);
          const plan = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId, runId: step.runId } } });
          const input = await db.aiTaskActionInput.findFirst({ where: { scopeId, taskId, runId: step.runId, id: step.inputRef! } });
          const artifact = await db.aiTaskResultArtifact.findFirst({ where: { ...phaseKey, id: start.originalArtifactId } });
          confirmationOnly = payload.success && payload.data.version === 'approved-order-wait-1'
            && start.sequence === 1 && start.actionId === step.actionId && start.inputRef === step.inputRef
            && start.stepFingerprint === step.requestFingerprint
            && (rejectedCheckpoint ? start.stepRevision + 1 === step.revision : start.stepRevision === step.revision)
            && Object.entries(phaseKey).every(([field, value]) => start[field as keyof typeof start] === value
              && phase[field as keyof typeof phase] === value)
            && phase.kind === 'confirmation' && phase.phaseId === start.id && phase.createdAt >= start.createdAt
            && phase.createdAt <= clock() && start.previousReceiptId === null && start.decisionRef === null
            && payload.data.presentedLease.taskId === taskId && payload.data.presentedLease.runId === step.runId
            && payload.data.presentedLease.holderId === start.leaseOwnerId
            && payload.data.presentedLease.fencingToken === start.fencingToken
            && payload.data.presentedLease.revision === start.runRevision
            && phase.decisionRef === null && phase.businessResultRef === null && phase.errorCode === null
            && phase.proposalId === original.proposalId && phase.proposalRevision === original.proposalRevision
            && phase.reviewedPayloadHash === original.reviewedPayloadHash
            && requestFingerprint(phase.payload) === phase.contentHash
            && BigInt(Buffer.byteLength(JSON.stringify(phase.payload), 'utf8')) === phase.outputBytes
            && requestFingerprint(payload.data.binding) === requestFingerprint({ ...phaseKey,
              actionId: step.actionId, inputRef: step.inputRef, fingerprint: step.requestFingerprint })
            && requestFingerprint(payload.data.proposal) === requestFingerprint(original)
            && !!plan && plan.planHash === start.planHash && requestFingerprint(plan.payload) === plan.planHash
            && !!input && input.fingerprint === step.requestFingerprint && requestFingerprint(input.payload) === input.fingerprint
            && !!artifact && artifact.actionId === step.actionId && artifact.stepFingerprint === step.requestFingerprint
            && artifact.leaseOwnerId === start.leaseOwnerId && artifact.fencingToken.toFixed(0) === start.fencingToken
            && artifact.outcome === 'RUNNING' && !artifact.completeMeasurement && artifact.activeMs === 0n
            && artifact.outputBytes === 0n && artifact.contentHash === requestFingerprint({})
            && requestFingerprint(artifact.payload) === artifact.contentHash;
        }
      }
      if (rejectedCheckpoint && step.resultRef !== null && confirmationOnly && !rejectedResult && receipt.kind === 'recorded') {
        // Normal continuation can reconcile a recorded rejection against the
        // immutable first confirmation. It settles FAILED/NONE without creating
        // a second business phase. Validate that original path, not a new lease
        // or a fabricated failed receipt; absence alone is never this witness.
        const readDb = new Proxy(d.db, { get(target, name) {
          if (name === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
          return Reflect.get(tx, name) ?? Reflect.get(target, name);
        } });
        const authorization = composePersistedTaskAuthorization({ ...d, db: readDb });
        const history = await new PrismaTaskConfirmationHistoryReader(readDb, authorization.tasks).read({ taskId, runId: step.runId, stepId: step.id });
        const resumes = await db.aiTaskEvent.findMany({ where: { scopeId, taskId, type: 'task.transition',
          payload: { path: '$.confirmation.checkpointRef', equals: step.resultRef } }, take: 3 });
        const continued = resumes.map(event => ({ event, parsed: aiTaskResumedConfirmationSchema.safeParse(event.payload) }))
          .filter(row => row.parsed.success && row.parsed.data.confirmation.decision === 'rejected');
        const changed = await db.aiTaskEvent.findMany({ where: { scopeId, taskId, type: 'step.changed',
          payload: { path: '$.data.stepId', equals: step.id } }, take: 3 });
        const terminalSchema = z.object({ data: z.object({ stepId: z.string(), runId: z.string(), stepRevision: z.number().int().positive(),
          status: z.literal('failed'), reason: z.enum(['result_observed', 'reconciled_not_committed']) }).strict(),
          initiator: z.object({ kind: z.literal('worker'), id: z.string(), actorKind: z.literal('USER'), actorId: z.string() }).strict(),
          evidence: z.object({ id: z.string(), revision: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
        }).passthrough();
        const settled = changed.map(event => ({ event, parsed: terminalSchema.safeParse(event.payload) })).filter(row => row.parsed.success);
        const run = await db.aiRun.findFirst({ where: { scopeId, taskId, id: step.runId } });
        const resumed = continued[0], terminal = settled[0];
        if (continued.length === 1 && settled.length === 1 && resumed.parsed.success && terminal.parsed.success) {
          const proof = resumed.parsed.data.confirmation, result = terminal.parsed.data;
          rejectedResult = history.phases.length === 1 && history.phases[0].sequence === 1
            && history.phases[0].kind === 'confirmation' && history.phases[0].receiptId === step.resultRef
            && history.transitions.length === 2 && history.transitions[0].kind === 'paused' && history.transitions[1].kind === 'continued'
            && proof.checkpointRef === step.resultRef && proof.runId === step.runId && proof.stepId === step.id
            && proof.stepRevision + 1 === step.revision && proof.decisionRef === receipt.record.approvalId
            && result.data.stepId === step.id && result.data.runId === step.runId && result.data.stepRevision === step.revision
            && result.evidence.id === step.resultRef && result.evidence.revision + 1 === step.revision
            && result.initiator.actorId === context.actor.userId && result.initiator.id === proof.holderId
            && terminal.event.taskRevision === resumed.event.taskRevision + 1
            && terminal.event.occurredAt instanceof Date && resumed.event.occurredAt instanceof Date
            && terminal.event.occurredAt >= resumed.event.occurredAt && terminal.event.occurredAt <= clock()
            && !!run && run.scopeId === scopeId && run.taskId === taskId && run.id === step.runId
            && run.actorKind === 'USER' && run.actorId === context.actor.userId
            && ['FAILED', 'PARTIALLY_SUCCEEDED', 'CANCELLED'].includes(run.status)
            && run.leaseOwnerId === null && run.leaseExpiresAt === null;
        }
      }
      const tenantId = context.scope.tenantId;
      const quote = await quoteRoute.withOrderReview(context, view.facts.input.payload,
        () => d.quoteFacts.findQuote(tenantId, view.facts.input.payload.quoteId, tx));
      if (quote && (quote.id !== view.facts.input.payload.quoteId || quote.tenantId !== context.scope.tenantId)) throw deniedOrder();
      const latest = await policy.authorizeRead(taskId, tx);
      if (scopeId !== latest.scopeId || orderContextHash(context) !== orderContextHash(latest.context)) throw deniedOrder();
      return { scopeId, identity: orderContextHash(context), scope: context.scope, view, step, receipt, consumption, business, idempotencyKey,
        quote: quote ? { consumedAt: quote.consumedAt ?? null, consumedOrderId: quote.consumedOrderId ?? null } : null, rejectedResult, confirmationOnly };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 15000 });
    try {
      const first = await observe(), current = await observe();
      if (requestFingerprint(first) !== requestFingerprint(current)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const { view, receipt, consumption, business, step, scope, scopeId, idempotencyKey, quote, rejectedResult, confirmationOnly } = current;
      const action = view.proposal.payload.actions[0];
      const result = (state: AiApprovalReprepareEligibilityDraft['state']) => {
        const canRequestReprepare = state === 'rejected' || state === 'expired' || state === 'change_requested';
        const nextAction = canRequestReprepare ? 'provide_new_materials' : state === 'pending' ? 'review_or_decide'
          : state === 'committed' ? 'read_original_result' : state === 'superseded' ? 'read_reprepare_receipt' : 'reconcile_original';
        return approvalApplicationContract('AiApprovalReprepareEligibilityDraft', {
          draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original, state, canRequestReprepare, nextAction
        }, true);
      };
      if (consumption) {
        const bound = consumption.scopeId === scopeId && consumption.taskId === taskId && consumption.actionId === action.actionId
          && consumption.proposalId === original.proposalId && consumption.proposalRevision === original.proposalRevision
          && consumption.actionFingerprint === action.input.contentHash && consumption.businessIdempotencyKey === idempotencyKey
          && receipt.kind === 'recorded' && receipt.record.decision === 'approved' && receipt.record.approvalId === consumption.approvalId;
        const committed = bound && consumption.status === 'COMMITTED' && !!consumption.resultRef
          && business?.tenantId === scope.tenantId && business.workspaceId === scope.workspaceId
          && business.action === 'rental.order.create' && business.idempotencyKey === idempotencyKey
          && business.requestHash === action.input.contentHash && business.status === 'succeeded' && business.orderId === consumption.resultRef;
        return result(committed ? 'committed' : 'unknown');
      }
      if (business || step.effect !== 'NONE' && !confirmationOnly || step.resultRef && !rejectedResult || step.status === 'UNKNOWN' || step.status === 'SUCCEEDED'
        || !quote || quote.consumedAt || quote.consumedOrderId) return result('unknown');
      if (receipt.kind === 'recorded' && receipt.record.decision === 'approved') return result('approved_uncommitted');
      if (view.proposal.status === 'superseded') return result('superseded');
      if (receipt.kind === 'recorded' && receipt.record.decision === 'rejected') return result('rejected');
      const now = clock().getTime();
      if (!Number.isFinite(now)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (view.proposal.status === 'expired' || Date.parse(view.deterministic.decisionExpiresAt) <= now
        || Date.parse(view.deterministic.quoteExpiresAt) <= now) {
        return result(view.proposal.status === 'confirmed' || view.proposal.status === 'cancelled' ? 'unknown' : 'expired');
      }
      if (receipt.kind === 'unknown' || view.proposal.status !== 'pending_confirmation') return result('unknown');
      return result(request.intent === 'change_plan' ? 'change_requested' : 'pending');
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  };
}
