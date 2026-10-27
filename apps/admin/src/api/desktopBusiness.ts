/** Closed business-page transport. The original HTTP client alone owns Rental OS credentials. */
import { RENTAL_DESKTOP_BUSINESS_HTTP, parseRentalDesktopBusinessReadRequest, parseRentalDesktopCatalogResult, parseRentalDesktopCatalogSourcesResult,
  parseRentalDesktopBusinessPolicyRead, parseRentalDesktopPolicySave, parseRentalDesktopPolicySaved,
  parseRentalDesktopPolicyObservation, parseRentalDesktopCatalogCheckResult, type RentalDesktopPolicySave, type RentalDesktopBusinessReadRequest } from '@rental-os/shared';
import type { ApiResult } from '@rental-os/shared';
import { http } from './http';

const path = (action: 'policy' | 'savePolicy' | 'policyOperation') => `/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${RENTAL_DESKTOP_BUSINESS_HTTP[action]}`;
/** Human configuration only; does not run a model, seed permission or retry a save. */
export const desktopBusinessPolicyApi = Object.freeze({
  read: async (signal: AbortSignal) => parseRentalDesktopBusinessPolicyRead((await http.post<ApiResult<unknown>>(path('policy'), {}, { signal })).data.data),
  save: async (value: RentalDesktopPolicySave, signal: AbortSignal) => parseRentalDesktopPolicySaved((await http.post<ApiResult<unknown>>(path('savePolicy'), parseRentalDesktopPolicySave(value), { signal })).data.data),
  operation: async (operationKey: string, signal: AbortSignal) => parseRentalDesktopPolicyObservation((await http.post<ApiResult<unknown>>(path('policyOperation'), { operationKey }, { signal })).data.data)
});

export async function readDesktopBusinessCatalog(value: RentalDesktopBusinessReadRequest, signal: AbortSignal) {
  const input = parseRentalDesktopBusinessReadRequest(value);
  try {
    const action = !('kind' in input) ? RENTAL_DESKTOP_BUSINESS_HTTP.catalog
      : input.kind === 'catalog_sources' ? RENTAL_DESKTOP_BUSINESS_HTTP.catalogSources : RENTAL_DESKTOP_BUSINESS_HTTP.catalogCheck;
    const result = await http.request<ApiResult<unknown>>({ method: 'POST', url: `/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}/${action}`,
      data: input, signal });
    return !('kind' in input) ? parseRentalDesktopCatalogResult(result.data.data)
      : input.kind === 'catalog_sources' ? parseRentalDesktopCatalogSourcesResult(result.data.data) : parseRentalDesktopCatalogCheckResult(result.data.data);
  } catch (error) {
    const code = error && typeof error === 'object' && 'response' in error
      ? (error.response as { data?: { code?: unknown } } | undefined)?.data?.code : undefined;
    if (typeof code === 'string' && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_INVALID_INPUT', 'AI_RESOURCE_UNAVAILABLE'].includes(code)) throw new Error(code);
    throw new Error('AI_RESOURCE_UNAVAILABLE');
  }
}
