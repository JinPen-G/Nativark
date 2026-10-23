/** Closed local-business messages. Identity is a binding to recheck, never an authorization grant. */
export const RENTAL_DESKTOP_BUSINESS_VERSION = 1 as const;
export const RENTAL_DESKTOP_BUSINESS_HTTP = {
  basePath: 'ai-native/desktop-business', catalog: 'catalog', policy: 'policy',
  savePolicy: 'policy/change', policyOperation: 'policy/operation'
} as const;
export interface RentalDesktopModelDestination { provider: string; baseUrl: string }
export interface RentalDesktopBusinessBinding { actorId: string; tenantId: string; workspaceId: string }
export interface RentalDesktopCatalogQuery {
  limit: number;
  destination: RentalDesktopModelDestination;
}
export interface RentalDesktopCatalogRequest {
  id: string;
  binding: RentalDesktopBusinessBinding;
  query: RentalDesktopCatalogQuery;
}
export interface RentalDesktopCatalogResult {
  version: typeof RENTAL_DESKTOP_BUSINESS_VERSION;
  requestId: string;
  binding: RentalDesktopBusinessBinding;
  policyRevision: number;
  policyHash: string;
  observedAt: string;
  expiresAt: string;
  configurationVersion: string;
  source: 'persisted_workspace_configuration';
  destination: RentalDesktopModelDestination;
  items: Array<{ reference: string; categoryCode: string; status: 'enabled' | 'disabled' }>;
  truncated: boolean;
  omittedFields: readonly ['name', 'code', 'unit', 'availability', 'price'];
  execution: 'read_only';
}
export interface RentalDesktopBusinessPolicy {
  enabled: boolean;
  toolCodes: Array<'rental.catalog.search'>;
  destinations: RentalDesktopModelDestination[];
  maxRows: number;
  expiresAt: string;
}
export type RentalDesktopBusinessPolicyRead = { state: 'not_configured' } | {
  state: 'configured'; revision: number; policy: RentalDesktopBusinessPolicy;
};
export type RentalDesktopBusinessFailureCode = 'AI_ACCESS_DENIED' | 'AI_SCOPE_CHANGED' | 'AI_INVALID_INPUT'
  | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
export type RentalDesktopCatalogReply = { id: string; ok: true; result: RentalDesktopCatalogResult }
  | { id: string; ok: false; code: RentalDesktopBusinessFailureCode };

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid local business message');
  return value as Record<string, unknown>;
}
function word(value: unknown, max = 191): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value))
    throw new Error('Invalid local business identifier');
  return value;
}
function positive(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid local business bound');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid local business time');
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('Invalid local business hash');
  return value;
}
/** Normalize a configured model destination; never accepts a key, query or embedded credentials. */
export function parseRentalDesktopDestination(value: unknown): RentalDesktopModelDestination {
  const row = record(value, ['provider', 'baseUrl']);
  if (typeof row.baseUrl !== 'string' || row.baseUrl.length > 2048) throw new Error('Invalid model destination');
  const url = new URL(row.baseUrl);
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:') throw new Error('Invalid model destination');
  return { provider: word(row.provider, 128), baseUrl: url.href.replace(/\/+$/u, '') };
}
export function parseRentalDesktopBusinessBinding(value: unknown): RentalDesktopBusinessBinding {
  const row = record(value, ['actorId', 'tenantId', 'workspaceId']);
  return { actorId: word(row.actorId), tenantId: word(row.tenantId), workspaceId: word(row.workspaceId) };
}
export function parseRentalDesktopCatalogQuery(value: unknown): RentalDesktopCatalogQuery {
  const row = record(value, ['limit', 'destination']);
  return { limit: positive(row.limit, 50), destination: parseRentalDesktopDestination(row.destination) };
}
export function parseRentalDesktopCatalogRequest(value: unknown): RentalDesktopCatalogRequest {
  const row = record(value, ['id', 'binding', 'query']);
  return { id: word(row.id, 128), binding: parseRentalDesktopBusinessBinding(row.binding), query: parseRentalDesktopCatalogQuery(row.query) };
}
export function parseRentalDesktopBusinessPolicy(value: unknown): RentalDesktopBusinessPolicy {
  const row = record(value, ['enabled', 'toolCodes', 'destinations', 'maxRows', 'expiresAt']);
  if (typeof row.enabled !== 'boolean' || !Array.isArray(row.toolCodes) || row.toolCodes.length > 1
    || row.toolCodes.some(code => code !== 'rental.catalog.search') || !Array.isArray(row.destinations) || row.destinations.length > 16)
    throw new Error('Invalid local business policy');
  const destinations = row.destinations.map(parseRentalDesktopDestination);
  if (new Set(destinations.map(item => JSON.stringify(item))).size !== destinations.length
    || (row.enabled && (!row.toolCodes.length || !destinations.length))) throw new Error('Invalid local business policy');
  return { enabled: row.enabled, toolCodes: [...row.toolCodes], destinations, maxRows: positive(row.maxRows, 50), expiresAt: timestamp(row.expiresAt) };
}
/** Only identifiers, registered categories and deterministic facts leave the business page; free text stays there. */
export function parseRentalDesktopCatalogResult(value: unknown): RentalDesktopCatalogResult {
  const row = record(value, ['version', 'requestId', 'binding', 'policyRevision', 'policyHash', 'observedAt', 'expiresAt',
    'configurationVersion', 'source', 'destination', 'items', 'truncated', 'omittedFields', 'execution']);
  if (row.version !== RENTAL_DESKTOP_BUSINESS_VERSION || row.source !== 'persisted_workspace_configuration'
    || row.execution !== 'read_only' || typeof row.truncated !== 'boolean' || !Array.isArray(row.items) || row.items.length > 50
    || JSON.stringify(row.omittedFields) !== JSON.stringify(['name', 'code', 'unit', 'availability', 'price'])) throw new Error('Invalid catalog projection');
  const items = row.items.map((value): RentalDesktopCatalogResult['items'][number] => {
    const item = record(value, ['reference', 'categoryCode', 'status']);
    if (item.status !== 'enabled' && item.status !== 'disabled') throw new Error('Invalid catalog state');
    return { reference: word(item.reference), categoryCode: word(item.categoryCode, 64), status: item.status };
  });
  if (new Set(items.map(item => item.reference)).size !== items.length) throw new Error('Duplicate catalog reference');
  const result: RentalDesktopCatalogResult = { version: RENTAL_DESKTOP_BUSINESS_VERSION, requestId: word(row.requestId, 128),
    binding: parseRentalDesktopBusinessBinding(row.binding), policyRevision: positive(row.policyRevision, 2147483647), policyHash: hash(row.policyHash),
    observedAt: timestamp(row.observedAt), expiresAt: timestamp(row.expiresAt), configurationVersion: hash(row.configurationVersion),
    source: row.source, destination: parseRentalDesktopDestination(row.destination), items, truncated: row.truncated,
    omittedFields: ['name', 'code', 'unit', 'availability', 'price'], execution: row.execution };
  if (Date.parse(result.expiresAt) <= Date.parse(result.observedAt) || new TextEncoder().encode(JSON.stringify(result)).byteLength > 65536)
    throw new Error('Invalid catalog projection bounds');
  return result;
}
