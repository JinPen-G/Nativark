/** Original customer task transports. Current customer sessions supply all
 * authority; POST controls are never replayed after refresh or a lost reply. */
import { customerFetch } from '@rental-os/web-client';
import { API_BASE } from '../../data/apiClient';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientOrderMaterialRequestSchema, aiClientOrderMaterialReceiptSchema,
  aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema, aiClientTaskModelControlResponseSchema,
  aiClientTaskModelResultReadResponseSchema, aiClientTaskInputReadResponseSchema, aiClientTaskInputSubmissionRequestSchema,
  aiClientTaskInputSubmissionReceiptSchema, aiClientTaskInputReceiptReadResponseSchema,
  aiClientTaskEventsReadRequestSchema, aiClientTaskSnapshotReadResponseSchema, aiClientTaskEventsReadResponseSchema } from '@rental-os/shared';

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
    readInputReceipt(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskInputReceiptReadResponseSchema, signal);
    },
    continueInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: AbortSignal) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput, aiClientTaskInputSubmissionRequestSchema.parse(input), aiClientTaskModelControlResponseSchema, signal);
    },
  });
}
export type ClientTaskApi = ReturnType<typeof createClientTaskApi>;
