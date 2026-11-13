/** Current original approval references for an owned display Task.
 * References only open the existing human review. No proposal is created,
 * approved or executed, and model text never selects another Task or scope. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, type AiApprovalApplicationReferenceDraft,
  type AiTaskReviewQueryDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import type { AiWorkbenchDisplayOriginalMaterial } from './workbench-display-original.reader';
import { approvalApplicationContract } from './approval-execution/approval-application-contracts';
import { settingsContract } from './approval-execution/approved-settings-contracts';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { originalIdentityHash } from './task-request/original-request.authority';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reviewBase = { taskId: id, runId: id, stepId: id, taskRevision: z.number().int().min(1).max(4294967294),
  checkpointRef: id, businessExecution: z.literal('not_attested'), review: z.unknown() };
const reviewPacket = z.discriminatedUnion('kind', [z.object({ ...reviewBase, kind: z.literal('order'),
  selection: z.unknown().optional() }).strict(), z.object({ ...reviewBase, kind: z.literal('settings') }).strict()]);

export function createWorkbenchDisplayConfirmationReader(input: {
  db: Db; tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  review(query: AiTaskReviewQueryDraft): Promise<unknown>;
  clock?: () => Date;
}) {
  return async (original: AiWorkbenchDisplayOriginalMaterial): Promise<AiApprovalApplicationReferenceDraft[]> => {
    const taskId = original.task.taskId, clock = input.clock ?? (() => new Date());
    const current = async () => {
      const access = await input.tasks.resolveAccess(taskId, 'read_step_terminal');
      if (access.actorKind !== 'USER' || access.audience !== 'OPERATOR'
        || access.actorId !== (original.context.actor.kind === 'user' ? original.context.actor.userId : null)) throw denied();
      const task = await input.db.aiTask.findFirst({ where: access.where });
      if (!task || task.id !== taskId || task.scopeId !== original.scopeId || task.revision !== original.task.revision
        || task.inputRef !== original.original.inputRef || task.inputHash !== original.original.contentHash
        || task.status !== original.task.status) throw unavailable();
      return { access, task };
    };
    const before = await current();
    if (before.task.status !== 'WAITING_CONFIRMATION') return [];
    if (before.task.cancelRequestedAt !== null) throw unavailable();
    const key = { scopeId: before.task.scopeId, taskId };
    const target = async () => {
      const runs = await input.db.aiRun.findMany({ where: key, orderBy: { sequence: 'desc' }, take: 2 });
      const run = runs[0];
      if (!run || run.scopeId !== key.scopeId || run.taskId !== taskId || run.actorKind !== 'USER'
        || run.actorId !== before.access.actorId || run.status !== 'RUNNING'
        || runs[1]?.sequence === run.sequence) throw unavailable();
      const steps = await input.db.aiStep.findMany({ where: { ...key, runId: run.id, status: 'RUNNING', effect: 'POSSIBLE',
        toolCode: { in: ['rental.order.commit', 'tenant.notifications.commit'] } }, take: 2 });
      if (steps.length > 1) throw unavailable();
      return { run: { id: run.id, sequence: run.sequence, revision: run.revision, status: run.status },
        steps: steps.map(step => ({ id: step.id, scopeId: step.scopeId, taskId: step.taskId, runId: step.runId,
          actionId: step.actionId, toolCode: step.toolCode, revision: step.revision, status: step.status,
          inputRef: step.inputRef, requestFingerprint: step.requestFingerprint, effect: step.effect })) };
    };
    const selected = await target(), { run, steps } = selected;
    if (steps.length !== 1) return [];
    const step = steps[0], query = { taskId, runId: run.id, stepId: step.id };
    if (step.scopeId !== key.scopeId || step.taskId !== taskId || step.runId !== run.id) throw denied();
    const read = async () => {
      const parsed = reviewPacket.safeParse(structuredClone(await input.review(query)));
      if (!parsed.success) throw unavailable();
      const result = parsed.data;
      if (result.taskId !== taskId || result.runId !== query.runId || result.stepId !== query.stepId
        || result.taskRevision !== before.task.revision || result.businessExecution !== 'not_attested'
        || !['order', 'settings'].includes(result.kind)) throw denied();
      const review = result.kind === 'order' ? approvalApplicationContract('AiApprovalApplicationReviewDraft', result.review, true)
        : settingsContract('AiApprovedSettingsReviewDraft', result.review, true);
      const proposal = review.proposal, payload = proposal.payload, now = clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || payload.taskId !== taskId
        || payload.contractVersion !== AI_PROPOSAL_DRAFT_VERSION || proposal.status !== 'pending_confirmation'
        || payload.audience !== original.context.audience || !same(payload.scope, original.context.scope)
        || payload.atomicity !== 'single_action' || payload.actions.length !== 1
        || payload.actions[0].actionId !== step.actionId || payload.actions[0].toolCode !== step.toolCode
        || Date.parse(payload.expiresAt) <= now.getTime()) throw unavailable();
      return { contractVersion: payload.contractVersion, proposalId: payload.proposalId,
        proposalRevision: payload.revision, reviewedPayloadHash: proposal.payloadHash };
    };
    const reference = await read();
    if (!same(reference, await read()) || !same(selected, await target())) throw unavailable();
    const after = await current();
    if (after.access.bindingKey !== before.access.bindingKey
      || originalIdentityHash(original.context) !== original.witness.aclRevision) throw denied();
    return [reference];
  };
}
