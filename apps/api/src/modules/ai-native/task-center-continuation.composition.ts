/** Explicit human continuation delegates to the one original host. No new
 * runner, plan, lease, budget, approval or Core executor is constructed here. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AiTaskHumanContinuationDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { composeTaskCenterApproval, taskCenterDecisionSchema, taskCenterReviewSchema,
  type TaskCenterApprovalDependencies } from './task-center-approval.composition';
import { resolveTaskCenterBusinessTarget, readTaskCenterOrderSelection } from './task-center-business.reader';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type Request = { headers: { authorization?: unknown } };
export interface TaskCenterContinuationDependencies {
  db: PrismaClient;
  order?: { continueConfirmation(request: Request, value: unknown, signal?: AbortSignal): Promise<unknown> };
  /** Already-published action-input plan, never a selected-quote fallback. */
  originalOrder?: { continueConfirmation(credentials: AiTaskCredentialSource, value: unknown, signal?: AbortSignal): Promise<unknown> };
  settings?: { continueSettingsConfirmation(request: Request, value: unknown, signal?: AbortSignal): Promise<unknown> };
}
export const taskCenterContinueSchema = taskCenterReviewSchema.extend({
  checkpointRef: z.string().uuid(), expectedTaskRevision: z.number().int().min(1).max(4294967294),
  proposal: taskCenterDecisionSchema.shape.proposal.omit({ decision: true }).strict()
}).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const unknown = () => Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
const response = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_started'), reason: z.string().min(1).max(128).regex(/^[a-z_]+$/u) }).passthrough(),
  z.object({ kind: z.literal('run_outcome'), outcome: z.object({ status: z.enum([
    'succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown', 'unavailable', 'failed'
  ]) }).passthrough() }).passthrough()
]);
export async function continueTaskCenterOriginal(d: TaskCenterContinuationDependencies, approval: TaskCenterApprovalDependencies,
  credentials: AiTaskCredentialSource, tasks: Pick<AiTaskRepository, 'resolveAccess'>,
  request: Request, value: unknown, signal?: AbortSignal): Promise<AiTaskHumanContinuationDraft> {
  const command = taskCenterContinueSchema.parse(structuredClone(value));
  const { checkpointRef, expectedTaskRevision, proposal, ...query } = command;
  const order = d.order?.continueConfirmation.bind(d.order), settings = d.settings?.continueSettingsConfirmation.bind(d.settings);
  const originalOrder = d.originalOrder?.continueConfirmation.bind(d.originalOrder);
  if (approval.order.db !== d.db || approval.settings.db !== d.db) throw unavailable();
  // Bound only preflight reads, not the original runner's legitimate duration.
  // A late preflight never enters the continuation below.
  const prepared = await waitForTaskApplicationDependency(async () => {
    const target = await resolveTaskCenterBusinessTarget(d, tasks, query);
    const human = composeTaskCenterApproval(approval, credentials, tasks), review = await human.review(query);
    if (review.checkpointRef !== checkpointRef || review.taskRevision !== expectedTaskRevision
      || review.review.proposal.payloadHash !== proposal.reviewedPayloadHash
      || review.review.proposal.payload.proposalId !== proposal.proposalId
      || review.review.proposal.payload.revision !== proposal.proposalRevision
      || review.review.proposal.payload.contractVersion !== proposal.contractVersion) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const decision = review.review.proposal.status === 'cancelled' ? 'reject' as const : 'approve' as const;
    const receipt = await human.decisionReceipt({ ...query, proposal: { ...proposal, decision } });
    if (receipt.receipt.kind !== 'recorded' || receipt.receipt.record.decision !== (decision === 'reject' ? 'rejected' : 'approved')) throw unavailable();
    if (!approval.decisions[review.kind]) throw unavailable();
    const originalPlan = review.kind === 'order' && target.task.inputRef === null;
    const selected = review.kind === 'order' && !originalPlan ? await readTaskCenterOrderSelection(d.db, target) : null;
    if (selected) await selected.verify(); else await target.verify();
    if (requestFingerprint(review.review.proposal.payload) !== proposal.reviewedPayloadHash) throw unavailable();
    return { target, selected, originalPlan, kind: review.kind };
  }, false, signal);
  if (signal?.aborted) throw unknown();
  await credentials.current();
  if (prepared.kind === 'order' ? prepared.originalPlan ? !originalOrder : !order || !prepared.selected : !settings) throw unavailable();
  try {
    const raw = prepared.kind === 'order'
      ? prepared.originalPlan ? await originalOrder!(credentials, command, signal)
        : await order!(request, { selection: prepared.selected!.selection, checkpointRef }, signal)
      : await settings!(request, { taskId: query.taskId, runId: query.runId, checkpointRef }, signal);
    const result = response.safeParse(structuredClone(raw));
    // A malformed reply or failed post-read may follow an already committed
    // Core transaction. Current access refusal stays refusal, not rollback.
    if (!result.success) throw unknown();
    if ((await tasks.resolveAccess(query.taskId, 'read_step_terminal')).bindingKey !== prepared.target.access.bindingKey)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const base = { ...query, automaticRetry: false as const, businessExecution: 'read_original_receipt' as const };
    return result.data.kind === 'not_started' ? { ...base, kind: 'not_started', reason: result.data.reason }
      : { ...base, kind: 'run_outcome', status: result.data.outcome.status };
  } catch (error) {
    if (error instanceof Error && 'code' in error && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(String(error.code))) throw error;
    throw unknown();
  }
}
