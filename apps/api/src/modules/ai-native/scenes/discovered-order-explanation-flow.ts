/** Current Core order discovery -> explicit human choice -> original explanation.
 * Candidate ids/hashes do not grant detail, task or finance access. Reuses the
 * original request/Runner/Gateway and saved-result readers; never auto-selects,
 * creates business actions, retries an unknown model call or resets resources.
 * Historical reads bind the original command but do not rerun list discovery. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, aiOrderCandidatesPageSchema, aiOrderCandidatesQuerySchema,
  type AiOrderCandidatesPageDraft, type AiOrderCandidatesQueryDraft } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { AiOrderCandidatesService } from '../tools/order-candidates.service';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput, originalBody, originalRequestReferenceSchema, parseOriginalRequest } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest, composeRequestBoundOriginalScenes } from './request-bound-scenes.application';

type Originals = Pick<ReturnType<typeof composeRequestBoundOriginalScenes>, 'create' | 'read' | 'reconcile'>;
type Application = ReturnType<typeof import('./original-model-order-scene.composition').composeOriginalModelOrderScene>;
type Runtime = {
  start(request: AiSceneHttpRequest, original: unknown): ReturnType<Application['start']>;
  readOrderResult(request: AiSceneHttpRequest, original: unknown): ReturnType<Application['readOrderResult']>;
  readAnswer(request: AiSceneHttpRequest, original: unknown): ReturnType<Application['readAnswer']>;
};
const item = aiOrderCandidatesPageSchema.shape.items.element;
const choice = z.object({ orderId: item.shape.id, orderVersion: item.shape.updatedAt }).strict();
const commandSchema = z.object({ query: aiOrderCandidatesQuerySchema, choice,
  selectionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  question: z.enum(['status', 'fees', 'payments', 'next_steps']) }).strict();
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(parsed.data);
};
const pageHash = (page: AiOrderCandidatesPageDraft) => {
  const { requestId: _request, observedAt: _at, ...material } = page;
  return requestFingerprint(material);
};
export function composeDiscoveredOrderExplanationFlow(input: {
  core: Pick<RentalCoreService, 'queryOrders' | 'readOrderFacts'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  originals: Originals;
  runtime: Runtime;
  clock?: () => Date;
}) {
  for (const method of [input.core?.queryOrders, input.core?.readOrderFacts, input.guard?.canActivate, input.credentials?.current,
    input.originals?.create, input.originals?.read, input.originals?.reconcile, input.runtime?.start, input.runtime?.readOrderResult, input.runtime?.readAnswer]) {
    if (typeof method !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const bound = (request: AiSceneHttpRequest) => freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
  const credentials = (request: AiSceneHttpRequest): AiOrderRouteCredentialSource => ({ current: async () => {
    const credential = await input.credentials.current();
    if (typeof request.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { ...credential, authorization: request.headers.authorization };
  } });
  const readPage = (request: AiSceneHttpRequest, query: AiOrderCandidatesQueryDraft) => {
    const routes = new AiBusinessReadRouteAuthority(input.guard, credentials(request), input.clock);
    return routes.withRead('order_candidates', query, async context => {
      const page = parse(aiOrderCandidatesPageSchema, await new AiOrderCandidatesService(input.core, routes, input.clock).read(query, context));
      return freezeOriginalInput({ page, context });
    });
  };
  const selected = async (request: AiSceneHttpRequest, command: z.infer<typeof commandSchema>) => {
    const { page, context } = await readPage(request, command.query);
    if (pageHash(page) !== command.selectionHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const row = page.items.find(row => row.id === command.choice.orderId);
    if (!row || row.updatedAt !== command.choice.orderVersion || row.source.id !== row.id || row.source.version !== row.updatedAt)
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    // List authority is not detail authority. Reject before even saving an
    // original request; its later creation can legitimately return input-only.
    await new AiOrderRouteContextAuthority(input.guard, credentials(request), row.id, input.clock).withOrderRead(async detail => {
      assertAiReadContextBinding(detail, context);
      if (detail.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // An unrestricted role need not trigger the Guard's restricted-row DAO.
      // Core still must attest the selected resource inside the verified ALS.
      const facts = await input.core.readOrderFacts(detail.scope.tenantId, row.id);
      if (facts.id !== row.id || facts.tenantId !== detail.scope.tenantId || facts.workspaceId !== detail.scope.workspaceId
        || facts.updatedAt !== row.updatedAt) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    });
    const { requestId: _request, authorizedAt: _at, ...identity } = context;
    return freezeOriginalInput({ audience: page.audience, scope: page.scope, row, selectionHash: pageHash(page),
      identityHash: requestFingerprint(identity) });
  };
  const originalCommand = (command: z.infer<typeof commandSchema>) => parseOriginalRequest({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
    requestKey: `discovered-order:${requestFingerprint({ operation: command.requestKey, selectionHash: command.selectionHash,
      choice: command.choice, query: command.query, question: command.question })}`,
    sceneCode: 'order_explanation', input: { orderId: command.choice.orderId, question: command.question } });
  const locateCreation = async (request: AiSceneHttpRequest, command: z.infer<typeof commandSchema>) => {
    // Reconcile is the original owner-authorized READ by immutable key/body.
    // Never call create or rediscover to obtain a lost metadata acknowledgement.
    const expected = originalCommand(command), record = freezeOriginalInput(structuredClone(await input.originals.reconcile(request, expected)));
    if (record.state === 'observed' && (record.receipt.requestKey !== expected.requestKey || record.receipt.sceneCode !== 'order_explanation'))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { record, original: record.state === 'observed' ? { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: record.receipt.inputRef } : null };
  };
  const startOriginalSchema = commandSchema.extend({ currentChoice: choice,
    currentSelectionHash: z.string().regex(/^[a-f0-9]{64}$/u), decision: z.literal('start_unstarted_original') }).strict();
  return Object.freeze({
    async readCreation(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(commandSchema, value), found = await locateCreation(bound(request), command);
      return freezeOriginalInput({ ...found, execution: 'read_only_no_discovery_create_or_start' as const, automaticRetry: false as const });
    },
    async startUnstartedOriginal(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(startOriginalSchema, value), current = bound(request);
      if (command.currentChoice.orderId !== command.choice.orderId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const found = await locateCreation(current, command);
      if (!found.original || found.record.state !== 'observed' || found.record.task.state !== 'observed'
        || found.record.task.status !== 'queued' || found.record.task.plan !== 'not_observed' || found.record.task.resultAvailable)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      // This is an eligibility filter, not proof of unconsumed effects. The
      // original start still owns exact lease/Step/plan/admission checks. A
      // stored plan or started/unknown Task must use its original recovery host.
      const fresh = { ...command, choice: command.currentChoice, selectionHash: command.currentSelectionHash };
      const before = await selected(current, fresh), same = await locateCreation(current, command);
      if (requestFingerprint(same) !== requestFingerprint(found)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      let execution;
      try { execution = await input.runtime.start(current, found.original); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      try {
        const latest = await locateCreation(current, command);
        if (requestFingerprint(await selected(current, fresh)) !== requestFingerprint(before)
          || !latest.original || requestFingerprint(latest.original) !== requestFingerprint(found.original)
          || latest.record.state !== 'observed' || latest.record.task.state !== 'observed'
          || latest.record.task.taskId !== found.record.task.taskId || latest.record.task.runId !== found.record.task.runId)
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ original: found.original, task: { taskId: found.record.task.taskId, runId: found.record.task.runId }, execution,
        currentChoice: command.currentChoice, creation: 'original_not_recreated' as const, automaticRetry: false as const,
        businessExecution: 'not_attempted' as const });
    },
    async discover(request: AiSceneHttpRequest, value: unknown) {
      const query = parse(aiOrderCandidatesQuerySchema, value), { page } = await readPage(bound(request), query);
      return freezeOriginalInput({ page, selectionHash: pageHash(page), selection: 'explicit_human_choice_required' as const,
        task: 'not_created' as const, model: 'not_called' as const, businessExecution: 'not_attempted' as const });
    },
    async begin(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(commandSchema, value), current = bound(request), before = await selected(current, command);
      // A matching page proves discovery only. Original creation separately runs
      // its detail/resource Guards and complete current execution admission.
      const creation = await input.originals.create(current, originalCommand(command));
      const close = async () => {
        try { if (requestFingerprint(await selected(current, command)) !== requestFingerprint(before)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT'); }
        catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      };
      await close();
      if (creation.stage !== 'task_metadata_created' && creation.stage !== 'existing_request')
        return freezeOriginalInput({ choice: command.choice, creation, model: 'not_called' as const });
      const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: creation.receipt.inputRef };
      if (creation.stage === 'existing_request') return freezeOriginalInput({ choice: command.choice, creation, original,
        model: 'not_called' as const, nextAction: 'read_original_explanation' as const });
      const execution = await input.runtime.start(current, original);
      await close();
      return freezeOriginalInput({ choice: command.choice, creation, original, execution, businessExecution: 'not_attempted' as const });
    },
    async read(request: AiSceneHttpRequest, value: unknown) {
      const command = parse(commandSchema.extend({ original: originalRequestReferenceSchema }).strict(), value), current = bound(request);
      const expected = originalCommand(command), saved = await input.originals.read(current, command.original);
      if (saved.receipt.requestKey !== expected.requestKey || requestFingerprint(saved.request) !== requestFingerprint(originalBody(expected)))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const order = await input.runtime.readOrderResult(current, command.original), answer = await input.runtime.readAnswer(current, command.original);
      if (answer.result.status === 'available' && (order.result.status !== 'available'
        || answer.result.originalReadResultId !== order.result.resultId)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const latest = await input.originals.read(current, command.original);
      if (latest.receipt.requestKey !== saved.receipt.requestKey || requestFingerprint(latest.request) !== requestFingerprint(saved.request))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ choice: command.choice, original: command.original, order, answer,
        discovery: 'not_repeated' as const, execution: 'read_only_no_start_or_model_or_business_action' as const });
    }
  });
}
