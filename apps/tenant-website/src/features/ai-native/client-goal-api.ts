/** Customer goal and original quote transports. The captured customer session
 * owns authority; a refresh, abort or lost response never replays a POST. */
import { customerFetch } from '@rental-os/web-client';
import { API_BASE } from '../../data/apiClient';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientHostCapabilitiesSchema,
  aiClientGoalPreparationRequestSchema, aiClientGoalPreparationReadRequestSchema,
  aiClientGoalPreparationResponseSchema, aiClientGoalCandidatesRequestSchema, aiClientGoalProjectionSchema,
  aiClientGoalQuoteRequestSchema, aiClientQuotePreparationResponseSchema,
  aiClientQuotePreparationReadResponseSchema, aiClientQuoteConfirmationRequestSchema,
  aiClientQuoteResultReadResponseSchema, aiClientQuoteBookingRequestSchema, aiClientQuoteBookingPreparationResponseSchema,
  aiClientQuoteBookingOperationResponseSchema, aiEntryActionSchema, aiBookingDraftSchema,
  aiBookingCreateResponseSchema, aiBookingChoiceResponseSchema, aiBookingHandoffResponseSchema,
  aiBookingOperationReadResponseSchema, aiBookingHandoffSchema, type AiClientGoalQuoteRequest } from '@rental-os/shared';
import { createClientTaskApi } from './client-task-api';
import type { ClientQuoteBookingApi } from './client-quote-session';

function originalGoalTransport(context: { tenantCode: string; current(): boolean }) {
  const request = async (path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> => {
    if (!context.current() || signal?.aborted) throw Error('client_goal_context_changed');
    const response = await customerFetch(context.tenantCode, `${API_BASE}/api/client/v1`, path,
      { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', signal }, false);
    const value: unknown = await response.json();
    if (!context.current() || signal?.aborted || !response.ok) throw Error('client_goal_result_unavailable');
    return value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? value.data : value;
  };
  const call = async <T>(action: string, body: unknown, schema: { parse(value: unknown): T }, signal?: AbortSignal): Promise<T> =>
    schema.parse(await request(`/ai-native/entry/${action}`, body, signal));
  return { request, call };
}

export function createClientGoalApi(context: { tenantCode: string; current(): boolean }) {
  const original = createClientTaskApi(context), { request, call } = originalGoalTransport(context);
  return Object.freeze({
    readHost(signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, {}, aiClientHostCapabilitiesSchema, signal);
    },
    prepareGoal(input: ReturnType<typeof aiClientGoalPreparationRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoal, aiClientGoalPreparationRequestSchema.parse(input), aiClientGoalPreparationResponseSchema, signal);
    },
    readGoalPreparation(input: ReturnType<typeof aiClientGoalPreparationReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalPreparation, aiClientGoalPreparationReadRequestSchema.parse(input), aiClientGoalPreparationResponseSchema, signal);
    },
    readGoalCandidates(input: ReturnType<typeof aiClientGoalCandidatesRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalCandidates, aiClientGoalCandidatesRequestSchema.parse(input), aiClientGoalProjectionSchema, signal);
    },
    prepareGoalQuote(input: AiClientGoalQuoteRequest, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoalQuote, aiClientGoalQuoteRequestSchema.parse(input), aiClientQuotePreparationResponseSchema, signal);
    },
    readGoalQuotePreparation(input: AiClientGoalQuoteRequest, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalQuotePreparation, aiClientGoalQuoteRequestSchema.parse(input), aiClientQuotePreparationReadResponseSchema, signal);
    },
    confirmQuoteParameters(input: ReturnType<typeof aiClientQuoteConfirmationRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters, aiClientQuoteConfirmationRequestSchema.parse(input), aiClientQuoteResultReadResponseSchema, signal);
    },
    readQuoteOriginal(input: ReturnType<typeof aiClientQuoteConfirmationRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal, aiClientQuoteConfirmationRequestSchema.parse(input), aiClientQuoteResultReadResponseSchema, signal);
    },
    // These original reads supply human form options, never model inputs,
    // eligibility or a second price/stock calculation.
    readCatalog(signal?: AbortSignal) { return request('/catalog', undefined, signal); },
    readEnterprisePolicies(signal?: AbortSignal) { return request('/enterprise/my-rental-policies', undefined, signal); },
    readAddresses(signal?: AbortSignal) { return request('/profile/addresses', undefined, signal); },
    createTask: original.createTask, readCreation: original.readCreation, readSnapshot: original.readSnapshot,
    startModel: original.startModel, readModelResult: original.readModelResult,
    readInput: original.readInput, submitInput: original.submitInput,
    readInputReceipt: original.readInputReceipt, continueInput: original.continueInput,
  });
}
export type ClientGoalApi = ReturnType<typeof createClientGoalApi>;

/** Original quote -> Draft -> explicit handoff, using the same customer
 * transport. No endpoint here creates another quote or submits an order. */
export function createClientGoalBookingApi(context: { tenantCode: string; current(): boolean }, signal?: AbortSignal): ClientQuoteBookingApi {
  const { call } = originalGoalTransport(context);
  const api: ClientQuoteBookingApi = {
    prepareBooking: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking,
      aiClientQuoteBookingRequestSchema.parse(input), aiClientQuoteBookingPreparationResponseSchema, signal),
    readBookingPreparation: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation,
      aiClientQuoteBookingRequestSchema.parse(input), aiClientQuoteBookingOperationResponseSchema, signal),
    issueBookingAction: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction, input, aiEntryActionSchema, signal),
    createBookingDraft: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft, input, aiBookingCreateResponseSchema, signal),
    readBookingDraft: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft, input, aiBookingDraftSchema, signal),
    async chooseBookingDraft(input) {
      const value = await call(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft, input, aiBookingChoiceResponseSchema, signal);
      if (!('draft' in value)) throw Error('client_goal_booking_choice_changed');
      return value;
    },
    handoffBookingDraft: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft, input, aiBookingHandoffResponseSchema, signal),
    readBookingOperation: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation, input, aiBookingOperationReadResponseSchema, signal),
    readHandoff: input => call(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff, input, aiBookingHandoffSchema, signal),
  };
  return Object.freeze(api);
}
