/** Historical observation of a registered original order action, not another
 * executor/reconciler. Reuses the original approval/snapshot/consumption source,
 * requires current Task + original order Guard, and never acquires a lease. */
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import type { PersistedApprovedOrderPolicyDependencies } from './approval-execution/persisted-approved-order-policy.authority';
import { PersistedApprovedOrderPolicyAuthority } from './approval-execution/persisted-approved-order-policy.authority';
import { PrismaApprovedOrderSnapshotSource } from './approval-execution/prisma-approved-order-snapshot.source';
import { PrismaApprovedOrderSource, orderContextHash } from './approval-execution/prisma-approved-order.source';
import { AiOrderRouteContextAuthority } from './order-route-context.authority';
import type { resolveTaskCenterBusinessTarget } from './task-center-business.reader';

export interface TaskCenterOriginalOrderDependencies extends Omit<PersistedApprovedOrderPolicyDependencies, 'credentials' | 'toolVersion'> {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Pick<RentalCoreService, 'readOrderFacts'>;
}
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export async function readTaskCenterOriginalOrder(d: TaskCenterOriginalOrderDependencies, credentials: AiTaskCredentialSource,
  target: Awaited<ReturnType<typeof resolveTaskCenterBusinessTarget>>) {
  const { task, query, step } = target;
  if (task.inputRef !== null || step.toolCode !== 'rental.order.commit' || !step.actionId || !step.inputRef
    || typeof d.core?.readOrderFacts !== 'function') throw unavailable();
  const where = { scopeId: task.scopeId, taskId: query.taskId, actionId: step.actionId };
  const read = () => d.db.aiApprovalConsumption.findFirst({ where, select: {
    scopeId: true, taskId: true, actionId: true, approvalId: true, proposalId: true, proposalRevision: true,
    actionFingerprint: true, businessIdempotencyKey: true, status: true, resultRef: true } });
  const receipt = await read();
  const verify = async () => {
    if (requestFingerprint(await read()) !== requestFingerprint(receipt)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await target.verify();
  };
  // No receipt is not a rollback or resubmission witness. The public observation
  // carries no such claim, including when a step says succeeded or unknown.
  if (!receipt) {
    await verify();
    return { status: step.status === 'UNKNOWN' || step.effect !== 'NONE' ? 'unknown' as const : 'not_observed' as const, retryable: false as const };
  }
  if (Object.entries(where).some(([key, value]) => receipt[key as keyof typeof receipt] !== value)
    || receipt.actionFingerprint !== step.requestFingerprint) throw unavailable();
  if (receipt.status !== 'COMMITTED' || !receipt.resultRef) {
    await verify(); return { status: 'unknown' as const, retryable: false as const };
  }
  const version = await d.db.aiProposalVersion.findFirst({ where: { scopeId: task.scopeId, taskId: query.taskId,
    proposalId: receipt.proposalId, revision: receipt.proposalRevision }, select: { payloadHash: true } });
  if (!version) throw unavailable();
  const policy = new PersistedApprovedOrderPolicyAuthority({ ...d, credentials, toolVersion: AI_TOOL_DRAFT_VERSION });
  const source = new PrismaApprovedOrderSource({ db: d.db, policy, snapshots: new PrismaApprovedOrderSnapshotSource(d.db, policy),
    toolVersion: AI_TOOL_DRAFT_VERSION, clock: d.clock });
  const reference = { taskId: query.taskId, runId: query.runId, actionId: step.actionId, approvalId: receipt.approvalId,
    proposalId: receipt.proposalId, proposalRevision: receipt.proposalRevision, reviewedPayloadHash: version.payloadHash };
  const original = await source.readCommitted(reference);
  if (original.committedId !== receipt.resultRef) throw unavailable();
  return new AiOrderRouteContextAuthority(d.guard, credentials, receipt.resultRef, d.clock).withOrderRead(async context => {
    if (orderContextHash(context) !== orderContextHash(original.input.context) || context.scope.kind !== 'workspace')
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const order = await d.core.readOrderFacts(context.scope.tenantId, receipt.resultRef!);
    if (order.id !== receipt.resultRef || order.tenantId !== context.scope.tenantId || order.workspaceId !== context.scope.workspaceId
      || order.quoteId !== original.binding.request.quoteId) throw unavailable();
    const latest = await source.readCommitted(reference);
    if (latest.committedId !== original.committedId || requestFingerprint(latest.binding) !== requestFingerprint(original.binding)
      || latest.payloadHash !== original.payloadHash || latest.previewHash !== original.previewHash
      || orderContextHash(latest.input.context) !== orderContextHash(original.input.context)) throw unavailable();
    await verify();
    return { status: 'committed' as const, order: { id: order.id, status: order.status, quoteId: order.quoteId } };
  });
}
