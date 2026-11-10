/** Task ID is a lookup, not authority. Derive the original selection/change on
 * the server and consume existing receipt readers, never submit/reconcile work. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { AI_QUOTE_SELECTION_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiTaskBusinessObservationDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { taskCenterReviewSchema } from './task-center-approval.composition';
import type { TaskCenterApprovalDependencies } from './task-center-approval.composition';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { composeApprovedSettingsWaiting } from './approval-execution/approved-settings-waiting.executor';
import { ApprovedSettingsResultUnknownError } from '../rental-core/approved-settings-change.ports';
import { readTaskCenterOriginalOrder, type TaskCenterOriginalOrderDependencies } from './task-center-original-order.reader';

type Request = { headers: { authorization?: unknown } };
export interface TaskCenterBusinessDependencies {
  db: PrismaClient;
  selectedOrderResult?: { readResult(request: Request, value: unknown): Promise<unknown> };
  /** Original published order plans have action inputs, not quote selections.
   * This observer is deliberately independent of all new-execution gates. */
  originalOrder?: TaskCenterOriginalOrderDependencies;
}
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identifier = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const orderResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('committed'), order: z.object({ id: identifier, status: identifier, quoteId: identifier }) }).passthrough(),
  z.object({ status: z.enum(['unknown', 'not_observed']), retryable: z.literal(false) }).passthrough()
]);
export async function resolveTaskCenterBusinessTarget(d: Pick<TaskCenterBusinessDependencies, 'db'>,
  tasks: Pick<AiTaskRepository, 'resolveAccess'>, value: unknown) {
  const query = taskCenterReviewSchema.parse(structuredClone(value));
  const access = structuredClone(await tasks.resolveAccess(query.taskId, 'read_step_terminal'));
  const taskRead = () => d.db.aiTask.findFirst({ where: access.where,
    select: { id: true, scopeId: true, inputRef: true, revision: true, status: true, eventCursor: true } });
  const task = structuredClone(await taskRead()); if (!task) throw unavailable();
  const taskHash = (row: typeof task | null) => row ? requestFingerprint({ ...row, eventCursor: String(row.eventCursor) }) : null;
  const key = { id: query.stepId, scopeId: task.scopeId, taskId: query.taskId, runId: query.runId };
  const stepRead = () => d.db.aiStep.findFirst({ where: key, select: {
    id: true, scopeId: true, taskId: true, runId: true, actionId: true, toolCode: true, toolVersion: true,
    inputRef: true, requestFingerprint: true, revision: true, status: true, effect: true } });
  const step = structuredClone(await stepRead());
  const run = await d.db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: query.taskId, id: query.runId },
    select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true } });
  if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v) || !run
    || run.id !== query.runId || run.scopeId !== task.scopeId || run.taskId !== query.taskId
    || run.actorKind !== access.actorKind || run.actorId !== access.actorId || step.toolVersion !== AI_TOOL_DRAFT_VERSION
    || !['rental.order.commit', 'tenant.notifications.commit'].includes(step.toolCode)) throw unavailable();
  return { query, access, task, step, verify: async () => {
    if (taskHash(await taskRead()) !== taskHash(task) || requestFingerprint(await stepRead()) !== requestFingerprint(step))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    if ((await tasks.resolveAccess(query.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  } };
}
export async function readTaskCenterOrderSelection(db: PrismaClient, target: Awaited<ReturnType<typeof resolveTaskCenterBusinessTarget>>) {
    const { task, query, access, step } = target;
    if (!task.inputRef || step.toolCode !== 'rental.order.commit') throw unavailable();
    const where = { scopeId: task.scopeId, taskId: query.taskId, runId: query.runId,
      ownerId: access.actorId, ownerKind: access.actorKind, audience: access.audience,
      originalRequestId: task.inputRef, inputHash: step.requestFingerprint };
    const selections = () => db.aiTaskQuoteSelection.findMany({ where, take: 2, orderBy: { id: 'asc' }, select: {
      id: true, scopeId: true, taskId: true, runId: true, ownerId: true, ownerKind: true, audience: true,
      originalRequestId: true, inputHash: true, quoteId: true, quoteHash: true, revision: true } });
    const rows = structuredClone(await selections()), selected = rows[0];
    if (rows.length !== 1 || !selected || Object.entries(where).some(([k, v]) => selected[k as keyof typeof selected] !== v)) throw unavailable();
    return { quoteId: selected.quoteId, selection: {
      draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: selected.originalRequestId, selectionId: selected.id,
      taskId: query.taskId, runId: query.runId, inputHash: selected.inputHash
    }, verify: async () => {
      if (requestFingerprint(await selections()) !== requestFingerprint(rows)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await target.verify();
    } };
}
export async function readTaskCenterBusiness(d: TaskCenterBusinessDependencies,
  settings: TaskCenterApprovalDependencies['settings'] | undefined, credentials: AiTaskCredentialSource,
  tasks: Pick<AiTaskRepository, 'resolveAccess'>, request: Request, value: unknown, clock = () => new Date()): Promise<AiTaskBusinessObservationDraft> {
  const readOrder = d.selectedOrderResult?.readResult.bind(d.selectedOrderResult);
  const target = await resolveTaskCenterBusinessTarget(d, tasks, value), { query, step } = target;
  const base = { ...query, observedAt: clock().toISOString(), execution: 'read_only_no_start_no_reconnect_side_effect' as const,
    payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const };
  let output: AiTaskBusinessObservationDraft;
  let verifySelection = target.verify;
  if (step.toolCode === 'rental.order.commit' && target.task.inputRef === null) {
    // Only the original action-input plan selects this route. A selected-quote
    // failure must never fall back to another provenance or execution path.
    if (!d.originalOrder || d.originalOrder.db !== d.db) throw unavailable();
    const result = orderResult.safeParse(await readTaskCenterOriginalOrder(d.originalOrder, credentials, target));
    if (!result.success) throw unavailable();
    output = result.data.status === 'committed' ? { ...base, status: 'committed', kind: 'order', order: result.data.order }
      : { ...base, status: result.data.status, kind: 'order', retryable: false };
  } else if (step.toolCode === 'rental.order.commit') {
    if (!readOrder) throw unavailable();
    const original = await readTaskCenterOrderSelection(d.db, target);
    const result = orderResult.safeParse(structuredClone(await readOrder(request, { selection: original.selection })));
    if (!result.success || result.data.status === 'committed' && result.data.order.quoteId !== original.quoteId) throw unavailable();
    output = result.data.status === 'committed' ? { ...base, status: 'committed', kind: 'order', order: result.data.order }
      : { ...base, status: result.data.status, kind: 'order', retryable: false };
    verifySelection = original.verify;
  } else {
    if (!settings || settings.db !== d.db || !step.inputRef) throw unavailable();
    const source = composeApprovedSettingsWaiting({ ...settings, credentials });
    const reference = { taskId: query.taskId, changeId: step.inputRef, changeHash: step.requestFingerprint };
    try {
      const operation = await source.readCommittedChange(reference);
      if (requestFingerprint(await source.readCommittedChange(reference)) !== requestFingerprint(operation))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      output = operation ? { ...base, status: 'committed', kind: 'settings', receipt: operation }
        : { ...base, status: step.status === 'UNKNOWN' || step.effect !== 'NONE' ? 'unknown' : 'not_observed', kind: 'settings', retryable: false };
    } catch (error) {
      if (!(error instanceof ApprovedSettingsResultUnknownError)) throw error;
      output = { ...base, status: 'unknown', kind: 'settings', retryable: false };
    }
  }
  await verifySelection();
  return structuredClone({ ...output, observedAt: clock().toISOString() });
}
