import { z } from 'zod';
import type { AiTaskListRepository } from './ai-task-list.repository';
import type { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import { originalRequestReferenceSchema, freezeOriginalInput } from './task-request/original-request.validation';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiOriginalSceneResultService } from './scenes/original-scene-result.service';
import type { AiTaskEventRepository } from './ai-task-event.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { AI_QUOTE_SELECTION_DRAFT_VERSION } from '../../../../../packages/shared/src/ai-quote-selection-draft';
import type { PrismaQuoteSelectionRepository } from './task-request/prisma-quote-selection.repository';
import type { composeHumanQuoteOrder } from './scenes/human-quote-order.composition';

type OriginalScenes = ReturnType<typeof composeAiOriginalScenes>;
const page = z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
  status: z.string().min(1).max(64).optional(), sceneCode: z.string().min(1).max(191).optional() }).strict();
const eventRead = z.object({ original: originalRequestReferenceSchema, after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),
  limit: z.number().int().min(1).max(100) }).strict();
const taskRead = z.object({ original: originalRequestReferenceSchema, taskId: z.string().min(1).max(191).optional() }).strict();
const approvalRead = z.object({ original: originalRequestReferenceSchema, taskId: z.string().min(1).max(191).optional(),
  reference: z.unknown() }).strict();
const selectionRead = taskRead.extend({ selectionId: z.string().min(1).max(191) }).strict();

/**
 * Read-only task-center consumer. It deliberately does not become a second
 * task facade: listing, original request authorization and recovery remain in
 * their existing repositories. Model answers use the original-scene result
 * reader, not metadata, event bodies or caller-provided answers.
 */
