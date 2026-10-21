/** Original controlled probe transport. No supplier connection, provider ID,
 * caller scope, policy permissions, automatic retry or task replacement. */
import { AI_TEXT_CAPABILITY_HTTP_DRAFT as routes, type AiTextCapabilityHttpResponsesDraft,
  type AiTextCapabilityPrepareRequestDraft, type AiTextCapabilityCancelRequestDraft,
  type AiTextCapabilityConfigureActionDraft, type AiTextCapabilityActionRequestDraft, type ApiResult } from '@rental-os/shared';
import { currentSessionSignal } from '@/app/queryClient';
import { http } from './http';

export type CapabilityProbeAction = 'prepare' | 'publish' | 'readOriginal' | 'createTask' | 'readTask' | 'start' | 'inspect'
  | 'cancel' | 'reconcile' | 'readCapabilityReceipt' | 'readHistory' | 'preflight' | 'readTaskAction' | 'configureTaskAction';
export const aiCapabilityProbeApi = Object.freeze({
  async call<K extends CapabilityProbeAction>(action: K, value: AiTextCapabilityPrepareRequestDraft | AiTextCapabilityCancelRequestDraft
    | AiTextCapabilityConfigureActionDraft | AiTextCapabilityActionRequestDraft, signal: AbortSignal): Promise<AiTextCapabilityHttpResponsesDraft[K]> {
    const response = await http.post<ApiResult<AiTextCapabilityHttpResponsesDraft[K]>>(`/${routes.basePath}/${routes[action]}`, value,
      { signal: AbortSignal.any([signal, currentSessionSignal()]), headers: { 'Cache-Control': 'no-store' } });
    return response.data.data;
  }
});
