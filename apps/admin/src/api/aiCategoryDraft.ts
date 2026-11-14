/** Human category-assist transport over registered AI draft and original Core
 * routes. Mutations never replay after credential refresh; response binding and
 * the current session are checked before delivering any facts to a consumer. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_CATEGORY_DRAFT_HTTP_CONTRACTS, AI_CATEGORY_DRAFT_HTTP_SCHEMAS, isRentalCategoryCode,
  AI_CATEGORY_PROPOSAL_HTTP, AI_CATEGORY_PROPOSAL_CONTRACTS, AI_CATEGORY_PROPOSAL_SCHEMAS,
  type AiCategoryProposalSource, type AiCategoryProposalReference, type AiCategoryProposalRead,
  type AiCategoryDraftHttpRequests, type AiCategoryDraftHttpResponses, type ApiResult,
  type CategoryVersionView, type RentalCategoryDefinition, type CategoryPreparationPreview, type CategoryPreparationOperation,
  type CategoryPreparationEntitiesQuery, type CategoryPreparationEntityPage,
  type PreviewRentalCategoryCreationRequest, type CreateRentalCategoryRequest,
  type RentalCategoryCreationPreview, type RentalCategoryCreationReceipt,
  type PublishCategoryDraftRequest, type SaveCategoryVersionPolicyRequest, type SaveCategoryOpeningRequest,
  type SaveCategoryPreparationBatchRequest, type CategoryPreparationBatchReadResult,
  type CategoryPreparationSaveResult, type AdoptRentalCategoryRequest, type CategoryAdoptionResult,
  type CategoryAdoptionReceipt } from '@rental-os/shared';
import { http } from './http';
import { categoryGovernanceApi, readCategoryGovernanceAudits, type CategoryGovernanceDetail, type CategoryGovernanceSummary } from './categoryGovernance';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';

type DraftAction = keyof typeof AI_CATEGORY_DRAFT_HTTP_CONTRACTS;
export type CategoryCatalog = Omit<Awaited<ReturnType<typeof categoryGovernanceApi.catalog>>, 'pricingStrategies'> & {
  pricingStrategies: Array<{ unit: string; implementationVersion: string }>;
};
export type CategoryDraftReview = AiCategoryDraftHttpResponses['review']['review'];
export type CategoryVersionEvidence = CategoryVersionView & {
  sourceKind?: string; publishedBy?: string | null; publishReason?: string | null; dependencyDigest?: unknown;
};
export type CategoryProposalPolicy = { state: 'not_configured' } | {
  state: 'configured'; revision: number; enabled: boolean; expiresAt: string;
  limits: { maxSteps: number; maxTotalMs: number; maxStepMs: number; maxOutputBytes: number; maxConcurrent: number; maxCalls: number };
};
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_CATEGORY_DRAFT_HTTP_SCHEMAS, ...AI_CATEGORY_PROPOSAL_SCHEMAS })) ajv.addSchema(schema, `#/components/schemas/${name}`);
const contracts = Object.fromEntries(Object.entries(AI_CATEGORY_DRAFT_HTTP_CONTRACTS).map(([action, names]) => [action, {
  request: ajv.getSchema(`#/components/schemas/${names.request}`)!, response: ajv.getSchema(`#/components/schemas/${names.response}`)!
}]));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');
const liveDefinition = (value: unknown): value is RentalCategoryDefinition => object(value) && isRentalCategoryCode(value.code)
  && Array.isArray(value.supportedInventoryModes) && strings(value.defaultCapabilities) && strings(value.requiredCapabilities)
  && object(value.businessModel) && strings(value.businessModel.pricingUnits) && strings(value.businessModel.fulfillmentModes)
  && object(value.businessModel.defaults) && Array.isArray(value.businessModel.assetFields);
const categoryPath = (code: string) => {
  if (!isRentalCategoryCode(code)) throw Error('AI_INVALID_INPUT');
  return `/platform/rental-categories/${encodeURIComponent(code)}`;
};
const versionPath = (code: string, id: string) => {
  if (!identifier(id)) throw Error('AI_INVALID_INPUT');
  return `${categoryPath(code)}/versions/${encodeURIComponent(id)}`;
};
const preparationPath = (id: string) => {
  if (!identifier(id)) throw Error('AI_INVALID_INPUT');
  return `/rental/v1/category-adoption/${encodeURIComponent(id)}`;
};

async function original(method: 'get' | 'post' | 'put' | 'patch', url: string, signal: AbortSignal,
  data?: unknown, params?: unknown, timeout = 35000): Promise<unknown> {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.request<ApiResult<unknown>>({ method, url, signal: active, data: data === undefined ? undefined : structuredClone(data),
    params, timeout, ...(method === 'get' ? {} : { _authRetry: true }) });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return structuredClone(response.data.data);
}
function readVersion(value: unknown, code: string): CategoryVersionEvidence {
  if (!contracts.create.response(value) || !object(value) || !identifier(value.id) || typeof value.categoryCode !== 'string' || value.categoryCode.toLowerCase() !== code
    || !object(value.definition) || value.definition.code !== code || !revision(value.revision)
    || !['draft', 'published', 'legacy_baseline', 'archived'].includes(String(value.status))
    || typeof value.versionLabel !== 'string' || !value.versionLabel || value.versionLabel.length > 64
    || value.sourceVersionId != null && !identifier(value.sourceVersionId)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  if (value.policy != null && (!object(value.policy) || !revision(value.policy.revision)
    || value.policy.versionId !== undefined && value.policy.versionId !== value.id)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  // Draft JSON may intentionally fail business validation. Only Core decides
  // executability; this check establishes the original object identity instead.
  return value as unknown as CategoryVersionEvidence;
}
function readPreparationResult(value: unknown): CategoryPreparationSaveResult {
  if (!object(value) || !identifier(value.id) || !revision(value.revision) || !revision(value.sourceRevision)
    || !identifier(value.targetVersionId) || value.preparedOnly !== true || typeof value.adoptionImplemented !== 'boolean'
    || !identifier(value.batchId) || value.entityCount !== undefined && !revision(value.entityCount)
    || value.replayed !== undefined && typeof value.replayed !== 'boolean') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  return value as unknown as CategoryPreparationSaveResult;
}
function readAdoptionResult(value: unknown): CategoryAdoptionResult {
  if (!object(value) || value.outcome !== 'adopted' || !['upgrade', 'restore'].includes(String(value.operation))
    || !isRentalCategoryCode(value.categoryCode) || !identifier(value.sourceVersionId) || !identifier(value.targetVersionId)
    || !revision(value.sourceRevision) || !revision(value.adoptionRevision) || !revision(value.preparationRevision)
    || !revision(value.targetPolicyRevision) || !identifier(value.auditId) || typeof value.adoptedAt !== 'string'
    || !Number.isFinite(Date.parse(value.adoptedAt))) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  return value as unknown as CategoryAdoptionResult;
}
async function draft<A extends DraftAction>(action: A, input: AiCategoryDraftHttpRequests[A], signal: AbortSignal): Promise<AiCategoryDraftHttpResponses[A]> {
  const command = structuredClone(input);
  if (!contracts[action].request(command)) throw Error('AI_INVALID_INPUT');
  const result = await original('post', `/ai-native/category-drafts/${action}`, signal, command);
  if (!contracts[action].response(result)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  if (action === 'detail') {
    const detail = result as AiCategoryDraftHttpResponses['detail'];
    if (detail.code !== command.code || new Set(detail.versions.map(row => row.id)).size !== detail.versions.length) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    detail.versions.forEach(row => readVersion(row, command.code));
  }
  if (action === 'create' || action === 'patch') {
    const version = readVersion(result, command.code);
    if (version.status !== 'draft') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    if (action === 'create') {
      const expected = command as AiCategoryDraftHttpRequests['create'];
      if (version.sourceVersionId !== expected.body.sourceVersionId || version.versionLabel !== expected.body.versionLabel
        || version.revision !== 0 || version.sourceKind !== 'platform_copy') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    } else {
      const expected = command as AiCategoryDraftHttpRequests['patch'];
      if (version.id !== expected.versionId || version.revision !== expected.body.expectedRevision + 1) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    }
  }
  return result as AiCategoryDraftHttpResponses[A];
}
async function proposal<T>(action: keyof typeof AI_CATEGORY_PROPOSAL_CONTRACTS, value: unknown, signal: AbortSignal): Promise<T> {
  const contract = AI_CATEGORY_PROPOSAL_CONTRACTS[action], command = structuredClone(value);
  if (!ajv.getSchema(`#/components/schemas/${contract.request}`)?.(command)) throw Error('AI_INVALID_INPUT');
  const result = await original('post', `/${AI_CATEGORY_PROPOSAL_HTTP.basePath}/${AI_CATEGORY_PROPOSAL_HTTP[action]}`, signal, command,
    undefined, action === 'generate' ? 120000 : 35000);
  if (!ajv.getSchema(`#/components/schemas/${contract.response}`)?.(result)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
  return result as T;
}
export function readCategoryProposalReference(value: unknown): AiCategoryProposalReference {
  const copy = structuredClone(value);
  if (!ajv.getSchema('#/components/schemas/AiCategoryProposalReference')?.(copy)) throw Error('AI_RESULT_UNKNOWN');
  return copy as AiCategoryProposalReference;
}
export function readCategoryProposalSource(value: unknown): AiCategoryProposalSource {
  const copy = structuredClone(value);
  if (!ajv.getSchema('#/components/schemas/AiCategoryProposalSource')?.(copy)) throw Error('AI_RESULT_UNKNOWN');
  return copy as AiCategoryProposalSource;
}

export const aiCategoryDraftApi = Object.freeze({
  draft,
  proposalMaterial(source: AiCategoryProposalSource, signal: AbortSignal) {
    return proposal<Record<string, unknown>>('material', { source }, signal);
  },
  prepareProposal(input: { operationKey: string; goal: string; source: AiCategoryProposalSource }, signal: AbortSignal) {
    return proposal<{ state: 'prepared'; reference: AiCategoryProposalReference; material: Record<string, unknown> }>('prepare', input, signal);
  },
  generateProposal(reference: AiCategoryProposalReference, signal: AbortSignal) { return proposal<AiCategoryProposalRead>('generate', reference, signal); },
  readProposal(reference: AiCategoryProposalReference, signal: AbortSignal) { return proposal<AiCategoryProposalRead>('read', reference, signal); },
  proposalOperation(operationKey: string, signal: AbortSignal) {
    return proposal<{ state: 'unknown'; reference: null } | { state: 'stored'; reference: AiCategoryProposalReference }>('operation', { operationKey }, signal);
  },
  proposalPolicy(signal: AbortSignal) { return proposal<CategoryProposalPolicy>('policyRead', {}, signal); },
  changeProposalPolicy(value: { expectedRevision: number | null; enabled: boolean; limits: Extract<CategoryProposalPolicy, { state: 'configured' }>['limits']; expiresAt: string }, signal: AbortSignal) {
    return proposal<CategoryProposalPolicy>('policyChange', value, signal);
  },
  proposalPolicyOperation(value: { expectedRevision: number | null; inputHash: string }, signal: AbortSignal) {
    return proposal<{ state: 'not_observed'; policy: null; retryable: false }
      | { state: 'recorded'; policy: Extract<CategoryProposalPolicy, { state: 'configured' }>; retryable: false }>('policyOperation', value, signal);
  },
  draftCodeSupported(code: string) { return isRentalCategoryCode(code) && !!contracts.detail.request({ code }); },
  async list(signal: AbortSignal): Promise<CategoryGovernanceSummary[]> {
    const value = await original('get', '/platform/rental-categories', signal);
    if (!Array.isArray(value) || value.some(row => !object(row) || !isRentalCategoryCode(row.code)
      || typeof row.name !== 'string' || !revision(row.openingRevision))) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as CategoryGovernanceSummary[];
  },
  async tenants(signal: AbortSignal): Promise<Array<{ id: string; code: string; name: string }>> {
    const value = await original('get', '/platform/rental-categories/tenant-directory', signal);
    if (!Array.isArray(value) || value.some(row => !object(row) || !identifier(row.id)
      || typeof row.code !== 'string' || !row.code || typeof row.name !== 'string' || !row.name)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as Array<{ id: string; code: string; name: string }>;
  },
  async catalog(signal: AbortSignal): Promise<CategoryCatalog> {
    const value = await original('get', '/platform/rental-categories/capability-catalog', signal);
    if (!object(value) || typeof value.dynamicCreationEnabled !== 'boolean' || !Array.isArray(value.templates)
      || !Array.isArray(value.capabilities) || !Array.isArray(value.pricingStrategies)
      || value.templates.some(row => !object(row) || !['serialized', 'quantity', 'kit'].includes(String(row.id))
        || !identifier(row.revision) || !liveDefinition(row.definition))
      || value.capabilities.some(row => !object(row) || !identifier(row.code) || typeof row.label !== 'string'
        || typeof row.implemented !== 'boolean' || row.applicableCategories !== 'all' && !strings(row.applicableCategories))
      || value.pricingStrategies.some(row => !object(row) || !identifier(row.unit) || !identifier(row.implementationVersion))) throw Error('AI_RESOURCE_UNAVAILABLE');
    return value as unknown as CategoryCatalog;
  },
  async detail(code: string, signal: AbortSignal): Promise<CategoryGovernanceDetail> {
    const value = await original('get', categoryPath(code), signal);
    if (!contracts.detail.response(value) || !object(value) || value.code !== code || !revision(value.openingRevision) || !Array.isArray(value.versions)
      || value.versions.length > 100 || !['all', 'pilot', 'unopened', 'stopped'].includes(String(value.openingScope))) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    value.versions.forEach(row => readVersion(row, code));
    if (new Set(value.versions.map(row => (row as Record<string, unknown>).id)).size !== value.versions.length) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as unknown as CategoryGovernanceDetail;
  },
  async copyVersion(code: string, input: AiCategoryDraftHttpRequests['create']['body'], signal: AbortSignal) {
    const result = readVersion(await original('post', `${categoryPath(code)}/drafts`, signal, input), code);
    if (result.status !== 'draft' || result.sourceVersionId !== input.sourceVersionId || result.versionLabel !== input.versionLabel
      || result.revision !== 0 || result.sourceKind !== 'platform_copy') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return result;
  },
  async patchVersion(code: string, id: string, section: AiCategoryDraftHttpRequests['patch']['section'],
    input: AiCategoryDraftHttpRequests['patch']['body'], signal: AbortSignal) {
    const result = readVersion(await original('patch', `${versionPath(code, id)}/sections/${section}`, signal, input), code);
    if (result.id !== id || result.status !== 'draft' || result.revision !== input.expectedRevision + 1) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return result;
  },
  async reviewVersion(code: string, id: string, signal: AbortSignal): Promise<CategoryDraftReview> {
    const result = await original('get', `${versionPath(code, id)}/preview`, signal);
    if (!object(result) || typeof result.valid !== 'boolean' || !Array.isArray(result.errors) || !Array.isArray(result.differences)
      || !Array.isArray(result.changedSections) || !revision(result.revision) || !revision(result.affectedSpaces)
      || result.previewOnly !== true) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return result as unknown as CategoryDraftReview;
  },
  async audits(code: string, signal: AbortSignal) {
    return readCategoryGovernanceAudits(await original('get', `${categoryPath(code)}/audits`, signal), code);
  },
  async previewCreation(input: PreviewRentalCategoryCreationRequest, signal: AbortSignal): Promise<RentalCategoryCreationPreview> {
    const value = await original('post', '/platform/rental-categories/creation-preview', signal, input);
    if (!object(value) || typeof value.valid !== 'boolean' || !strings(value.errors) || value.previewOnly !== true
      || !liveDefinition(value.definition) || value.definition.code !== input.code || !strings(value.removedCapabilities)
      || !/^[a-f0-9]{64}$/u.test(String(value.definitionHash))) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as unknown as RentalCategoryCreationPreview;
  },
  async createCategory(input: CreateRentalCategoryRequest, signal: AbortSignal) {
    return readVersion(await original('post', '/platform/rental-categories', signal, input), input.code);
  },
  async creationReceipt(key: string, signal: AbortSignal): Promise<RentalCategoryCreationReceipt> {
    if (!identifier(key)) throw Error('AI_INVALID_INPUT');
    const value = await original('get', `/platform/rental-categories/creation-requests/${encodeURIComponent(key)}`, signal);
    if (!object(value) || !['created', 'unknown'].includes(String(value.outcome))) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    if (value.outcome === 'created') {
      if (!object(value.version) || !isRentalCategoryCode(value.version.categoryCode)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
      readVersion(value.version, value.version.categoryCode);
    }
    return value as unknown as RentalCategoryCreationReceipt;
  },
  async publish(code: string, id: string, input: PublishCategoryDraftRequest, signal: AbortSignal) {
    return readVersion(await original('post', `${versionPath(code, id)}/publish`, signal, input), code);
  },
  async policy(code: string, id: string, input: SaveCategoryVersionPolicyRequest, signal: AbortSignal) {
    return readVersion(await original('put', `${versionPath(code, id)}/adoption-policy`, signal, input), code);
  },
  async opening(code: string, input: SaveCategoryOpeningRequest, signal: AbortSignal) {
    const value = await original('put', `${categoryPath(code)}/opening-policy`, signal, input);
    if (!object(value) || !revision(value.openingRevision) || value.openingRevision !== input.expectedRevision + 1
      || value.openingScope !== input.scope || JSON.stringify(value.openingTenantIds) !== JSON.stringify(input.tenantIds)
      || input.recommendedVersionId !== undefined && value.recommendedVersionId !== input.recommendedVersionId) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value;
  },
  async candidates(operation: CategoryPreparationOperation, signal: AbortSignal) {
    const value = await original('get', '/rental/v1/category-adoption/candidates', signal, undefined, { operation });
    if (!object(value) || !identifier(value.sourceVersionId) || !revision(value.sourceRevision) || !Array.isArray(value.versions)
      || value.versions.some(row => !object(row) || !identifier(row.id) || typeof row.versionLabel !== 'string'
        || typeof row.definitionExecutable !== 'boolean')) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as { sourceVersionId: string; sourceRevision: number; versions: Array<{ id: string; versionLabel: string; definitionExecutable: boolean; unavailableReason?: string }> };
  },
  async preparation(id: string, operation: CategoryPreparationOperation, signal: AbortSignal): Promise<CategoryPreparationPreview> {
    const value = await original('get', `${preparationPath(id)}/preparation`, signal, undefined, { operation, metadataOnly: true });
    if (!object(value) || value.targetVersionId !== id || !identifier(value.sourceVersionId) || !revision(value.sourceRevision)
      || !liveDefinition(value.targetDefinition) || !object(value.validation) || typeof value.validation.valid !== 'boolean'
      || !strings(value.validation.errors) || !object(value.businessCompatibility) || typeof value.businessCompatibility.valid !== 'boolean'
      || typeof value.businessCompatibility.complete !== 'boolean' || !Array.isArray(value.businessCompatibility.blockers)
      || value.businessCompatibility.blockers.some(row => !object(row) || typeof row.message !== 'string')
      || !object(value.commercialContext) || typeof value.commercialContext.newBusinessAllowed !== 'boolean'
      || typeof value.stale !== 'boolean' || typeof value.adoptionImplemented !== 'boolean'
      || value.preparation !== null && (!object(value.preparation) || !revision(value.preparation.revision) || !object(value.preparation.patches))
      || !object(value.entities) || !Array.isArray(value.entities.itemGroups) || !Array.isArray(value.entities.assets)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as unknown as CategoryPreparationPreview;
  },
  async entities(id: string, query: CategoryPreparationEntitiesQuery, signal: AbortSignal): Promise<CategoryPreparationEntityPage> {
    const value = await original('get', `${preparationPath(id)}/preparation/entities`, signal, undefined, query);
    if (!object(value) || value.entityType !== query.entityType || !identifier(value.sourceVersionId)
      || !revision(value.sourceRevision) || !revision(value.preparationRevision) || !revision(value.total)
      || !Array.isArray(value.rows) || value.rows.length > (query.limit ?? 20)
      || value.rows.some(row => !object(row) || !identifier(row.id) || typeof row.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(row.updatedAt)) || !object(row.attributes))
      || value.nextCursor !== undefined && typeof value.nextCursor !== 'string') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return value as unknown as CategoryPreparationEntityPage;
  },
  async saveBatch(id: string, input: SaveCategoryPreparationBatchRequest, signal: AbortSignal): Promise<CategoryPreparationSaveResult> {
    return readPreparationResult(await original('patch', `${preparationPath(id)}/preparation`, signal, input));
  },
  async readBatch(id: string, batchId: string, signal: AbortSignal): Promise<CategoryPreparationBatchReadResult> {
    if (!identifier(batchId)) throw Error('AI_INVALID_INPUT');
    const value = await original('get', `${preparationPath(id)}/preparation/batches/${encodeURIComponent(batchId)}`, signal);
    if (!object(value)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    if (value.outcome === 'unknown') return { outcome: 'unknown' };
    if (value.outcome !== 'saved') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return { outcome: 'saved', result: readPreparationResult(value.result) };
  },
  async adopt(id: string, input: AdoptRentalCategoryRequest, signal: AbortSignal): Promise<CategoryAdoptionResult> {
    return readAdoptionResult(await original('post', `${preparationPath(id)}/adopt`, signal, input));
  },
  async adoptionReceipt(key: string, signal: AbortSignal): Promise<CategoryAdoptionReceipt> {
    if (!identifier(key)) throw Error('AI_INVALID_INPUT');
    const value = await original('get', `/rental/v1/category-adoption/operations/${encodeURIComponent(key)}`, signal);
    if (!object(value)) throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    if (value.outcome === 'unknown') return { outcome: 'unknown' };
    if (value.outcome !== 'adopted') throw Error('AI_CATEGORY_RESULT_UNAVAILABLE');
    return { outcome: 'adopted', result: readAdoptionResult(value.result) };
  }
});
