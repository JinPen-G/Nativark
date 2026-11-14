/** Platform-owned category proposal transport. A returned candidate may fill
 * human draft fields; it cannot publish, adopt, grant policy or execute Core. */
import { leafClosed as object, leafEnum as choice, leafId as identifier, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import { RENTAL_CATEGORY_CODE_PATTERN } from './rental-category-code';
import { CATEGORY_DRAFT_SECTIONS, RENTAL_CATEGORY_TEMPLATE_IDS, type CategoryDraftSection, type PreviewRentalCategoryCreationRequest } from './category-governance';
import type { RentalCategoryCreationPreview } from './category-governance';
import type { AiCategoryDraftJson } from './ai-category-draft-http';

export const AI_CATEGORY_PROPOSAL_HTTP = Object.freeze({ basePath: 'ai-native/category-proposals', method: 'POST',
  material: 'material', prepare: 'prepare', generate: 'generate', read: 'read', operation: 'operation',
  policyRead: 'policy-read', policyChange: 'policy-change', policyOperation: 'policy-operation' } as const);
export type AiCategoryProposalSource = { kind: 'version'; code: string; versionId: string; expectedRevision: number }
  | { kind: 'template'; templateId: typeof RENTAL_CATEGORY_TEMPLATE_IDS[number]; templateRevision: string };
export interface AiCategoryProposalReference {
  operationKey: string; taskId: string; runId: string; inputId: string; registrationRef: string; materialHash: string;
}
export type AiCategoryProposalCandidate = { kind: 'patch'; section: CategoryDraftSection; values: Record<string, AiCategoryDraftJson>;
  explanation: string; source: AiCategoryProposalSource; materialHash: string; validation: 'requires_original_draft_validation';
  definitionValidation: { valid: boolean; errors: string[] } }
  | { kind: 'create'; input: PreviewRentalCategoryCreationRequest; explanation: string; source: AiCategoryProposalSource;
    materialHash: string; preview: RentalCategoryCreationPreview };
export type AiCategoryProposalRead = { state: 'unknown' | 'stale'; reference: AiCategoryProposalReference }
  | { state: 'candidate'; reference: AiCategoryProposalReference; resultId: string; gatewayInvocationId: string;
    inputFingerprint: string; candidate: AiCategoryProposalCandidate };
export const AI_CATEGORY_PROPOSAL_CONTRACTS = Object.freeze({
  material: { request: 'AiCategoryProposalMaterialRequest', response: 'AiCategoryProposalMaterialResponse', permission: 'system:rental-category:view', write: false },
  prepare: { request: 'AiCategoryProposalPrepareRequest', response: 'AiCategoryProposalPrepareResponse', permission: 'system:rental-category:edit', write: true },
  generate: { request: 'AiCategoryProposalReference', response: 'AiCategoryProposalRead', permission: 'system:rental-category:edit', write: true },
  read: { request: 'AiCategoryProposalReference', response: 'AiCategoryProposalRead', permission: 'system:rental-category:view', write: false },
  operation: { request: 'AiCategoryProposalOperationRequest', response: 'AiCategoryProposalOperationResponse', permission: 'system:rental-category:view', write: false },
  policyRead: { request: 'AiCategoryProposalPolicyReadRequest', response: 'AiCategoryProposalPolicyResponse', permission: 'system:rental-category:edit', write: false },
  policyChange: { request: 'AiCategoryProposalPolicyChangeRequest', response: 'AiCategoryProposalPolicyResponse', permission: 'system:rental-category:edit', write: true },
  policyOperation: { request: 'AiCategoryProposalPolicyOperationRequest', response: 'AiCategoryProposalPolicyOperationResponse', permission: 'system:rental-category:edit', write: false },
} as const);
const id = identifier(), short = { ...id, maxLength: 36 }, operationKey = { ...id, maxLength: 128 }, hash = { ...text(64, 64), pattern: '^[a-f0-9]{64}$' };
const source: AiLeafSchemaDraft = { oneOf: [object({ kind: choice('version'), code: { ...text(64, 2), pattern: RENTAL_CATEGORY_CODE_PATTERN.source },
  versionId: id, expectedRevision: integer(0, 4294967294) }), object({ kind: choice('template'), templateId: choice(...RENTAL_CATEGORY_TEMPLATE_IDS), templateRevision: id })] };
const reference = object({ operationKey, taskId: short, runId: short, inputId: short, registrationRef: id, materialHash: hash });
const material = object({ version: choice('category-proposal-material-1'), principal: object({ tenantId: id, actorId: id,
  audience: choice('operator'), isSaasAdmin: { type: 'boolean', const: true } }), source,
  definition: ref('AiCategoryDraftJson'), definitionStatus: text(32), sourceHash: hash, catalogHash: hash, materialHash: hash, catalog: ref('AiCategoryDraftJson') });
const candidate: AiLeafSchemaDraft = { oneOf: [object({ kind: choice('patch'), section: choice(...CATEGORY_DRAFT_SECTIONS),
  values: { type: 'object', additionalProperties: ref('AiCategoryDraftJson'), maxProperties: 64 }, explanation: text(1000, 0), source, materialHash: hash,
  validation: choice('requires_original_draft_validation'), definitionValidation: object({ valid: { type: 'boolean' }, errors: list(text(512), 100) }) }),
object({ kind: choice('create'), input: ref('AiCategoryDraftJson'), explanation: text(1000, 0), source, materialHash: hash,
  preview: ref('AiCategoryDraftJson') })] };
const nil: AiLeafSchemaDraft = { type: 'null' }, nullable = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [value, nil] });
const limits = object({ maxSteps: integer(1, 1000), maxTotalMs: integer(1, 86400000), maxStepMs: integer(1, 86400000),
  maxOutputBytes: integer(1, 16777216), maxConcurrent: integer(1, 1), maxCalls: integer(1, 1000) });
