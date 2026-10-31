import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AI_APPROVAL_APPLICATION_DRAFT_VERSION } from '@rental-os/shared';
import type { AiApprovalReprepareEligibilityDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { composeApprovedOrderHumanApproval } from './approved-order-human.composition';
import { approvalApplicationContract } from './approval-application-contracts';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';

type Human = ReturnType<typeof composeApprovedOrderHumanApproval>;

export function composeApprovedOrderReprepareEligibility(d: ControlledApprovedOrderDependencies, human: Human) {
  const policy = new PersistedApprovedOrderPolicyAuthority({ ...d, toolVersion: AI_TOOL_DRAFT_VERSION });
  const clock = d.clock ?? (() => new Date());
  return async (taskId: string, value: unknown): Promise<AiApprovalReprepareEligibilityDraft> => {
    const request = approvalApplicationContract('AiApprovalReprepareEligibilityRequestDraft', value);
    const { original } = request;
    const observe = async () => {
      const current = await policy.authorizeRead(taskId), { context, scopeId } = current;
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw deniedOrder();
      const view = await human.readOriginal(taskId, original), action = view.proposal.payload.actions[0];
      const key = { scopeId, taskId, actionId: action.actionId };
      const step = await d.db.aiStep.findFirst({ where: key, select: { scopeId: true, taskId: true, actionId: true,
        toolCode: true, toolVersion: true, requestFingerprint: true, status: true, effect: true, resultRef: true, revision: true } });
      if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
        || step.toolCode !== action.toolCode || step.toolVersion !== action.toolVersion
        || step.requestFingerprint !== action.input.contentHash) throw deniedOrder();
      const approval = await d.db.aiApproval.findFirst({ where: { scopeId, taskId, proposalId: original.proposalId,
        proposalRevision: original.proposalRevision, actorKind: 'USER', actorId: context.actor.userId }, select: { decision: true } });
      const receipt = await human.readReceipt(taskId, { ...original, decision: approval?.decision === 'REJECTED' ? 'reject' : 'approve' });
      const consumption = await d.db.aiApprovalConsumption.findFirst({ where: key });
      const idempotencyKey = `ai-order:${requestFingerprint([scopeId, taskId, action.actionId])}`;
      const business = await d.db.rentalOrderIdempotencyRecord.findUnique({
        where: { workspaceId_action_idempotencyKey: { workspaceId: context.scope.workspaceId, action: 'rental.order.create', idempotencyKey } },
        select: { tenantId: true, workspaceId: true, action: true, idempotencyKey: true, requestHash: true, orderId: true, status: true }
      });
      const quote = await d.quoteFacts.findQuote(context.scope.tenantId, view.facts.input.payload.quoteId);
      if (quote && (quote.id !== view.facts.input.payload.quoteId || quote.tenantId !== context.scope.tenantId)) throw deniedOrder();
      const latest = await policy.authorizeRead(taskId);
      if (scopeId !== latest.scopeId || orderContextHash(context) !== orderContextHash(latest.context)) throw deniedOrder();
      return { scopeId, identity: orderContextHash(context), scope: context.scope, view, step, receipt, consumption, business, idempotencyKey,
        quote: quote ? { consumedAt: quote.consumedAt ?? null, consumedOrderId: quote.consumedOrderId ?? null } : null };
    };
    try {
      const first = await observe(), current = await observe();
      if (requestFingerprint(first) !== requestFingerprint(current)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const { view, receipt, consumption, business, step, scope, scopeId, idempotencyKey, quote } = current;
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
      if (business || step.effect !== 'NONE' || step.resultRef || step.status === 'UNKNOWN' || step.status === 'SUCCEEDED'
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
