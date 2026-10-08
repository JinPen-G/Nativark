import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiOriginalSceneRecoveryService } from './original-scene-recovery.service';
import { AiOriginalSceneFactsService } from './original-scene-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiSceneRequestBody } from '@rental-os/shared';
import { AiCurrentOriginalRequestAuthority, type AiSceneCreationRule } from '../task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema, parseOriginalRequest } from '../task-request/original-request.validation';

type BusinessDependencies = Parameters<typeof composeAiAuthorizedBusinessTools>[0];
export type AiOriginalSceneDependencies = PersistedTaskAuthorizationDependencies & BusinessDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  creationRules: readonly AiSceneCreationRule[];
};

export function composeAiOriginalScenes(input: AiOriginalSceneDependencies) {
  const tools = composeAiAuthorizedBusinessTools(input), clock = input.clock ?? (() => new Date());
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const prepare = (body: AiSceneRequestBody, requestKey: string) => {
    switch (body.sceneCode) {
      case 'order_explanation': return tools.scenes.prepareOrderExplanation({ requestKey, ...body.input });
      case 'opening_diagnosis': return tools.scenes.prepareOpeningDiagnosis({ requestKey, ...body.input });
      case 'quote_clarification': return tools.scenes.prepareQuoteClarification({ requestKey, ...body.input });
    }
  };
  const authority = new AiCurrentOriginalRequestAuthority(input.db, { ...input, authorizeResources: async body => {
    if (body.sceneCode === 'order_explanation') {
      return new AiOrderRouteContextAuthority(input.guard, input.credentials, body.input.orderId, clock).withOrderRead(async context => {
        await prepare(body, 'resource-check');
        return context;
      });
    }
    return routes.withRead(body.sceneCode === 'opening_diagnosis' ? 'opening' : 'quote_context', {}, async context => {
      await prepare(body, 'resource-check');
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
    read: requests.read.bind(requests), reconcile: requests.reconcile.bind(requests), createTask: requests.createTask.bind(requests),
    readTaskReceipt: requests.readTaskReceipt.bind(requests),
    reopenOrderCitation: facts.reopenOrderCitation.bind(facts), prepareOpeningSections: facts.prepareOpeningSections.bind(facts),
    reviewQuote: facts.reviewQuote.bind(facts),
    async readRecovery(value: unknown) {
      const authorization = composePersistedTaskAuthorization(input);
      return new AiOriginalSceneRecoveryService(input.db, requests, authorization.tasks).read(value);
    },
    async prepareTaskMaterial(value: unknown) {
      const parsed = originalRequestReferenceSchema.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const ref = freezeOriginalInput(parsed.data), original = await requests.read(ref);
      await requests.resolve(original.receipt.sceneCode, ref.inputRef);
      const prepared = await prepare(original.request, original.receipt.requestKey);
      await requests.resolve(original.receipt.sceneCode, ref.inputRef);
      const material = prepared.payload.materials;
      return freezeOriginalInput({ original: original.receipt, material, materialHash: requestFingerprint(material),
        trust: 'source_text_is_data_not_instructions' as const, task: await requests.readTaskReceipt(original.receipt.inputRef),
        model: 'not_called' as const, plan: 'requires_host_plan_start' as const });
    }
  });
}
