/** Original registered Action transport. Responses remain bound to this auth
 * epoch; none of these requests executes a business operation or retries it. */
import { AI_REGISTERED_ENTRY_ACTION_HTTP, aiRegisteredEntryActionIssueSchema, aiRegisteredEntryActionReadSchema,
  aiRegisteredEntryActionOrderSourceSchema, aiRegisteredEntryActionObservationSchema,
  aiRegisteredEntryActionOrderResponseSchema, aiRegisteredEntryActionRevalidationSchema,
  type AiRegisteredEntryActionIssue, type AiRegisteredEntryAction, type AiRegisteredEntryActionOrderSource,
  type AiRegisteredEntryActionObservation, type AiRegisteredEntryActionOrderResponse,
  type AiRegisteredEntryActionRevalidation, type ApiResult } from '@rental-os/shared';
import type { RentalAssistantTransport } from "../transport";

export function createAiEntryActionsApi(transport: RentalAssistantTransport) {
  const { http, useAuthStore, currentSessionEpoch, currentSessionSignal } = transport.session;

async function call<T>(path: string, input: unknown, parse: (value: unknown) => T, signal: AbortSignal): Promise<T> {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const config = { signal: active, timeout: 15000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/${AI_REGISTERED_ENTRY_ACTION_HTTP.operatorBasePath}/${path}`,
    structuredClone(input), config);
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 655360) throw Error('AI_RESOURCE_UNAVAILABLE');
  return parse(response.data.data);
}
const aiEntryActionsApi = Object.freeze({
  issue(input: AiRegisteredEntryActionIssue, signal: AbortSignal): Promise<AiRegisteredEntryActionObservation> {
    return call(AI_REGISTERED_ENTRY_ACTION_HTTP.issue, aiRegisteredEntryActionIssueSchema.parse(input),
      value => aiRegisteredEntryActionObservationSchema.parse(value), signal);
  },
  fromOrder(input: AiRegisteredEntryActionOrderSource, signal: AbortSignal): Promise<AiRegisteredEntryActionOrderResponse> {
    return call(AI_REGISTERED_ENTRY_ACTION_HTTP.fromOrder, aiRegisteredEntryActionOrderSourceSchema.parse(input),
      value => {
        const result = aiRegisteredEntryActionOrderResponseSchema.parse(value);
        if (result.actions.some(row => row.action.audience !== 'operations' || row.action.surface !== 'tenant_admin'
          || JSON.stringify(row.action.scope) !== JSON.stringify(result.scope)
          || row.action.associations.orderId !== result.orderId)) throw Error('AI_SCOPE_CHANGED');
        return result;
      }, signal);
  },
  revalidate(action: AiRegisteredEntryAction, signal: AbortSignal): Promise<AiRegisteredEntryActionRevalidation> {
    return call(AI_REGISTERED_ENTRY_ACTION_HTTP.revalidate, aiRegisteredEntryActionReadSchema.parse({ action }),
      value => {
        const result = aiRegisteredEntryActionRevalidationSchema.parse(value);
        if (result.actionId !== action.actionId || result.actionCode !== action.actionCode || result.audience !== action.audience
          || result.surface !== action.surface || JSON.stringify(result.scope) !== JSON.stringify(action.scope)
          || JSON.stringify(result.resource) !== JSON.stringify(action.resource)
          || JSON.stringify(result.associations) !== JSON.stringify(action.associations)) throw Error('AI_SCOPE_CHANGED');
        return result;
      }, signal);
  },
});

  return aiEntryActionsApi;
}
export type AiEntryActionsApi = ReturnType<typeof createAiEntryActionsApi>;
