import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiOriginalSceneRecoveryService } from './original-scene-recovery.service';
import { AiOriginalSceneFactsService } from './original-scene-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiSceneRequestBody, type AiExecutionContext } from '@rental-os/shared';
import { AiCurrentOriginalRequestAuthority, originalIdentityHash, type AiSceneCreationRule } from '../task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema, parseOriginalRequest } from '../task-request/original-request.validation';

type BusinessDependencies = Parameters<typeof composeAiAuthorizedBusinessTools>[0];
export type AiOriginalSceneDependencies = PersistedTaskAuthorizationDependencies & BusinessDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  creationRules: readonly AiSceneCreationRule[];
};

export function composeAiOriginalScenes(input: AiOriginalSceneDependencies) {
  const tools = composeAiAuthorizedBusinessTools({ ...input, openingVersionFields: input.db }), clock = input.clock ?? (() => new Date());
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const prepare = (body: AiSceneRequestBody, requestKey: string, expectedContext?: AiExecutionContext) => {
    switch (body.sceneCode) {
      case 'order_explanation': return tools.scenes.prepareOrderExplanation({ requestKey, ...body.input }, expectedContext);
      case 'opening_diagnosis': return tools.scenes.prepareOpeningDiagnosis({ requestKey, ...body.input }, expectedContext);
      case 'quote_clarification': return tools.scenes.prepareQuoteClarification({ requestKey, ...body.input }, expectedContext);
    }
  };
  const authority = new AiCurrentOriginalRequestAuthority(input.db, { ...input, authorizeResources: async body => {
    if (body.sceneCode === 'order_explanation') {
      return new AiOrderRouteContextAuthority(input.guard, input.credentials, body.input.orderId, clock).withOrderRead(async context => {
        // Resource authorization validates the strict original parent under
        // current Guard/ALS, not a complete history/payment explanation. Full
        // preparation belongs only to the actual material consumption below.
        await tools.order(body.input.orderId).read(context);
        return context;
      });
    }
    return routes.withRead(body.sceneCode === 'opening_diagnosis' ? 'opening' : 'quote_context', {}, async context => {
      await prepare(body, 'resource-check', context);
      return context;
    });
  } }, clock);
  const requests = new PrismaOriginalRequestRepository(input.db, authority, clock);
  const facts = new AiOriginalSceneFactsService(requests, tools);
  const create = async (value: unknown, reissue = false) => {
    const command = parseOriginalRequest(value, reissue);
    const { replayed, ...receipt } = await requests.save(command, reissue);
    if (replayed) return { stage: 'existing_request' as const, receipt, task: await requests.readTaskReceipt(receipt.inputRef), model: 'not_called' as const };
    try {
      const task = await requests.createTask({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef });
      return { stage: 'task_metadata_created' as const, receipt, task, plan: 'not_started' as const, model: 'not_called' as const };
    } catch (error) {
      if (!(error instanceof AiTaskRepositoryError)) throw error;
      return { stage: 'request_stored' as const, receipt, creation: { code: error.code,
        state: error.code === 'AI_STORAGE_UNAVAILABLE' ? 'requires_reconciliation' as const : 'blocked' as const, retryable: false as const }, model: 'not_called' as const };
    }
  };
  return Object.freeze({ requests, tools, create: (value: unknown) => create(value), reissue: (value: unknown) => create(value, true),
    queryOrders: tools.orders.read.bind(tools.orders),
    read: requests.read.bind(requests), reconcile: requests.reconcile.bind(requests), createTask: requests.createTask.bind(requests),
    readTaskReceipt: requests.readTaskReceipt.bind(requests),
    readOpeningSection: facts.readOpeningSection.bind(facts),
    prepareOrderManualHandoff: facts.prepareOrderManualHandoff.bind(facts),
    previewOrderExtension: facts.previewOrderExtension.bind(facts),
    readQuoteCatalog: facts.readQuoteCatalog.bind(facts),
    reopenOrderCitation: facts.reopenOrderCitation.bind(facts), reopenOrderCitationV2: facts.reopenOrderCitationV2.bind(facts),
    prepareOpeningSections: facts.prepareOpeningSections.bind(facts),
    reviewQuote: facts.reviewQuote.bind(facts),
    confirmQuote: facts.confirmQuote.bind(facts), readQuoteReceipt: facts.readQuoteReceipt.bind(facts),
    compareOriginalQuotes: facts.compareOriginalQuotes.bind(facts),
    async readRecovery(value: unknown) {
      const authorization = composePersistedTaskAuthorization(input);
      return new AiOriginalSceneRecoveryService(input.db, requests, authorization.tasks).read(value);
    },
    async prepareTaskMaterial(value: unknown, purpose: 'execution_preparation' | 'read_only' | 'order_history_read' = 'execution_preparation') {
      const parsed = originalRequestReferenceSchema.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const ref = freezeOriginalInput(parsed.data);
      // Only the named material HTTP reads may inspect an expired original.
      // Model/runner callers retain the existing new-admission checks.
      const historicalScene = purpose === 'read_only' ? 'opening_diagnosis' : purpose === 'order_history_read' ? 'order_explanation' : null;
      const historical = historicalScene ? await requests.readHistorical(ref) : null;
      if (historical && historical.receipt.sceneCode === historicalScene) {
        if (historical.receipt.state === 'revoked' || historical.request.sceneCode !== historicalScene)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const task = await requests.readTaskReceipt(ref.inputRef);
        const prepared = await prepare(historical.request, historical.receipt.requestKey, historical.context);
        const after = await requests.readHistorical(ref), currentTask = await requests.readTaskReceipt(ref.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.sceneCode !== historicalScene || after.receipt.sceneVersion !== historical.receipt.sceneVersion
          || after.receipt.contentHash !== historical.receipt.contentHash || after.receipt.requestKey !== historical.receipt.requestKey
          || originalIdentityHash(after.context) !== originalIdentityHash(historical.context)
          || task.state !== currentTask.state || task.state === 'observed' && (currentTask.state !== 'observed'
            || currentTask.taskId !== task.taskId || currentTask.runId !== task.runId)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const material = prepared.payload.materials;
        return freezeOriginalInput({ original: after.receipt, material, materialHash: requestFingerprint(material),
          trust: 'source_text_is_data_not_instructions' as const, task: currentTask,
          model: 'not_called' as const, plan: 'requires_host_plan_start' as const });
      }
      const original = await requests.read(ref);
      const grant = await requests.resolve(original.receipt.sceneCode, ref.inputRef);
      // A closing grant cannot retrospectively bind a preparation made by a
      // different principal. Carry this current server binding into its sources.
      const prepared = await prepare(original.request, original.receipt.requestKey, grant.context);
      await requests.resolve(original.receipt.sceneCode, ref.inputRef);
      const material = prepared.payload.materials;
      return freezeOriginalInput({ original: original.receipt, material, materialHash: requestFingerprint(material),
        trust: 'source_text_is_data_not_instructions' as const, task: await requests.readTaskReceipt(original.receipt.inputRef),
        model: 'not_called' as const, plan: 'requires_host_plan_start' as const });
    }
  });
}