export function composeAiTaskCenterScene(input: {
  list: Pick<AiTaskListRepository, 'readPage'>;
  events?: Pick<AiTaskEventRepository, 'readPage'>;
  modelResults?: Pick<AiOriginalSceneResultService, 'read'> & Partial<Pick<AiOriginalSceneResultService, 'reopenSource'>>;
  input?: { read(value: unknown): Promise<unknown> };
  selections?: Pick<PrismaQuoteSelectionRepository, 'read'>;
  approvals?: Pick<ReturnType<typeof composeHumanQuoteOrder>, 'readSelectedProposal' | 'readSelectedDecisionReceipt'>;
  scenes: Pick<OriginalScenes, 'readTaskReceipt' | 'readRecovery'> & {
    requests: Pick<OriginalScenes['requests'], 'readHistorical'>;
  };
}) {
  if (!input?.list || typeof input.list.readPage !== 'function' || !input.scenes
    || typeof input.scenes.requests?.readHistorical !== 'function' || typeof input.scenes.readTaskReceipt !== 'function'
    || typeof input.scenes.readRecovery !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');

  return Object.freeze({
    readPage: async (value: unknown = {}) => {
      const parsed = page.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return input.list.readPage(parsed.data);
    },
    readEvents: async (value: unknown) => {
      const parsed = eventRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.events?.readPage !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const command = freezeOriginalInput(parsed.data);
      const inputRef = z.string().parse(command.original.inputRef);
      const before = await input.scenes.requests.readHistorical(command.original);
      const task = await input.scenes.readTaskReceipt(inputRef);
      if (task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const taskId = z.string().parse(task.taskId), runId = z.string().parse(task.runId);
      const events = await input.events.readPage({ taskId, after: command.after, limit: command.limit });
      const after = await input.scenes.requests.readHistorical(command.original);
      const latest = await input.scenes.readTaskReceipt(inputRef);
      if (originalIdentityHash(before.context) !== originalIdentityHash(after.context)
        || before.receipt.contentHash !== after.receipt.contentHash || after.receipt.state === 'revoked'
        || latest.state !== 'observed' || latest.taskId !== taskId || latest.runId !== runId
        || events.taskId !== taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // Return the existing formal page/reset contract unchanged. This consumer
      // never turns a cursor into Number, advances it itself, or starts a run.
      return events;
    },
    readModelResult: async (value: unknown) => {
      if (typeof input.modelResults?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return input.modelResults.read(value);
    },
    readInput: async (value: unknown) => {
      const parsed = taskRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.input?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const task = await readObservedTask(parsed.data.original, parsed.data.taskId);
      const result = await input.input.read(parsed.data.original);
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId, runId: task.runId, input: result,
        execution: 'read_only_no_start_no_reconnect_side_effect' as const });
    },
    readSelection: async (value: unknown) => {
      const parsed = selectionRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.selections?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const task = await readObservedTask(parsed.data.original, parsed.data.taskId);
      const result = await input.selections.read({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
        originalInputRef: parsed.data.original.inputRef, selectionId: parsed.data.selectionId });
      const selection = z.object({ taskId: z.string().min(1).max(191), runId: z.string().min(1).max(191) }).passthrough().parse(result);
      if (selection.taskId !== task.taskId || selection.runId !== task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId, selection });
    },
    readApprovalReview: async (value: unknown) => {
      const parsed = approvalRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.approvals?.readSelectedProposal !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const task = await readObservedTask(parsed.data.original, parsed.data.taskId);
      const review = await input.approvals.readSelectedProposal(parsed.data.reference);
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId,
        review,
        order: 'not_created_by_read' as const });
    },
    readApprovalReceipt: async (value: unknown) => {
      const parsed = approvalRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.approvals?.readSelectedDecisionReceipt !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const task = await readObservedTask(parsed.data.original, parsed.data.taskId);
      const receipt = await input.approvals.readSelectedDecisionReceipt(parsed.data.reference);
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId,
        receipt,
        order: 'not_created_by_read' as const });
    },
    reopenModelSource: async (value: unknown) => {
      if (typeof input.modelResults?.reopenSource !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return input.modelResults.reopenSource(value);
    },
    readTask: async (value: unknown) => {
      const ref = originalRequestReferenceSchema.safeParse(value);
      if (!ref.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const frozen = freezeOriginalInput(ref.data);
      const inputRef = z.string().parse(frozen.inputRef);
      const original = await input.scenes.requests.readHistorical(frozen);
      const task = await input.scenes.readTaskReceipt(inputRef);
      const recovery = task.state === 'observed' ? await input.scenes.readRecovery(frozen)
        : { nextAction: 'reconcile_request_or_explicit_create_task' as const, automaticExecution: false as const };
      const after = await input.scenes.requests.readHistorical(frozen);
      const latest = await input.scenes.readTaskReceipt(inputRef);
      if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)
        || original.receipt.contentHash !== after.receipt.contentHash || after.receipt.state === 'revoked'
        || latest.state !== task.state || (latest.state === 'observed' && task.state === 'observed'
          && (latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision))) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      return freezeOriginalInput({
        original: { receipt: original.receipt, sceneCode: original.request.sceneCode,
          sceneVersion: original.receipt.sceneVersion, inputRef: original.receipt.inputRef,
          inputRevision: original.receipt.revision, inputHash: original.receipt.contentHash,
          scope: original.context.scope, audience: original.context.audience },
        task,
        recovery,
        result: { status: ('resultAvailable' in task && task.resultAvailable) ? 'available_to_authorized_result_reader' as const : 'not_available' as const,
          execution: 'not_inferred_from_metadata' as const },
        execution: 'read_only_no_start_no_reconnect_side_effect' as const
      });
    }
  });

  async function readObservedTask(reference: z.infer<typeof originalRequestReferenceSchema>, expectedTaskId?: string) {
    const original = await input.scenes.requests.readHistorical(reference);
    const inputRef = z.string().parse(reference.inputRef);
    const task = await input.scenes.readTaskReceipt(inputRef);
    const identity = z.object({ taskId: z.string().min(1).max(191), runId: z.string().min(1).max(191), revision: z.number().int().nonnegative() }).safeParse(task);
    if (task.state !== 'observed' || !identity.success || (expectedTaskId && expectedTaskId !== identity.data.taskId))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const latest = await input.scenes.readTaskReceipt(inputRef);
    const after = await input.scenes.requests.readHistorical(reference);
    if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash || after.receipt.state === 'revoked'
      || latest.state !== 'observed' || latest.taskId !== identity.data.taskId || latest.runId !== identity.data.runId
      || latest.revision !== identity.data.revision) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { taskId: identity.data.taskId, runId: identity.data.runId, revision: identity.data.revision };
  }
  async function assertStillCurrent(reference: z.infer<typeof originalRequestReferenceSchema>, expected: { taskId: string; runId: string; revision: number }) {
    const latest = await readObservedTask(reference, expected.taskId);
    if (latest.runId !== expected.runId || latest.revision !== expected.revision) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
}
