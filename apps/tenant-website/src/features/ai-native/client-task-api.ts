/** Original customer task transports. Current customer sessions supply all
 * authority; POST controls are never replayed after refresh or a lost reply. */
import { customerFetch } from '@rental-os/web-client';
import { API_BASE } from '../../data/apiClient';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientOrderMaterialRequestSchema, aiClientOrderMaterialReceiptSchema,
  aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema, aiClientTaskModelControlResponseSchema,
  aiClientTaskModelResultReadResponseSchema, aiClientTaskInputReadResponseSchema, aiClientTaskInputSubmissionRequestSchema, aiClientTaskInputReferenceRequestSchema,
  aiClientTaskInputSubmissionReceiptSchema, aiClientTaskInputReceiptReadResponseSchema,
  aiClientTaskEventsReadRequestSchema, aiClientTaskSnapshotReadResponseSchema, aiClientTaskEventsReadResponseSchema,
  aiClientOrderActionSourceSchema, aiClientOrderActionSchema, aiClientOrderActionRevalidationSchema, aiClientHostCapabilitiesSchema,
  type AiClientHostCapabilities, type AiClientOrderActionSource, type AiClientOrderAction } from '@rental-os/shared';

/** Local read ports use the original public references. They are not HTTP
 * contracts, publication switches or a source of navigation authority. */
export interface ClientOrderNavigationPort {
  readHost(source: AiClientOrderActionSource): Promise<AiClientHostCapabilities>;
  readAction(source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
  revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource): Promise<AiClientOrderAction>;
}

export function createClientTaskApi(context: { tenantCode: string; current(): boolean }) {
  const call = async <T>(action: string, request: unknown, schema: { parse(value: unknown): T }, signal?: AbortSignal): Promise<T> => {
    if (!context.current()) throw Error('client_task_context_changed');
    const response = await customerFetch(context.tenantCode, `${API_BASE}/api/client/v1`, `/ai-native/entry/${action}`,
      { method: 'POST', body: JSON.stringify(request), signal }, false);
    const value: unknown = await response.json();
    if (!context.current() || !response.ok) throw Error('client_task_result_unavailable');
    const body = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? value.data : value;
    return schema.parse(body);
  };
  return Object.freeze({
    orderNavigation: Object.freeze({
      readHost(source: AiClientOrderActionSource) {
        return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities, aiClientOrderActionSourceSchema.parse(source), aiClientHostCapabilitiesSchema);
      },
      readAction(source: AiClientOrderActionSource) {
        return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction, aiClientOrderActionSourceSchema.parse(source), aiClientOrderActionSchema);
      },
      revalidateAction(action: AiClientOrderAction, source: AiClientOrderActionSource) {
        return call(AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction, aiClientOrderActionRevalidationSchema.parse({ ...source, action }), aiClientOrderActionSchema);
      },
    }),
    prepareMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial, aiClientOrderMaterialRequestSchema.parse(input), aiClientOrderMaterialReceiptSchema, signal);
    },
    readMaterial(input: ReturnType<typeof aiClientOrderMaterialRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt, aiClientOrderMaterialRequestSchema.parse(input), aiClientOrderMaterialReceiptSchema, signal);
    },
    createTask(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, aiClientTaskReadRequestSchema.parse(input), aiClientTaskCreationReceiptSchema, signal);
    },
    readCreation(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation, aiClientTaskReadRequestSchema.parse(input), aiClientTaskCreationReceiptSchema, signal);
    },
    readSnapshot(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot, aiClientTaskReadRequestSchema.parse(input), aiClientTaskSnapshotReadResponseSchema, signal);
    },
    readEvents(input: ReturnType<typeof aiClientTaskEventsReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents, aiClientTaskEventsReadRequestSchema.parse(input), aiClientTaskEventsReadResponseSchema, signal);
    },
    startModel(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel, aiClientTaskReadRequestSchema.parse(input), aiClientTaskModelControlResponseSchema, signal);
    },
    readModelResult(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult, aiClientTaskReadRequestSchema.parse(input), aiClientTaskModelResultReadResponseSchema, signal);
    },
    readInput(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput, aiClientTaskReadRequestSchema.parse(input), aiClientTaskInputReadResponseSchema, signal);
    },
    submitInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskInputSubmissionReceiptSchema, signal);
    },
    readInputReceipt(input: ReturnType<typeof aiClientTaskInputReferenceRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, aiClientTaskInputReferenceRequestSchema.parse(input), aiClientTaskInputReceiptReadResponseSchema, signal);
    },
    continueInput(input: ReturnType<typeof aiClientTaskInputReferenceRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput, aiClientTaskInputReferenceRequestSchema.parse(input), aiClientTaskModelControlResponseSchema, signal);
    },
  });
}
export type ClientTaskApi = Omit<ReturnType<typeof createClientTaskApi>, 'orderNavigation'> & { readonly orderNavigation?: ClientOrderNavigationPort };
