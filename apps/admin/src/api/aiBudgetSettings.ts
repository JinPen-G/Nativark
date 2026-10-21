/** Canonical authenticated management HTTP only. No probes, reservations,
 * execution grants or automatic write retries. */
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT as routes, type AiBudgetSettingsReadDraft,
  type AiBudgetSettingsChangeDraft, type AiBudgetSettingsInitializeDraft,
  type AiBudgetSettingsRefreshConfigurationDraft } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal } from '@/app/queryClient';
import type { ApiResult } from '@rental-os/shared';
const post = async (action: 'read' | 'change' | 'initialize' | 'refreshConfiguration', data: unknown, signal: AbortSignal) => {
  const response = await http.request<ApiResult<unknown>>({ url: `/${routes.basePath}/${routes[action]}`, method: 'post', data,
    signal: AbortSignal.any([signal, currentSessionSignal()]), headers: { 'Cache-Control': 'no-store' } });
  return response.data.data;
};
export const aiBudgetSettingsApi = Object.freeze({
  read: (value: AiBudgetSettingsReadDraft, signal: AbortSignal) => post('read', value, signal),
  change: (value: AiBudgetSettingsChangeDraft, signal: AbortSignal) => post('change', value, signal),
  initialize: (value: AiBudgetSettingsInitializeDraft, signal: AbortSignal) => post('initialize', value, signal),
  refreshConfiguration: (value: AiBudgetSettingsRefreshConfigurationDraft, signal: AbortSignal) => post('refreshConfiguration', value, signal)
});
