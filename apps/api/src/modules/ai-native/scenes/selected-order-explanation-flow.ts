/** Explicit human-host continuation from the original selected order receipt.
 * Uses existing original-request/runner/Gateway applications; no HTTP route,
 * automatic business action, caller order target, approval or payment claim.
 * Lost creation is observed by its original key; explicit start is limited to
 * a still-unstarted original Task and never recreates or retries its effects. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput, originalBody, originalRequestReferenceSchema, parseOriginalRequest } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundOriginalScenes, composeRequestBoundSelectedQuoteTask } from './request-bound-scenes.application';

type Originals = Pick<ReturnType<typeof composeRequestBoundOriginalScenes>, 'create' | 'read' | 'reconcile'>;
type Orders = Pick<ReturnType<typeof composeRequestBoundSelectedQuoteTask>, 'readResult'>;
type OrderApplication = ReturnType<typeof import('./original-model-order-scene.composition').composeOriginalModelOrderScene>;
type Runtime = {
  start(request: AiSceneHttpRequest, original: unknown): ReturnType<OrderApplication['start']>;
  readOrderResult(request: AiSceneHttpRequest, original: unknown): ReturnType<OrderApplication['readOrderResult']>;
  readAnswer(request: AiSceneHttpRequest, original: unknown): ReturnType<OrderApplication['readAnswer']>;
};
const commandSchema = z.object({ selection: z.unknown(), requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  question: z.enum(['status', 'fees', 'payments', 'next_steps']) }).strict();
const parse = (value: unknown) => {
  const command = commandSchema.safeParse(structuredClone(value));
  if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(command.data);
};

export function composeSelectedOrderExplanationFlow(input: { orders: Orders; originals: Originals; runtime: Runtime }) {
  for (const method of [input.orders?.readResult, input.originals?.create, input.originals?.read, input.originals?.reconcile,
    input.runtime?.start, input.runtime?.readOrderResult, input.runtime?.readAnswer]) {
    if (typeof method !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const resolve = async (request: AiSceneHttpRequest, command: z.infer<typeof commandSchema>) => {
    const receipt = freezeOriginalInput(structuredClone(await input.orders.readResult(request, { selection: command.selection })));
    if (receipt.status !== 'committed') return { receipt, original: null };
    const original = parseOriginalRequest({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
      requestKey: `order-explain:${requestFingerprint({ operation: command.requestKey, orderId: receipt.order.id, question: command.question })}`,
      sceneCode: 'order_explanation', input: { orderId: receipt.order.id, question: command.question } });
    return { receipt, original };
  };
  const locateCreation = async (request: AiSceneHttpRequest, command: z.infer<typeof commandSchema>) => {
    const found = await resolve(request, command);
    if (!found.original) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const record = freezeOriginalInput(structuredClone(await input.originals.reconcile(request, found.original)));
    if (record.state === 'observed' && (record.receipt.requestKey !== found.original.requestKey
      || record.receipt.sceneCode !== 'order_explanation')) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (requestFingerprint(await resolve(request, command)) !== requestFingerprint(found))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { orderReceipt: found.receipt, record, original: record.state === 'observed'
      ? { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: record.receipt.inputRef } : null };
  };
  return Object.freeze({
    async readCreation(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(value), boundRequest = freezeOriginalInput(structuredClone(request));
      return freezeOriginalInput({ ...await locateCreation(boundRequest, command),
        execution: 'read_only_no_create_start_or_model' as const, automaticRetry: false as const });
    },
    async startUnstartedOriginal(request: AiSceneHttpRequest, value: unknown) {
      const parsed = commandSchema.extend({ decision: z.literal('start_unstarted_original') }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data), boundRequest = freezeOriginalInput(structuredClone(request));
      const found = await locateCreation(boundRequest, command);
      if (!found.original || found.record.state !== 'observed' || found.record.task.state !== 'observed'
        || found.record.task.status !== 'queued' || found.record.task.plan !== 'not_observed' || found.record.task.resultAvailable)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      // Metadata only filters eligibility. The existing start owns current
      // Guard/admission, exact lease, Step effects and cumulative resource caps.
      if (requestFingerprint(await locateCreation(boundRequest, command)) !== requestFingerprint(found))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      let execution;
      try { execution = await input.runtime.start(boundRequest, found.original); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      try {
        const latest = await locateCreation(boundRequest, command);
        if (requestFingerprint(latest.orderReceipt) !== requestFingerprint(found.orderReceipt)
          || requestFingerprint(latest.original) !== requestFingerprint(found.original)
          || latest.record.state !== 'observed' || latest.record.task.state !== 'observed'
          || latest.record.task.taskId !== found.record.task.taskId || latest.record.task.runId !== found.record.task.runId)
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ orderReceipt: found.orderReceipt, original: found.original,
        task: { taskId: found.record.task.taskId, runId: found.record.task.runId }, execution,
        creation: 'original_not_recreated' as const, automaticRetry: false as const, businessExecution: 'not_attempted' as const });
    },
    async begin(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(value), boundRequest = freezeOriginalInput(structuredClone(request));
      const before = await resolve(boundRequest, command);
      if (!before.original) return freezeOriginalInput({ orderReceipt: before.receipt, creation: 'not_attempted' as const, model: 'not_called' as const });
      const creation = await input.originals.create(boundRequest, before.original);
      let after;
      try { after = await resolve(boundRequest, command); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      if (creation.stage !== 'task_metadata_created' && creation.stage !== 'existing_request') return freezeOriginalInput({ orderReceipt: before.receipt, creation, model: 'not_called' as const });
      const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: creation.receipt.inputRef };
      if (creation.stage === 'existing_request') return freezeOriginalInput({ orderReceipt: after.receipt, creation, original,
        model: 'not_called' as const, nextAction: 'read_original_explanation' as const });
      // Starting is the explicit user read/model action. The original runner
      // determines whether this exact task can start; never retry an unknown.
      const execution = await input.runtime.start(boundRequest, original);
      let closing;
      try { closing = await resolve(boundRequest, command); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      if (requestFingerprint(before) !== requestFingerprint(closing)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      return freezeOriginalInput({ orderReceipt: closing.receipt, creation, original, execution });
    },
    async read(request: AiSceneHttpRequest, value: unknown) {
      const parsed = commandSchema.extend({ original: originalRequestReferenceSchema }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { original, ...command } = freezeOriginalInput(parsed.data), boundRequest = freezeOriginalInput(structuredClone(request));
      const before = await resolve(boundRequest, command);
      if (!before.original) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const saved = await input.originals.read(boundRequest, original);
      if (saved.receipt.requestKey !== before.original.requestKey
        || requestFingerprint(saved.request) !== requestFingerprint(originalBody(before.original))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const order = await input.runtime.readOrderResult(boundRequest, original);
      const answer = await input.runtime.readAnswer(boundRequest, original);
      if (answer.result.status === 'available' && (order.result.status !== 'available'
        || answer.result.originalReadResultId !== order.result.resultId)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (requestFingerprint(before) !== requestFingerprint(await resolve(boundRequest, command))) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ orderReceipt: before.receipt, original, order, answer, businessExecution: 'not_attempted' as const });
    }
  });
}
