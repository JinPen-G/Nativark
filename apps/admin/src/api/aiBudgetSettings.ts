/** Canonical authenticated management HTTP only. No probes, reservations,
 * execution grants or automatic write retries. */
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT as routes, type AiBudgetSettingsReadDraft,
  type AiBudgetSettingsChangeDraft, type AiBudgetSettingsInitializeDraft,
  type AiBudgetSettingsRefreshConfigurationDraft } from '@rental-os/shared';
import type { AiBudgetSettingsOperationReadDraft } from '@rental-os/shared';
import type { AiGatewayPriceReviewDraft, AiGatewayPriceReviewReadDraft } from '@rental-os/shared';
import type { AiGatewayPlatformPriceAdoptionDraft, AiGatewayPlatformPriceAdoptionReadDraft } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal } from '@/app/queryClient';
import type { ApiResult } from '@rental-os/shared';
const post = async (action: 'read' | 'readOperation' | 'change' | 'initialize' | 'refreshConfiguration'
  | 'platformReviewPrice' | 'platformPriceReviewReceipt' | 'previewPlatformPrice' | 'adoptPlatformPrice' | 'readPlatformPriceAdoption', data: unknown, signal: AbortSignal) => {
  const response = await http.request<ApiResult<unknown>>({ url: `/${routes.basePath}/${routes[action]}`, method: 'post', data,
    signal: AbortSignal.any([signal, currentSessionSignal()]), headers: { 'Cache-Control': 'no-store' } });
  return response.data.data;
};
export const aiBudgetSettingsApi = Object.freeze({
  previewPlatformPrice: (value: AiGatewayPlatformPriceAdoptionReadDraft, signal: AbortSignal) => post('previewPlatformPrice', value, signal),
  adoptPlatformPrice: (value: AiGatewayPlatformPriceAdoptionDraft, signal: AbortSignal) => post('adoptPlatformPrice', value, signal),
  readPlatformPriceAdoption: (value: AiGatewayPlatformPriceAdoptionReadDraft, signal: AbortSignal) => post('readPlatformPriceAdoption', value, signal),
  platformReviewPrice: (value: AiGatewayPriceReviewDraft, signal: AbortSignal) => post('platformReviewPrice', value, signal),
  platformPriceReviewReceipt: (value: AiGatewayPriceReviewReadDraft, signal: AbortSignal) => post('platformPriceReviewReceipt', value, signal),
  readOperation: (value: AiBudgetSettingsOperationReadDraft, signal: AbortSignal) => post('readOperation', value, signal),
  read: (value: AiBudgetSettingsReadDraft, signal: AbortSignal) => post('read', value, signal),
  change: (value: AiBudgetSettingsChangeDraft, signal: AbortSignal) => post('change', value, signal),
  initialize: (value: AiBudgetSettingsInitializeDraft, signal: AbortSignal) => post('initialize', value, signal),
  refreshConfiguration: (value: AiBudgetSettingsRefreshConfigurationDraft, signal: AbortSignal) => post('refreshConfiguration', value, signal)
});
