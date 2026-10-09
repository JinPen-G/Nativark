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
import { parseQuoteSelectionProof } from './task-request/quote-selection.validation';
import type { composeAiSettingsBusinessConsumer } from './scenes/settings-business-consumer.composition';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type OriginalScenes = ReturnType<typeof composeAiOriginalScenes>;
const page = z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
  status: z.string().min(1).max(64).optional(), sceneCode: z.string().min(1).max(191).optional() }).strict();
const eventRead = z.object({ original: originalRequestReferenceSchema, after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),
  limit: z.number().int().min(1).max(100) }).strict();
const taskRead = z.object({ original: originalRequestReferenceSchema, taskId: z.string().min(1).max(191).optional() }).strict();
const approvalRead = z.object({ original: originalRequestReferenceSchema, taskId: z.string().min(1).max(191).optional(),
  reference: z.unknown() }).strict();
const selectionRead = taskRead.extend({ selectionId: z.string().min(1).max(191) }).strict();
const sceneId = z.string().min(1).max(191);
const aggregateRead = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original'), taskId: sceneId, runId: sceneId, original: originalRequestReferenceSchema,
    resultId: sceneId.optional(), review: z.unknown().optional(), decision: z.unknown().optional(), order: z.unknown().optional() }).strict(),
  z.object({ kind: z.literal('settings'), taskId: sceneId, runId: sceneId, reference: z.unknown() }).strict()
]);

/**
 * Read-only task-center consumer. It deliberately does not become a second
 * task facade: listing, original request authorization and recovery remain in
 * their existing repositories. Model answers use the original-scene result
 * reader, not metadata, event bodies or caller-provided answers.
 */
