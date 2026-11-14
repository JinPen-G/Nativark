/** The original Goal/Task/quote contracts through the native HTTP client.
 * A captured host checks visibility before and after each await; POSTs never
 * refresh/replay after unknown. This adapter cannot select or submit orders. */
import { request } from '../core/http';
import { clientTaskApi } from './ai-tasks';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientHostCapabilitiesSchema,
  aiClientGoalPreparationRequestSchema, aiClientGoalPreparationReadRequestSchema, aiClientGoalPreparationResponseSchema,
  aiClientGoalCandidatesRequestSchema, aiClientGoalProjectionSchema, aiClientGoalQuoteRequestSchema,
  aiClientQuotePreparationResponseSchema, aiClientQuotePreparationReadResponseSchema,
  aiClientQuoteConfirmationRequestSchema, aiClientQuoteResultReadResponseSchema } from '../vendor/shared-ai-client';
import type { ClientGoalApi, ClientGoalSignal } from '@rental-os/shared';

export function createClientGoalApi(current: () => boolean): ClientGoalApi {
  const checked = async <T>(work: () => Promise<T>, signal?: ClientGoalSignal): Promise<T> => {
    if (!current() || signal?.aborted) throw Error('client_goal_context_changed');
    const value = await work();
    if (!current() || signal?.aborted) throw Error('client_goal_context_changed');
    return value;
  };
  const read = (path: string, signal?: ClientGoalSignal) => checked(() => request<unknown>(path), signal);
  const call = <T>(action: string, body: unknown, schema: { parse(value: unknown): T }, signal?: ClientGoalSignal) =>
    checked(async () => schema.parse(await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`,
      { method: 'POST', data: body, timeoutMs: 15000, replayAfterRefresh: false })), signal);
  return Object.freeze({
    readHost: signal => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, {}, aiClientHostCapabilitiesSchema, signal),
    prepareGoal: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoal, aiClientGoalPreparationRequestSchema.parse(input), aiClientGoalPreparationResponseSchema, signal),
    readGoalPreparation: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalPreparation, aiClientGoalPreparationReadRequestSchema.parse(input), aiClientGoalPreparationResponseSchema, signal),
    readGoalCandidates: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalCandidates, aiClientGoalCandidatesRequestSchema.parse(input), aiClientGoalProjectionSchema, signal),
    prepareGoalQuote: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoalQuote, aiClientGoalQuoteRequestSchema.parse(input), aiClientQuotePreparationResponseSchema, signal),
    readGoalQuotePreparation: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalQuotePreparation, aiClientGoalQuoteRequestSchema.parse(input), aiClientQuotePreparationReadResponseSchema, signal),
    confirmQuoteParameters: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters, aiClientQuoteConfirmationRequestSchema.parse(input), aiClientQuoteResultReadResponseSchema, signal),
    readQuoteOriginal: (input, signal) => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal, aiClientQuoteConfirmationRequestSchema.parse(input), aiClientQuoteResultReadResponseSchema, signal),
    readCatalog: signal => read('/catalog', signal),
    readEnterprisePolicies: signal => read('/enterprise/my-rental-policies', signal),
    readAddresses: signal => read('/profile/addresses', signal),
    createTask: (input, signal) => checked(() => clientTaskApi.createTask(input), signal),
    readCreation: (input, signal) => checked(() => clientTaskApi.readCreation(input), signal),
    readSnapshot: (input, signal) => checked(() => clientTaskApi.readSnapshot(input), signal),
    startModel: (input, signal) => checked(() => clientTaskApi.startModel(input), signal),
    readModelResult: (input, signal) => checked(() => clientTaskApi.readModelResult(input), signal),
    readInput: (input, signal) => checked(() => clientTaskApi.readInput(input), signal),
    submitInput: (input, signal) => checked(() => clientTaskApi.submitInput(input), signal),
    readInputReceipt: (input, signal) => checked(() => clientTaskApi.readInputReceipt(input), signal),
    continueInput: (input, signal) => checked(() => clientTaskApi.continueInput(input), signal),
  } satisfies ClientGoalApi);
}
