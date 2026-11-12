/** Explicit ordinary opening-section AI proposals linked to an original
 * diagnosis. The original services own field validation, current authority,
 * the new R1 Task and immutable receipts. No active configuration is saved or
 * published; an uncertain operation is read by its original key. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';

export const AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT = Object.freeze({ basePath: 'ai-native/task-opening-proposals', method: 'POST',
  list: 'list', preview: 'preview', prepare: 'prepare', operation: 'operation' } as const);
export const AI_TASK_OPENING_PROPOSAL_SECTION_KEYS = Object.freeze([
  'workspace_profile', 'item_groups', 'pricing_groups_rates', 'fulfillment_network',
] as const);
export type AiTaskOpeningProposalSectionKey = typeof AI_TASK_OPENING_PROPOSAL_SECTION_KEYS[number];
export interface AiTaskOpeningProposalQueryDraft { taskId: string; runId?: string }
export type AiTaskOpeningProposalSectionDraft = { key: AiTaskOpeningProposalSectionKey; expectedVersion: string; targetId?: string;
  changes: { field: string; value: string | string[] }[] };
export interface AiTaskOpeningProposalPreviewRequestDraft extends AiTaskOpeningProposalQueryDraft { section: AiTaskOpeningProposalSectionDraft }
export interface AiTaskOpeningProposalPrepareRequestDraft extends AiTaskOpeningProposalPreviewRequestDraft {
  operationKey: string; reviewedMaterialHash: string;
}
export interface AiTaskOpeningProposalOperationReadDraft extends AiTaskOpeningProposalQueryDraft { operationKey: string }
export interface AiTaskOpeningProposalSourceDraft {
  taskId: string; runId: string; original: AiSceneRequestReadDraft; contentHash: string; receiptRevision: number;
  sceneVersion: string; scope: { kind: 'workspace'; tenantId: string; workspaceId: string }; materialHash: string;
}
export interface AiTaskOpeningProposalFieldDraft {
  field: string; title: string; input: 'text' | 'choice' | 'choices'; value: string | string[] | null;
  choices?: string[]; maxLength?: number;
}
export interface AiTaskOpeningProposalListDraft {
  source: AiTaskOpeningProposalSourceDraft;
  candidates: { key: AiTaskOpeningProposalSectionKey; targetId: string; expectedVersion: string; fields: AiTaskOpeningProposalFieldDraft[] }[];
  hasMore: boolean; coverage: 'bounded_current_original_configuration'; readOnly: true;
  activeConfiguration: 'unchanged'; publication: 'not_attempted';
}
export interface AiTaskOpeningProposalMaterialDraft {
  scope: { kind: 'workspace'; tenantId: string; workspaceId: string }; key: AiTaskOpeningProposalSectionKey;
  targetId: string; expectedVersion: string; changes: { field: string; before: string | string[] | null; after: string | string[] }[];
  categoryCode: string; categoryVersion: string; sourceFingerprint: string;
  validation: 'ai_proposal_only_original_business_validation_required'; status: 'difference_ready' | 'no_change';
  observedAt: string; materialHash: string; source: 'original_persisted_opening_configuration';
  fieldRevision: 'profile_config_version' | 'settings_version_and_checked_source_fingerprint_not_object_cas';
  persistence: 'not_attempted'; activeConfiguration: 'unchanged'; publication: 'not_attempted';
}
export interface AiTaskOpeningProposalPreviewDraft {
  source: AiTaskOpeningProposalSourceDraft; section: AiTaskOpeningProposalSectionDraft; material: AiTaskOpeningProposalMaterialDraft;
  proposalOnly: true; activeConfiguration: 'unchanged'; publication: 'not_attempted';
}
export interface AiTaskOpeningProposalReceiptDraft {
  taskId: string; runId: string; original: AiSceneRequestReadDraft; registrationRef: string;
  proposalId: string; proposalRevision: number; payloadHash: string; material: AiTaskOpeningProposalMaterialDraft;
}
type OperationSemantics = { diagnosisTaskId: string; diagnosisRunId: string; operationKey: string;
  retryable: false; activeConfiguration: 'unchanged'; businessDraft: 'not_created'; publication: 'not_attempted' };
export type AiTaskOpeningProposalOperationDraft = OperationSemantics & (
  | { state: 'observed'; receipt: AiTaskOpeningProposalReceiptDraft; nextAction: 'read_original_proposal' }
  | { state: 'unknown' | 'not_observed'; receipt: null;
      linked: { original: AiSceneRequestReadDraft; taskId: string | null; runId: string | null; registrationRef: string | null } | null;
      nextAction: 'read_original_operation' });

export const AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS = Object.freeze({
  list: { request: 'AiTaskOpeningProposalQueryDraft', response: 'AiTaskOpeningProposalListDraft' },
  preview: { request: 'AiTaskOpeningProposalPreviewRequestDraft', response: 'AiTaskOpeningProposalPreviewDraft' },
  prepare: { request: 'AiTaskOpeningProposalPrepareRequestDraft', response: 'AiTaskOpeningProposalOperationDraft' },
  operation: { request: 'AiTaskOpeningProposalOperationReadDraft', response: 'AiTaskOpeningProposalOperationDraft' },
} as const);
const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' }, bool: AiLeafSchemaDraft = { type: 'boolean' };
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const text: AiLeafSchemaDraft = { type: 'string', maxLength: 191 };
const fieldValue: AiLeafSchemaDraft = { oneOf: [text, list(text, 100)] };
const key = choice(...AI_TASK_OPENING_PROPOSAL_SECTION_KEYS), revision = integer(1, 4294967294);
const scope = object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() });
const query = { taskId: uuid, runId: uuid };
const section = object({ key, expectedVersion: id(), targetId: id(), changes: list(object({ field: id(), value: fieldValue }), 6, 1) },
  ['key', 'expectedVersion', 'changes']);
const source = object({ taskId: uuid, runId: uuid, original: ref('AiSceneRequestReadDraft'), contentHash: hash,
  receiptRevision: revision, sceneVersion: id(), scope, materialHash: hash });
const material = object({ scope, key, targetId: id(), expectedVersion: id(),
  changes: list(object({ field: id(), before: nullable(fieldValue), after: fieldValue }), 6),
  categoryCode: id(), categoryVersion: id(), sourceFingerprint: hash,
  validation: choice('ai_proposal_only_original_business_validation_required'), status: choice('difference_ready', 'no_change'),
  observedAt: time, materialHash: hash, source: choice('original_persisted_opening_configuration'),
  fieldRevision: choice('profile_config_version', 'settings_version_and_checked_source_fingerprint_not_object_cas'),
  persistence: choice('not_attempted'), activeConfiguration: choice('unchanged'), publication: choice('not_attempted') });
const semantics = { diagnosisTaskId: uuid, diagnosisRunId: uuid, operationKey: id(), retryable: { type: 'boolean', const: false },
  activeConfiguration: choice('unchanged'), businessDraft: choice('not_created'), publication: choice('not_attempted') };
export const AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskOpeningProposalQueryDraft: object(query, ['taskId']),
  AiTaskOpeningProposalPreviewRequestDraft: object({ ...query, section }, ['taskId', 'section']),
  AiTaskOpeningProposalPrepareRequestDraft: object({ ...query, section, operationKey: id(), reviewedMaterialHash: hash },
    ['taskId', 'section', 'operationKey', 'reviewedMaterialHash']),
  AiTaskOpeningProposalOperationReadDraft: object({ ...query, operationKey: id() }, ['taskId', 'operationKey']),
  AiTaskOpeningProposalListDraft: object({ source, candidates: list(object({ key, targetId: id(), expectedVersion: id(),
    fields: list(object({ field: id(), title: text, input: choice('text', 'choice', 'choices'), value: nullable(fieldValue),
      choices: list(text, 100), maxLength: integer(1, 191) }, ['field', 'title', 'input', 'value']), 6, 1) }), 103),
    hasMore: bool, coverage: choice('bounded_current_original_configuration'), readOnly: { type: 'boolean', const: true },
    activeConfiguration: choice('unchanged'), publication: choice('not_attempted') }),
  AiTaskOpeningProposalPreviewDraft: object({ source, section, material, proposalOnly: { type: 'boolean', const: true },
    activeConfiguration: choice('unchanged'), publication: choice('not_attempted') }),
  AiTaskOpeningProposalOperationDraft: { oneOf: [
    object({ ...semantics, state: choice('observed'), receipt: object({ taskId: uuid, runId: uuid,
      original: ref('AiSceneRequestReadDraft'), registrationRef: id(), proposalId: id(), proposalRevision: revision,
      payloadHash: hash, material }), nextAction: choice('read_original_proposal') }),
    object({ ...semantics, state: choice('unknown', 'not_observed'), receipt: { type: 'null' },
      linked: nullable(object({ original: ref('AiSceneRequestReadDraft'), taskId: nullable(uuid), runId: nullable(uuid),
        registrationRef: nullable(id()) })), nextAction: choice('read_original_operation') })] },
};
