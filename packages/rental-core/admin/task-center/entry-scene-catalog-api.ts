/** Explicit, bounded directory reads through the existing operator transport.
 * The response describes current entries; it never grants object or Task access. */
import { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse,
  type AiEntrySceneCatalogRequest, type AiEntrySceneCatalogResponse, type ApiResult } from '@rental-os/shared';

import type { RentalBrowserAdminSession } from "../browser";

export function createEntrySceneCatalogReader(session: RentalBrowserAdminSession) {
  const { http, currentSessionSignal } = session;
async function readEntrySceneCatalog(input: AiEntrySceneCatalogRequest, signal: AbortSignal): Promise<AiEntrySceneCatalogResponse> {
  const command = structuredClone(input);
  if (signal.aborted || !isAiEntrySceneCatalogRequest(command)) throw Error('AI_DIRECTORY_UNAVAILABLE');
  const response = await http.post<ApiResult<unknown>>(`/${AI_ENTRY_SCENE_CATALOG_HTTP.operatorBasePath}/${AI_ENTRY_SCENE_CATALOG_HTTP.read}`,
    command, { signal: AbortSignal.any([signal, currentSessionSignal()]), timeout: 15000, ...{ _authRetry: true } });
  const result: unknown = response.data.data;
  if (signal.aborted || new TextEncoder().encode(JSON.stringify(result)).length > 131072
    || !isAiEntrySceneCatalogResponse(result) || result.surface !== 'tenant_admin') throw Error('AI_DIRECTORY_UNAVAILABLE');
  return structuredClone(result);
}

  return readEntrySceneCatalog;
}
