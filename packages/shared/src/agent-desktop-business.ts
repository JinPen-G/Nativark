/** Closed local-business messages. Identity is a binding to recheck, never an authorization grant. */
export const RENTAL_DESKTOP_BUSINESS_VERSION = 1 as const;
export const RENTAL_DESKTOP_BUSINESS_HTTP = {
  basePath: 'ai-native/desktop-business', catalog: 'catalog', policy: 'policy',
  savePolicy: 'policy/change', policyOperation: 'policy/operation'
} as const;
export interface RentalDesktopModelDestination { provider: string; baseUrl: string }
export interface RentalDesktopModelSelection { provider: string; model: string }
export type RentalDesktopModelProtocol = 'openai-responses' | 'openai-completions' | 'anthropic-messages';
/** Exact permission target; no wildcard, provider defaults or implicit protocol migration. */
export interface RentalDesktopModelRoute extends RentalDesktopModelDestination { model: string; protocol: RentalDesktopModelProtocol }
/** Local Host observation of a real prepared call; not dispatch admission or a final network/redirect attestation. */
export interface RentalDesktopModelInspection {
  selection: RentalDesktopModelSelection;
  destination: RentalDesktopModelDestination;
  protocol: RentalDesktopModelProtocol;
  preparationVersion: string;
  observedAt: string;
  expiresAt: string;
  source: 'prepared_initial_route';
  execution: 'not_dispatched';
}
export interface RentalDesktopModelCatalogQuery { selection: RentalDesktopModelSelection; limit: number }
export interface RentalDesktopCatalogMaterial {
  content: string;
  contentHash: string;
  purpose: 'human_preview';
  modelRequest: 'not_sent';
}
export interface RentalDesktopModelCatalogResult { catalog: RentalDesktopCatalogResult; inspection: RentalDesktopModelInspection; material: RentalDesktopCatalogMaterial }
export interface RentalDesktopBusinessBinding { actorId: string; tenantId: string; workspaceId: string }
export interface RentalDesktopCatalogQuery {
  limit: number;
  destination: RentalDesktopModelDestination;
  modelRoute?: RentalDesktopModelRoute;
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
  modelRoute?: RentalDesktopModelRoute;
  items: Array<{ reference: string; categoryCode: string; status: 'enabled' | 'disabled' }>;
  truncated: boolean;
  omittedFields: readonly ['name', 'code', 'unit', 'availability', 'price'];
  execution: 'read_only';
}
export interface RentalDesktopBusinessPolicy {
  enabled: boolean;
  toolCodes: Array<'rental.catalog.search'>;
  destinations: RentalDesktopModelDestination[];
  /** Absent legacy configuration or an empty list grants no model-bound preview. */
  modelRoutes?: RentalDesktopModelRoute[];
  maxRows: number;
  expiresAt: string;
}
export type RentalDesktopBusinessPolicyRead = { state: 'not_configured' } | {
  state: 'configured'; revision: number; policy: RentalDesktopBusinessPolicy;
};
export interface RentalDesktopPolicySave {
  operationKey: string;
  expectedRevision: number;
  policy: RentalDesktopBusinessPolicy;
}
export interface RentalDesktopPolicySaved {
  state: 'saved'; operationKey: string; result: Extract<RentalDesktopBusinessPolicyRead, { state: 'configured' }>;
}
export type RentalDesktopPolicyObservation = { state: 'not_observed' } | {
  state: 'observed'; operationKey: string; result: Extract<RentalDesktopBusinessPolicyRead, { state: 'configured' }>;
};
export type RentalDesktopBusinessFailureCode = 'AI_ACCESS_DENIED' | 'AI_SCOPE_CHANGED' | 'AI_INVALID_INPUT'
  | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
export type RentalDesktopCatalogReply = { id: string; ok: true; result: RentalDesktopCatalogResult }
  | { id: string; ok: false; code: RentalDesktopBusinessFailureCode };
export type RentalDesktopCatalogPreparation = {
  state: 'prepared'; toolCode: 'rental.catalog.search'; input: { limit: number };
  sources: { intent: 'explicit_request'; limit: 'explicit_request' | 'preview_default' };
  modelRequest: 'not_sent';
} | { state: 'clarification_required'; reason: 'empty' | 'unsupported_expression' | 'limit_out_of_range' | 'invalid_input'; modelRequest: 'not_sent' };

/** Parse an entire supported catalog request locally. No partial extraction, PII heuristics, raw-text echo or model fallback.
 * @param value Human text; only the fixed catalog grammar is accepted, with an optional explicit 1..50 result bound.
 * @returns Detached structured conditions, or a non-sensitive clarification reason. Neither is authorization or model admission.
 */
