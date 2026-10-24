/** Closed business-page transport. The original HTTP client alone owns Rental OS credentials. */
import { RENTAL_DESKTOP_BUSINESS_HTTP, parseRentalDesktopCatalogRequest, parseRentalDesktopCatalogResult,
  parseRentalDesktopBusinessPolicyRead, parseRentalDesktopPolicySave, parseRentalDesktopPolicySaved,
  parseRentalDesktopPolicyObservation, type RentalDesktopPolicySave, type RentalDesktopCatalogRequest } from '@rental-os/shared';
import type { ApiResult } from '@rental-os/shared';
import { http } from './http';

const path = (action: 'policy' | 'savePolicy' | 'policyOperation') => `/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${RENTAL_DESKTOP_BUSINESS_HTTP[action]}`;
/** Human configuration only; does not run a model, seed permission or retry a save. */
export const desktopBusinessPolicyApi = Object.freeze({
  read: async (signal: AbortSignal) => parseRentalDesktopBusinessPolicyRead((await http.post<ApiResult<unknown>>(path('policy'), {}, { signal })).data.data),
  save: async (value: RentalDesktopPolicySave, signal: AbortSignal) => parseRentalDesktopPolicySaved((await http.post<ApiResult<unknown>>(path('savePolicy'), parseRentalDesktopPolicySave(value), { signal })).data.data),
  operation: async (operationKey: string, signal: AbortSignal) => parseRentalDesktopPolicyObservation((await http.post<ApiResult<unknown>>(path('policyOperation'), { operationKey }, { signal })).data.data)
});

export async function readDesktopBusinessCatalog(value: RentalDesktopCatalogRequest, signal: AbortSignal) {
  const input = parseRentalDesktopCatalogRequest(value);
  try {
    const result = await http.request<ApiResult<unknown>>({ method: 'POST', url: `/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${RENTAL_DESKTOP_BUSINESS_HTTP.catalog}`,
      data: input, signal });
    return parseRentalDesktopCatalogResult(result.data.data);
  } catch (error) {
    const code = error && typeof error === 'object' && 'response' in error
      ? (error.response as { data?: { code?: unknown } } | undefined)?.data?.code : undefined;
    if (typeof code === 'string' && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_INVALID_INPUT', 'AI_RESOURCE_UNAVAILABLE'].includes(code)) throw new Error(code);
    throw new Error('AI_RESOURCE_UNAVAILABLE');
  }
}
