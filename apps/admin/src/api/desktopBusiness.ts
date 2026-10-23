/** Closed business-page transport. The original HTTP client alone owns Rental OS credentials. */
import { RENTAL_DESKTOP_BUSINESS_HTTP, parseRentalDesktopCatalogRequest, parseRentalDesktopCatalogResult,
  type RentalDesktopCatalogRequest } from '@rental-os/shared';
import type { ApiResult } from '@rental-os/shared';
import { http } from './http';

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
