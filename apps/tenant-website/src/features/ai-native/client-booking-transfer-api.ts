/** Original customer transport for the four closed transfer operations. Auth
 * stays in customerFetch; neither a transfer locator nor local data is a grant.
 * POSTs never replay after refresh. Each explicit request has a bounded wait. */
import { customerFetch } from '@rental-os/web-client';
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientHostCapabilitiesSchema,
  aiClientBookingTransferIssueRequestSchema, aiClientBookingTransferRequestSchema,
  aiClientBookingTransferIssueResponseSchema, aiClientBookingTransferReceiptSchema
} from '@rental-os/shared';
import { API_BASE } from '../../data/apiClient';
import type { ClientBookingTransferApi } from './client-booking-transfer-session';

export function createClientBookingTransferApi(context: { tenantCode: string; current(): boolean },
  signal?: AbortSignal): ClientBookingTransferApi {
  const post = async <T>(action: string, value: unknown, schema: { parse(value: unknown): T }): Promise<T> => {
    if (!context.current() || signal?.aborted) throw Error('booking_transfer_context_changed');
    const abort = new AbortController(), stop = () => abort.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 15000);
    try {
      const response = await customerFetch(context.tenantCode, `${API_BASE}/api/client/v1`, `/ai-native/entry/${action}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(value), cache: 'no-store', signal: abort.signal }, false);
      const result: unknown = await response.json();
      if (!context.current() || abort.signal.aborted || !response.ok) throw Error('booking_transfer_result_unavailable');
      const body = result && typeof result === 'object' && !Array.isArray(result) && 'data' in result ? result.data : result;
      return schema.parse(body);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
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
