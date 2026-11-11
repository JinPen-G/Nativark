/** Original customer cancellation protocol through the existing native HTTP
 * client and public validators. No automatic replay or model/Core execution. */
import { request } from '../core/http';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientTaskCancelRequestSchema, aiClientTaskCancelReceiptSchema,
  aiClientTaskCancellationObservationSchema, aiClientTaskInputCancellationReceiptSchema,
  aiClientTaskUnstartedCancellationReceiptSchema, aiClientTaskReadRequestSchema } from '../vendor/shared-ai-client';
import { clientTaskApi } from './ai-tasks';

const call = async <T>(action: string, value: unknown, schema: { parse(value: unknown): T }): Promise<T> => schema.parse(
  await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`,
    { method: 'POST', data: value, replayAfterRefresh: false, timeoutMs: 15000 }));
export const clientTaskCancellationApi = Object.freeze({
  readCreation: clientTaskApi.readCreation,
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
});
export type ClientTaskCancellationApi = typeof clientTaskCancellationApi;