export function composeAiTaskCenterScene(input: {
  list: Pick<AiTaskListRepository, 'readPage'>;
  events?: Pick<AiTaskEventRepository, 'readPage'> & Partial<Pick<AiTaskEventRepository, 'readSnapshot'>>;
  settings?: Pick<ReturnType<typeof composeAiSettingsBusinessConsumer>, 'read'>;
  modelResults?: Pick<AiOriginalSceneResultService, 'read'> & Partial<Pick<AiOriginalSceneResultService, 'reopenSource'>>;
  input?: { read(value: unknown): Promise<unknown> };
  selections?: Pick<PrismaQuoteSelectionRepository, 'read'>;
  approvals?: Pick<ReturnType<typeof composeHumanQuoteOrder>, 'readSelectedProposal' | 'readSelectedDecisionReceipt'>;
  orders?: Pick<ReturnType<typeof composeHumanQuoteOrder>, 'readSelectedOrderResult'>;
  scenes: Pick<OriginalScenes, 'readTaskReceipt' | 'readRecovery'> & {
    requests: Pick<OriginalScenes['requests'], 'readHistorical'>;
  };
}) {
  if (!input?.list || typeof input.list.readPage !== 'function' || !input.scenes
    || typeof input.scenes.requests?.readHistorical !== 'function' || typeof input.scenes.readTaskReceipt !== 'function'
    || typeof input.scenes.readRecovery !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');

  const readers = Object.freeze({
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
      assertSelectedTask(parsed.data.reference, parsed.data.original, task);
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
      assertSelectedTask(parsed.data.reference, parsed.data.original, task);
      const receipt = await input.approvals.readSelectedDecisionReceipt(parsed.data.reference);
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId,
        receipt,
        order: 'not_created_by_read' as const });
    },
    readOrderResult: async (value: unknown) => {
      const parsed = approvalRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (typeof input.orders?.readSelectedOrderResult !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const reference = z.object({ selection: z.unknown(), command: z.unknown() }).strict().safeParse(parsed.data.reference);
      if (!reference.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const task = await readObservedTask(parsed.data.original, parsed.data.taskId);
      assertSelectedProof(reference.data.selection, parsed.data.original, task);
      const result = await input.orders.readSelectedOrderResult(reference.data);
      await assertStillCurrent(parsed.data.original, task);
      return freezeOriginalInput({ taskId: task.taskId, runId: task.runId, result,
        execution: 'read_only_no_start_no_reconnect_side_effect' as const });
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

  return Object.freeze({ ...readers,
    /** Bounded aggregation of the existing readers, not a new execution facade.
     * Snapshot cursor covers only its original metadata/timeline transaction;
     * the separately authorized business reads are NOT an atomic snapshot. */
    async readScene(value: unknown) {
      const parsed = aggregateRead.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      if (command.kind === 'settings') {
        if (typeof input.settings?.read !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const preparation = z.object({ preparation: z.object({ taskId: sceneId, runId: sceneId }).passthrough() }).passthrough().safeParse(command.reference);
        if (!preparation.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        if (preparation.data.preparation.taskId !== command.taskId || preparation.data.preparation.runId !== command.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const first = await input.settings.read(command.reference);
        if (!('task' in first)) return freezeOriginalInput({ kind: command.kind, taskId: command.taskId, runId: command.runId,
          business: first, snapshot: { availability: 'unavailable' as const },
          consistency: 'independent_authorized_reads' as const, execution: 'read_only_no_start_no_reconnect_side_effect' as const });
        const snapshot = await readSnapshot(command.taskId, first.task.revision);
        const latest = await input.settings.read(command.reference);
        if (!('task' in latest)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const { observedAt: _firstObservation, ...firstEvidence } = first;
        const { observedAt: _latestObservation, ...latestEvidence } = latest;
        if (requestFingerprint(latestEvidence) !== requestFingerprint(firstEvidence)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return freezeOriginalInput({ kind: command.kind, taskId: command.taskId, runId: command.runId, snapshot,
          originalInput: { inputRef: first.step.inputRef, fingerprint: first.step.fingerprint, change: first.change },
          business: first, submission: 'not_attested_by_approval' as const,
          consistency: 'independent_authorized_reads' as const, execution: 'read_only_no_start_no_reconnect_side_effect' as const });
      }
      const current = await readObservedTask(command.original, command.taskId);
      if (current.runId !== command.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const task = await readers.readTask(command.original);
      const snapshot = await readSnapshot(current.taskId, current.revision);
      const original = await input.scenes.requests.readHistorical(command.original);
      const originalInput = { receipt: original.receipt, request: original.request };
      const pendingInput = typeof input.input?.read === 'function'
        ? await readers.readInput({ original: command.original, taskId: current.taskId }) : { availability: 'unavailable' as const };
      const model = command.resultId ? await readers.readModelResult({ original: command.original, resultId: command.resultId })
        : { availability: 'not_requested' as const };
      const review = command.review !== undefined ? await readers.readApprovalReview({ original: command.original, taskId: current.taskId, reference: command.review })
        : { availability: 'not_requested' as const };
      const decision = command.decision !== undefined ? await readers.readApprovalReceipt({ original: command.original, taskId: current.taskId, reference: command.decision })
        : { availability: 'not_requested' as const };
      const business = command.order !== undefined ? await readers.readOrderResult({ original: command.original, taskId: current.taskId, reference: command.order })
        : { availability: 'not_requested' as const };
      await assertStillCurrent(command.original, current);
      return freezeOriginalInput({ kind: command.kind, taskId: current.taskId, runId: current.runId, task, snapshot,
        originalInput, pendingInput, model, review, decision, business, submission: 'not_attested_by_approval' as const,
        consistency: 'independent_authorized_reads' as const, execution: 'read_only_no_start_no_reconnect_side_effect' as const });
    }
  });

  async function readSnapshot(taskId: string, revision: number) {
    if (typeof input.events?.readSnapshot !== 'function') return { availability: 'unavailable' as const };
    const snapshot = await input.events.readSnapshot({ taskId });
    if (snapshot.taskId !== taskId || snapshot.revision !== revision)
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { availability: 'available' as const, value: snapshot };
  }

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
    return { taskId: identity.data.taskId, runId: identity.data.runId, revision: identity.data.revision,
      identityHash: originalIdentityHash(after.context), contentHash: after.receipt.contentHash };
  }
  async function assertStillCurrent(reference: z.infer<typeof originalRequestReferenceSchema>, expected: Awaited<ReturnType<typeof readObservedTask>>) {
    const latest = await readObservedTask(reference, expected.taskId);
    if (latest.runId !== expected.runId || latest.revision !== expected.revision
      || latest.identityHash !== expected.identityHash || latest.contentHash !== expected.contentHash)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  function assertSelectedTask(value: unknown, original: z.infer<typeof originalRequestReferenceSchema>, task: { taskId: string; runId: string }) {
    const nested = z.object({ selection: z.unknown(), proposal: z.unknown() }).strict().safeParse(value);
    if (!nested.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    assertSelectedProof(nested.data.selection, original, task);
  }
  function assertSelectedProof(value: unknown, original: z.infer<typeof originalRequestReferenceSchema>, task: { taskId: string; runId: string }) {
    const selection = parseQuoteSelectionProof(value);
    if (selection.originalInputRef !== original.inputRef || selection.taskId !== task.taskId || selection.runId !== task.runId)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
}
