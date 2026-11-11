/** Original customer cancellation controls and receipts. Authenticated POSTs
 * never replay; cancellation is not a model call, business rollback or refund. */
import { customerFetch } from '@rental-os/web-client';
import { API_BASE } from '../../data/apiClient';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientTaskCancelRequestSchema, aiClientTaskCancelReceiptSchema,
  aiClientTaskCancellationObservationSchema, aiClientTaskInputCancellationReceiptSchema,
  aiClientTaskUnstartedCancellationReceiptSchema, aiClientTaskReadRequestSchema } from '@rental-os/shared';
import { createClientTaskApi } from './client-task-api';

export function createClientTaskCancellationApi(context: { tenantCode: string; current(): boolean }) {
  const original = createClientTaskApi(context);
  const pending = new Set<AbortController>();
  const wait = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (!context.current()) throw Error('client_cancellation_context_changed');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    pending.add(controller);
    try { return await work(controller.signal); }
    finally { clearTimeout(timer); pending.delete(controller); }
  };
  const call = <T>(action: string, request: unknown, schema: { parse(value: unknown): T }): Promise<T> => wait(async signal => {
    const response = await customerFetch(context.tenantCode, `${API_BASE}/api/client/v1`, `/ai-native/entry/${action}`,
      { method: 'POST', body: JSON.stringify(request), signal }, false);
    const value: unknown = await response.json();
    if (!context.current() || !response.ok) throw Error('client_cancellation_unavailable');
    const body = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? value.data : value;
    return schema.parse(body);
  });
  return Object.freeze({
    readCreation(input: Parameters<typeof original.readCreation>[0]) { return wait(signal => original.readCreation(input, signal)); },
    requestCancellation(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation,
        aiClientTaskCancelRequestSchema.parse(input), aiClientTaskCancelReceiptSchema);
    },
    readRequestReceipt(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt,
        aiClientTaskCancelRequestSchema.parse(input), aiClientTaskCancellationObservationSchema);
    },
    readSettlementReceipt(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt,
        aiClientTaskCancelRequestSchema.parse(input), aiClientTaskCancellationObservationSchema);
    },
    settleUnstarted(input: ReturnType<typeof aiClientTaskCancelRequestSchema.parse>) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation,
        aiClientTaskCancelRequestSchema.parse(input), aiClientTaskUnstartedCancellationReceiptSchema);
    },
    settleReleasedInputWait(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>) {
      return call(AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation,
        aiClientTaskReadRequestSchema.parse(input), aiClientTaskInputCancellationReceiptSchema);
    },
    dispose() { for (const controller of pending) controller.abort(); pending.clear(); },
  });
}
export type ClientTaskCancellationApi = ReturnType<typeof createClientTaskCancellationApi>;
