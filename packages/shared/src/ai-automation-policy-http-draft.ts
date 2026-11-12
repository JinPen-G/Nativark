/** Original automation configuration and CAS receipts. These contracts neither
 * grant an automation identity nor start a task, worker or business operation. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafTime as time, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiBusinessEventDraft } from './ai-events-draft';

export const AI_AUTOMATION_POLICY_HTTP_CONTRACTS = Object.freeze({
  read: { request: 'AiAutomationPolicyReadRequestDraft', response: 'AiAutomationPolicyCurrentDraft' },
  preview: { request: 'AiAutomationPolicyChangeDraft', response: 'AiAutomationPolicyPreviewDraft' },
  prepare: { request: 'AiAutomationPolicyChangeDraft', response: 'AiAutomationPolicyPreparationDraft' },
  preparation: { request: 'AiAutomationPolicyOperationReadRequestDraft', response: 'AiAutomationPolicyPreparationReadDraft' },
  review: { request: 'AiAutomationPolicyPreparationReadRequestDraft', response: 'AiAutomationPolicyReviewDraft' },
  operation: { request: 'AiAutomationPolicyOperationReadRequestDraft', response: 'AiAutomationPolicyOperationDraft' },
  commit: { request: 'AiAutomationPolicyCommitRequestDraft', response: 'AiAutomationPolicyCommitResultDraft' }
} as const);
type Permission = 'system:integration:manage' | 'rental-os:finance:view' | 'rental-os:order:view';
export interface AiAutomationSubjectSettingsDraft {
  enabled: boolean; revoked: boolean; permissions: Permission[];
  locationScope: { mode: 'all'; locationIds: [] } | { mode: 'selected'; locationIds: string[] }; expiresAt: string;
}
export interface AiAutomationPolicySettingsDraft {
  mode: 'disabled' | 'shadow' | 'manual_confirmation'; revoked: boolean; sceneCode: string; sceneVersion: string;
  allowedEventTypes: Array<AiBusinessEventDraft['type']>;
  maxTasksPerDay: number; cooldownSeconds: number; validFrom: string; expiresAt: string;
}
export interface AiAutomationPolicyChangeDraft {
  operationKey: string; subjectId: string | null; policyId: string | null;
  expectedSubjectRevision: number | null; expectedPolicyRevision: number | null;
  subject: AiAutomationSubjectSettingsDraft; policy: AiAutomationPolicySettingsDraft;
}
export interface AiAutomationPolicyReadRequestDraft { subjectId: string; policyId: string }
export interface AiAutomationPolicyOperationReadRequestDraft { operationKey: string }
export interface AiAutomationPolicyPreparationReadRequestDraft { preparationId: string }
export interface AiAutomationPolicyCommitRequestDraft extends AiAutomationPolicyPreparationReadRequestDraft {
  changeHash: string; confirm: 'apply_automation_policy_change';
}
type Provenance = { enabledBy: string | null; enabledAudience: 'operator' | null; enabledAt: string | null };
type Semantics = { executionPermission: false; businessActionRequested: false };
export interface AiAutomationPolicyConfigurationDraft {
  subject: AiAutomationSubjectSettingsDraft & Provenance & { id: string; authorizationRevision: number };
  policy: AiAutomationPolicySettingsDraft & Provenance & { id: string; subjectId: string; revision: number;
    counterDay: string | null; preparedCount: number; lastPreparedAt: string | null };
}
export type AiAutomationPolicyCurrentDraft = Semantics & AiAutomationPolicyConfigurationDraft & { state: 'configured' };
export interface AiAutomationPolicySourceDraft {
  subject: (Provenance & { id: string; revision: number; settings: AiAutomationSubjectSettingsDraft }) | null;
  policy: (Provenance & { id: string; subjectId: string; revision: number; settings: AiAutomationPolicySettingsDraft }) | null;
  scene: { scopeId: string; sceneCode: string; sceneVersion: string; revision: number; enabled: boolean;
    tools: Array<{ code: string; version: string }>; limits: { maxSteps: number; maxCalls: number; maxConcurrent: 1;
      maxTotalMs: number; maxStepMs: number; maxOutputBytes: number }; expiresAt: string };
}
export type AiAutomationPolicyPreviewDraft = Semantics & { command: AiAutomationPolicyChangeDraft; before: AiAutomationPolicySourceDraft;
  changeHash: string; sourceHash: string; prepareResourceHash: string };
type Recorded = Semantics & { state: 'observed'; operationId: string; operationKey: string; preparationId: string;
  changeHash: string; result: AiAutomationPolicyConfigurationDraft; recordedAt: string; retryable: false };
type Prepared = Semantics & { state: 'prepared' | 'expired' | 'stale'; preparationId: string; operationKey: string;
  subjectId: string; policyId: string; changeHash: string; commitResourceHash: string; proposal: AiAutomationPolicyChangeDraft; expiresAt: string };
type Unknown = Semantics & { state: 'unknown'; operationKey: string; retryable: false; preparationId?: string;
  nextAction?: 'read_preparation' | 'read_operation' };
type Absent = Semantics & { state: 'not_observed'; operationKey: string; retryable: false };
export type AiAutomationPolicyReviewDraft = Prepared | Recorded;
export type AiAutomationPolicyPreparationDraft = AiAutomationPolicyReviewDraft | Unknown;
export type AiAutomationPolicyPreparationReadDraft = AiAutomationPolicyReviewDraft | Absent;
export type AiAutomationPolicyCommitResultDraft = Recorded | Unknown;
export type AiAutomationPolicyOperationDraft = AiAutomationPolicyCommitResultDraft | Absent;

const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const shortId = { ...id(), maxLength: 36 }, sceneId = { ...id(), maxLength: 64 }, key = { ...id(), maxLength: 128 };
const revision = integer(1, 4294967293), hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const semantics = { executionPermission: no, businessActionRequested: no };
const subjectProperties = { enabled: bool, revoked: bool,
  permissions: { ...list(choice('system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'), 3, 1), uniqueItems: true },
  locationScope: { oneOf: [object({ mode: choice('all'), locationIds: list(id(), 0) }),
    object({ mode: choice('selected'), locationIds: { ...list(id(), 100, 1), uniqueItems: true } })] }, expiresAt: time };
const policyProperties = { mode: choice('disabled', 'shadow', 'manual_confirmation'), revoked: bool, sceneCode: sceneId, sceneVersion: sceneId,
  allowedEventTypes: { ...list(choice('notification.failed', 'refund.failed', 'inspection.return_exception',
    'fulfillment.resource_shortage', 'opening.missing_configuration'), 5, 1), uniqueItems: true },
  maxTasksPerDay: integer(0, 10000), cooldownSeconds: integer(1, 86400), validFrom: time, expiresAt: time };
const provenance = { enabledBy: nullable(id()), enabledAudience: nullable(choice('operator')), enabledAt: nullable(time) };
const subject = object(subjectProperties), policy = object(policyProperties);
const commandBase = { operationKey: key, subject, policy };
// The same identity/revision pairs as the original service: a new policy needs
// an existing subject or a new subject in this exact preparation, never a free ID.
const command = { oneOf: [
  object({ ...commandBase, subjectId: { type: 'null' }, policyId: { type: 'null' }, expectedSubjectRevision: { type: 'null' }, expectedPolicyRevision: { type: 'null' } }),
  object({ ...commandBase, subjectId: shortId, policyId: { type: 'null' }, expectedSubjectRevision: revision, expectedPolicyRevision: { type: 'null' } }),
  object({ ...commandBase, subjectId: shortId, policyId: shortId, expectedSubjectRevision: revision, expectedPolicyRevision: revision })] };
const configuration = { subject: object({ ...subjectProperties, ...provenance, id: shortId, authorizationRevision: revision }),
  policy: object({ ...policyProperties, ...provenance, id: shortId, subjectId: shortId, revision, counterDay: nullable(time),
    preparedCount: integer(0, 4294967295), lastPreparedAt: nullable(time) }) };
const recorded = object({ ...semantics, state: choice('observed'), operationId: uuid, operationKey: key, preparationId: uuid,
  changeHash: hash, result: object(configuration), recordedAt: time, retryable: no });
const prepared = object({ ...semantics, state: choice('prepared', 'expired', 'stale'), preparationId: uuid, operationKey: key,
  subjectId: shortId, policyId: shortId, changeHash: hash, commitResourceHash: hash, proposal: command, expiresAt: time });
const unknown = object({ ...semantics, state: choice('unknown'), operationKey: key, retryable: no,
  preparationId: uuid, nextAction: choice('read_preparation', 'read_operation') }, ['executionPermission', 'businessActionRequested', 'state', 'operationKey', 'retryable']);
const absent = object({ ...semantics, state: choice('not_observed'), operationKey: key, retryable: no });
export const AI_AUTOMATION_POLICY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiAutomationPolicyReadRequestDraft: object({ subjectId: shortId, policyId: shortId }),
  AiAutomationPolicyChangeDraft: command,
  AiAutomationPolicyOperationReadRequestDraft: object({ operationKey: key }),
  AiAutomationPolicyPreparationReadRequestDraft: object({ preparationId: uuid }),
  AiAutomationPolicyCommitRequestDraft: object({ preparationId: uuid, changeHash: hash, confirm: choice('apply_automation_policy_change') }),
  AiAutomationPolicyCurrentDraft: object({ ...semantics, state: choice('configured'), ...configuration }),
  AiAutomationPolicySourceDraft: object({
    subject: nullable(object({ ...provenance, id: shortId, revision, settings: subject })),
    policy: nullable(object({ ...provenance, id: shortId, subjectId: shortId, revision, settings: policy })),
    scene: object({ scopeId: shortId, sceneCode: sceneId, sceneVersion: sceneId, revision, enabled: bool,
      tools: list(object({ code: id(), version: id() }), 1000), limits: object({ maxSteps: integer(1, 1000), maxCalls: integer(1, 1000),
        maxConcurrent: { type: 'integer', const: 1 }, maxTotalMs: integer(1, 86400000), maxStepMs: integer(1, 86400000),
        maxOutputBytes: integer(1, 16777216) }), expiresAt: time }) }),
  AiAutomationPolicyPreviewDraft: object({ ...semantics, command, before: ref('AiAutomationPolicySourceDraft'), changeHash: hash, sourceHash: hash, prepareResourceHash: hash }),
  AiAutomationPolicyReviewDraft: { oneOf: [prepared, recorded] },
  AiAutomationPolicyPreparationDraft: { oneOf: [prepared, recorded, unknown] },
  AiAutomationPolicyPreparationReadDraft: { oneOf: [prepared, recorded, absent] },
  AiAutomationPolicyCommitResultDraft: { oneOf: [recorded, unknown] },
  AiAutomationPolicyOperationDraft: { oneOf: [recorded, unknown, absent] }
};