export function prepareRentalDesktopCatalogInput(value: unknown): RentalDesktopCatalogPreparation {
  const clarify = (reason: Extract<RentalDesktopCatalogPreparation, { state: 'clarification_required' }>['reason']): RentalDesktopCatalogPreparation =>
    ({ state: 'clarification_required', reason, modelRequest: 'not_sent' });
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) return clarify('invalid_input');
  const text = value.trim();
  if (!text) return clarify('empty');
  const parsed = /^(?:请)?(?:查看|查询|显示|列出)?(?:前([1-9]\d?)条)?(?:商品目录|商品列表|目录)[。！!？?]?$/u.exec(text)
    ?? /^(?:please\s+)?(?:show|list|read)\s+(?:the\s+)?(?:first\s+([1-9]\d?)\s+)?(?:catalog|products)[.!?]?$/iu.exec(text);
  if (!parsed) return clarify('unsupported_expression');
  const limit = parsed[1] === undefined ? 10 : Number(parsed[1]);
  if (limit < 1 || limit > 50) return clarify('limit_out_of_range');
  return { state: 'prepared', toolCode: 'rental.catalog.search', input: { limit },
    sources: { intent: 'explicit_request', limit: parsed[1] === undefined ? 'preview_default' : 'explicit_request' }, modelRequest: 'not_sent' };
}

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
export function parseRentalDesktopModelSelection(value: unknown): RentalDesktopModelSelection {
  const row = record(value, ['provider', 'model']);
  if (typeof row.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u.test(row.model)) throw new Error('Invalid model selection');
  return { provider: word(row.provider, 128), model: row.model };
}
export function parseRentalDesktopModelRoute(value: unknown): RentalDesktopModelRoute {
  const row = record(value, ['provider', 'baseUrl', 'model', 'protocol']);
  const destination = parseRentalDesktopDestination({ provider: row.provider, baseUrl: row.baseUrl });
  const selection = parseRentalDesktopModelSelection({ provider: row.provider, model: row.model });
  if (typeof row.protocol !== 'string' || !['openai-responses', 'openai-completions', 'anthropic-messages'].includes(row.protocol))
    throw new Error('Invalid model protocol');
  return { ...destination, model: selection.model, protocol: row.protocol as RentalDesktopModelProtocol };
}
export function parseRentalDesktopModelInspection(value: unknown): RentalDesktopModelInspection {
  const row = record(value, ['selection', 'destination', 'protocol', 'preparationVersion', 'observedAt', 'expiresAt', 'source', 'execution']);
  const selection = parseRentalDesktopModelSelection(row.selection), destination = parseRentalDesktopDestination(row.destination);
  if (selection.provider !== destination.provider || typeof row.protocol !== 'string'
    || !['openai-responses', 'openai-completions', 'anthropic-messages'].includes(row.protocol)
    || row.source !== 'prepared_initial_route' || row.execution !== 'not_dispatched') throw new Error('Invalid prepared model route');
  const observedAt = timestamp(row.observedAt), expiresAt = timestamp(row.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(observedAt) || Date.parse(expiresAt) - Date.parse(observedAt) > 30000) throw new Error('Invalid model inspection lifetime');
  return { selection, destination, protocol: row.protocol as RentalDesktopModelInspection['protocol'], preparationVersion: hash(row.preparationVersion), observedAt, expiresAt,
    source: 'prepared_initial_route', execution: 'not_dispatched' };
}
export function parseRentalDesktopModelCatalogQuery(value: unknown): RentalDesktopModelCatalogQuery {
  const row = record(value, ['selection', 'limit']);
  return { selection: parseRentalDesktopModelSelection(row.selection), limit: positive(row.limit, 50) };
}
export function parseRentalDesktopModelCatalogResult(value: unknown): RentalDesktopModelCatalogResult {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65536) throw new Error('Model catalog result too large');
  const row = record(value, ['catalog', 'inspection', 'material']), catalog = parseRentalDesktopCatalogResult(row.catalog), inspection = parseRentalDesktopModelInspection(row.inspection);
  if (JSON.stringify(catalog.destination) !== JSON.stringify(inspection.destination) || Date.parse(catalog.expiresAt) > Date.parse(inspection.expiresAt))
    throw new Error('Model route differs from authorized catalog destination');
  const expectedRoute = parseRentalDesktopModelRoute({ ...inspection.destination, model: inspection.selection.model, protocol: inspection.protocol });
  if (!catalog.modelRoute || JSON.stringify(catalog.modelRoute) !== JSON.stringify(expectedRoute)) throw new Error('Model route not authorized');
  const material = record(row.material, ['content', 'contentHash', 'purpose', 'modelRequest']);
  if (material.purpose !== 'human_preview' || material.modelRequest !== 'not_sent'
    || material.content !== projectRentalDesktopCatalogMaterial(catalog)) throw new Error('Invalid catalog material');
  return { catalog, inspection, material: { content: material.content as string, contentHash: hash(material.contentHash), purpose: 'human_preview', modelRequest: 'not_sent' } };
}
export function parseRentalDesktopBusinessBinding(value: unknown): RentalDesktopBusinessBinding {
  const row = record(value, ['actorId', 'tenantId', 'workspaceId']);
  return { actorId: word(row.actorId), tenantId: word(row.tenantId), workspaceId: word(row.workspaceId) };
}
export function parseRentalDesktopCatalogQuery(value: unknown): RentalDesktopCatalogQuery {
  const row = record(value, ['limit', 'destination', 'modelRoute']), destination = parseRentalDesktopDestination(row.destination);
  const modelRoute = 'modelRoute' in row ? parseRentalDesktopModelRoute(row.modelRoute) : undefined;
  if (modelRoute && JSON.stringify({ provider: modelRoute.provider, baseUrl: modelRoute.baseUrl }) !== JSON.stringify(destination))
    throw new Error('Model route differs from query destination');
  return { limit: positive(row.limit, 50), destination, ...modelRoute ? { modelRoute } : {} };
}
export function parseRentalDesktopCatalogRequest(value: unknown): RentalDesktopCatalogRequest {
  const row = record(value, ['id', 'binding', 'query']);
  return { id: word(row.id, 128), binding: parseRentalDesktopBusinessBinding(row.binding), query: parseRentalDesktopCatalogQuery(row.query) };
}
export function parseRentalDesktopBusinessPolicy(value: unknown): RentalDesktopBusinessPolicy {
  const row = record(value, ['enabled', 'toolCodes', 'destinations', 'modelRoutes', 'maxRows', 'expiresAt']);
  if (typeof row.enabled !== 'boolean' || !Array.isArray(row.toolCodes) || row.toolCodes.length > 1
    || row.toolCodes.some(code => code !== 'rental.catalog.search') || !Array.isArray(row.destinations) || row.destinations.length > 16)
    throw new Error('Invalid local business policy');
  const destinations = row.destinations.map(parseRentalDesktopDestination);
  let modelRoutes: RentalDesktopModelRoute[] | undefined;
  if ('modelRoutes' in row) {
    if (!Array.isArray(row.modelRoutes) || row.modelRoutes.length > 32) throw new Error('Invalid model route policy');
    modelRoutes = row.modelRoutes.map(parseRentalDesktopModelRoute);
    if (new Set(modelRoutes.map(item => JSON.stringify(item))).size !== modelRoutes.length
      || modelRoutes.some(item => !destinations.some(destination => destination.provider === item.provider && destination.baseUrl === item.baseUrl)))
      throw new Error('Model route outside destination policy');
  }
  if (new Set(destinations.map(item => JSON.stringify(item))).size !== destinations.length
    || (row.enabled && (!row.toolCodes.length || !destinations.length))) throw new Error('Invalid local business policy');
  // Preserve absent legacy fields so original operation payload hashes and receipts remain readable.
  return { enabled: row.enabled, toolCodes: [...row.toolCodes], destinations, ...modelRoutes ? { modelRoutes } : {}, maxRows: positive(row.maxRows, 50), expiresAt: timestamp(row.expiresAt) };
}
/** Current policy only; a historical save receipt must never be substituted for this read. */
export function parseRentalDesktopBusinessPolicyRead(value: unknown): RentalDesktopBusinessPolicyRead {
  const row = record(value, ['state', 'revision', 'policy']);
  if (row.state === 'not_configured' && Object.keys(row).length === 1) return { state: 'not_configured' };
  if (row.state !== 'configured') throw new Error('Invalid local business policy read');
  return { state: 'configured', revision: positive(row.revision, 2147483647), policy: parseRentalDesktopBusinessPolicy(row.policy) };
}
/** Validate a human policy change before any write; zero means no previous policy, never unrestricted access. */
export function parseRentalDesktopPolicySave(value: unknown): RentalDesktopPolicySave {
  const row = record(value, ['operationKey', 'expectedRevision', 'policy']);
  if (typeof row.expectedRevision !== 'number' || !Number.isInteger(row.expectedRevision) || row.expectedRevision < 0
    || row.expectedRevision > 2147483646) throw new Error('Invalid local business policy revision');
  const result = { operationKey: word(row.operationKey, 128), expectedRevision: row.expectedRevision, policy: parseRentalDesktopBusinessPolicy(row.policy) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16384) throw new Error('Local business policy too large');
  return result;
}
export function parseRentalDesktopPolicySaved(value: unknown): RentalDesktopPolicySaved {
  const row = record(value, ['state', 'operationKey', 'result']), result = parseRentalDesktopBusinessPolicyRead(row.result);
  if (row.state !== 'saved' || result.state !== 'configured') throw new Error('Invalid local business policy receipt');
  return { state: 'saved', operationKey: word(row.operationKey, 128), result };
}
export function parseRentalDesktopPolicyObservation(value: unknown): RentalDesktopPolicyObservation {
  const row = record(value, ['state', 'operationKey', 'result']);
  if (row.state === 'not_observed' && Object.keys(row).length === 1) return { state: 'not_observed' };
  const result = parseRentalDesktopBusinessPolicyRead(row.result);
  if (row.state !== 'observed' || result.state !== 'configured') throw new Error('Invalid local business policy observation');
  return { state: 'observed', operationKey: word(row.operationKey, 128), result };
}
/** Only identifiers, registered categories and deterministic facts leave the business page; free text stays there. */
export function parseRentalDesktopCatalogResult(value: unknown): RentalDesktopCatalogResult {
  const row = record(value, ['version', 'requestId', 'binding', 'policyRevision', 'policyHash', 'observedAt', 'expiresAt',
    'configurationVersion', 'source', 'destination', 'modelRoute', 'items', 'truncated', 'omittedFields', 'execution']);
  if (row.version !== RENTAL_DESKTOP_BUSINESS_VERSION || row.source !== 'persisted_workspace_configuration'
    || row.execution !== 'read_only' || typeof row.truncated !== 'boolean' || !Array.isArray(row.items) || row.items.length > 50
    || JSON.stringify(row.omittedFields) !== JSON.stringify(['name', 'code', 'unit', 'availability', 'price'])) throw new Error('Invalid catalog projection');
  const items = row.items.map((value): RentalDesktopCatalogResult['items'][number] => {
    const item = record(value, ['reference', 'categoryCode', 'status']);
    if (item.status !== 'enabled' && item.status !== 'disabled') throw new Error('Invalid catalog state');
    return { reference: word(item.reference), categoryCode: word(item.categoryCode, 64), status: item.status };
  });
  if (new Set(items.map(item => item.reference)).size !== items.length) throw new Error('Duplicate catalog reference');
  const destination = parseRentalDesktopDestination(row.destination), modelRoute = 'modelRoute' in row ? parseRentalDesktopModelRoute(row.modelRoute) : undefined;
  if (modelRoute && (modelRoute.provider !== destination.provider || modelRoute.baseUrl !== destination.baseUrl)) throw new Error('Invalid catalog model route');
  const result: RentalDesktopCatalogResult = { version: RENTAL_DESKTOP_BUSINESS_VERSION, requestId: word(row.requestId, 128),
    binding: parseRentalDesktopBusinessBinding(row.binding), policyRevision: positive(row.policyRevision, 2147483647), policyHash: hash(row.policyHash),
    observedAt: timestamp(row.observedAt), expiresAt: timestamp(row.expiresAt), configurationVersion: hash(row.configurationVersion),
    source: row.source, destination, ...modelRoute ? { modelRoute } : {}, items, truncated: row.truncated,
    omittedFields: ['name', 'code', 'unit', 'availability', 'price'], execution: row.execution };
  if (Date.parse(result.expiresAt) <= Date.parse(result.observedAt) || new TextEncoder().encode(JSON.stringify(result)).byteLength > 65536)
    throw new Error('Invalid catalog projection bounds');
  return result;
}
/** Canonical minimum material for human review, never a dispatch grant. No raw text, internal IDs or identity binding enters content.
 * @param value Original authorized catalog response; its outer binding/versions remain with the caller.
 * @returns Stable JSON with per-response ordinal references. Re-reading never preserves those references as business authority.
 */
export function projectRentalDesktopCatalogMaterial(value: unknown): string {
  const catalog = parseRentalDesktopCatalogResult(value);
  if (!catalog.modelRoute) throw new Error('Model-bound source required');
  // Closed projection categories, not another category configuration or pricing engine.
  if (catalog.items.some(item => !['vehicle', 'camera', 'camping', 'construction'].includes(item.categoryCode))) throw new Error('Unprojectable catalog category');
  return JSON.stringify({ toolCode: 'rental.catalog.search', source: catalog.source, configurationVersion: catalog.configurationVersion,
    observedAt: catalog.observedAt, expiresAt: catalog.expiresAt,
    items: catalog.items.map((item, index) => ({ reference: `item_${index + 1}`, categoryCode: item.categoryCode, status: item.status })),
    coverage: catalog.truncated ? 'partial' : 'returned_page', omittedFields: catalog.omittedFields });
}
