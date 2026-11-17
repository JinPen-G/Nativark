/** One explicit customer directory read through the current original session.
 * No authentication refresh replay, model, Task or booking operation is sent. */
import { customerFetch } from '@rental-os/web-client';
import { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse,
  type AiEntrySceneCatalogRequest, type AiEntrySceneCatalogResponse } from '@rental-os/shared';
import { API_BASE } from '../../data/apiClient';

export async function readClientSceneCatalog(context: { tenantCode: string; current(): boolean }, input: AiEntrySceneCatalogRequest,
  signal: AbortSignal): Promise<AiEntrySceneCatalogResponse> {
  const command = structuredClone(input);
  if (!context.current() || signal.aborted || !isAiEntrySceneCatalogRequest(command)) throw Error('client_directory_changed');
  const response = await customerFetch(context.tenantCode, `${API_BASE}/api/client/v1`,
    `/${AI_ENTRY_SCENE_CATALOG_HTTP.websiteBasePath.slice('client/v1/'.length)}/${AI_ENTRY_SCENE_CATALOG_HTTP.read}`,
    { method: 'POST', body: JSON.stringify(command), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store' }, false);
  const body: unknown = await response.json();
  const value = body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'data')
    ? (body as { data: unknown }).data : body;
  if (!context.current() || signal.aborted || !response.ok || new TextEncoder().encode(JSON.stringify(value)).length > 131072
    || !isAiEntrySceneCatalogResponse(value) || value.surface !== 'tenant_website' || value.audience !== 'customer'
    || value.scope.kind !== 'workspace') throw Error('client_directory_unavailable');
  return structuredClone(value);
}
