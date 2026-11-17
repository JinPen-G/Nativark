/** Four original transfer operations through the existing customer HTTP port.
 * Public runtime comes only from the native bundle; POST replay is disabled. */
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientHostCapabilitiesSchema,
  aiClientBookingTransferIssueRequestSchema, aiClientBookingTransferRequestSchema,
  aiClientBookingTransferIssueResponseSchema, aiClientBookingTransferReceiptSchema
} from '../vendor/shared-ai-client';
import { request } from '../core/http';
import type { ClientBookingTransferApi } from '../components/ai-native/client-booking-transfer-session';

export function createClientBookingTransferApi(context: { current(): boolean }): ClientBookingTransferApi {
  const post = async <T>(action: string, value: unknown, schema: { parse(value: unknown): T }): Promise<T> => {
    if (!context.current()) throw Error('booking_transfer_context_changed');
    const result = await request<unknown>(`/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${action}`,
      { method: 'POST', auth: 'required', scope: 'workspace', data: value, replayAfterRefresh: false, timeoutMs: 15000 });
    if (!context.current()) throw Error('booking_transfer_context_changed');
    return schema.parse(result);
  };
  return Object.freeze<ClientBookingTransferApi>({
    readHost: () => post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, {}, aiClientHostCapabilitiesSchema),
    issue: value => post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueBookingTransfer,
      aiClientBookingTransferIssueRequestSchema.parse(value), aiClientBookingTransferIssueResponseSchema),
    readIssue: value => post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferIssue,
      aiClientBookingTransferIssueRequestSchema.parse(value), aiClientBookingTransferIssueResponseSchema),
    consume: value => post(AI_CLIENT_ENTRY_HTTP_DRAFT.consumeBookingTransfer,
      aiClientBookingTransferRequestSchema.parse(value), aiClientBookingTransferReceiptSchema),
    readReceipt: value => post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferReceipt,
      aiClientBookingTransferRequestSchema.parse(value), aiClientBookingTransferReceiptSchema)
  });
}