const policy = object({ state: choice('configured'), revision: integer(1, 4294967294), enabled: { type: 'boolean' }, limits, expiresAt: time });
export const AI_CATEGORY_PROPOSAL_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiCategoryProposalSource: source, AiCategoryProposalReference: reference, AiCategoryProposalMaterial: material,
  AiCategoryProposalMaterialRequest: object({ source }), AiCategoryProposalMaterialResponse: material,
  AiCategoryProposalPrepareRequest: object({ operationKey, goal: text(2000), source }),
  AiCategoryProposalPrepareResponse: object({ state: choice('prepared'), reference, material }),
  AiCategoryProposalRead: { oneOf: [object({ state: choice('unknown', 'stale'), reference }), object({ state: choice('candidate'), reference,
    resultId: id, gatewayInvocationId: id, inputFingerprint: hash, candidate })] },
  AiCategoryProposalOperationRequest: object({ operationKey }),
  AiCategoryProposalOperationResponse: { oneOf: [object({ state: choice('unknown'), reference: nil }), object({ state: choice('stored'), reference })] },
  AiCategoryProposalPolicyReadRequest: object({}),
  AiCategoryProposalPolicyChangeRequest: object({ expectedRevision: nullable(integer(1, 4294967293)), enabled: { type: 'boolean' }, limits, expiresAt: time }),
  AiCategoryProposalPolicyResponse: { oneOf: [object({ state: choice('not_configured') }), policy] },
  AiCategoryProposalPolicyOperationRequest: object({ expectedRevision: nullable(integer(1, 4294967293)), inputHash: hash }),
  AiCategoryProposalPolicyOperationResponse: { oneOf: [object({ state: choice('not_observed'), policy: nil, retryable: { type: 'boolean', const: false } }),
    object({ state: choice('recorded'), policy, retryable: { type: 'boolean', const: false } })] },
};
