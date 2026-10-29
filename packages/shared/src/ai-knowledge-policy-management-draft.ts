import { leafClosed as obj, leafEnum as choice, leafInt as int, leafList as list,
  leafText as text, leafTime as time, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION = 'knowledge-policy-management-1' as const;
export type AiKnowledgePreparationTargetSpecDraft = {
  version: 'knowledge-prepared-target-1';
  operationKey: string;
  upload: { documentId: string; fileName: string; mimeType: 'text/plain' | 'text/markdown'; sizeBytes: number };
  document: { documentVersion: string; operationId: string; title: string; validFrom: string; validUntil?: string };
  expiresAt: string;
};
export type AiKnowledgeTargetSelectionDraft = { authorityId: string };
export type AiKnowledgeTargetReadDraft = { authorityId: string; operationKey: string; specHash?: string };
export type AiKnowledgeTargetBindDraft = { authorityId: string; operationKey: string; sessionId: string; expectedRevision: 1; confirm: 'bind_knowledge_upload' };

export type AiKnowledgeTargetResponseDraft =
  | { state: 'not_observed'; operationKey: string; retryable: false }
  | { state: 'unknown'; operationKey: string; specHash: string; retryable: false; nextAction: 'read_target' }
  | ({ targetId: string; operationKey: string; specHash: string; specification: AiKnowledgePreparationTargetSpecDraft;
      expiresAt: string; executionPermission: false } & (
      { state: 'prepared'; revision: 1; attachmentId: null; uploadSessionId: null }
      | { state: 'bound'; revision: 2; attachmentId: string; uploadSessionId: string }));
type KnowledgePolicyMemoryOwner = { actorKind: 'user'; actorId: string };
export type AiKnowledgePolicyResourceDraft = Record<string, never> | { attachmentId: string }
  | { documentId: string; documentVersion: string; attachmentId: string; aclRevision: number }
  | { owner: KnowledgePolicyMemoryOwner }
  | { owner: KnowledgePolicyMemoryOwner; memoryId: string; revision: number; aclRevision: number }
  | { upload: { documentId: string; idempotencyKey: string; fileName: string; mimeType: 'text/plain' | 'text/markdown'; sizeBytes: number;
      revision?: { documentVersion: string; expectedRevision: number; aclRevision: number; targetVersion: string } } };
export type AiKnowledgePolicyCurrentResponseDraft = {
  authorityId: string; policyKeyHash: string; executionPermission: false;
  target: { tenantId: string; workspaceId: string; actorKind: 'user'; actorId: string; audience: 'operator' | 'staff';
    domain: 'knowledge' | 'memory'; action: string; resourceKey: string };
  resource: AiKnowledgePolicyResourceDraft;
} & ({ state: 'configured'; result: AiKnowledgePolicySnapshotDraft } | { state: 'not_configured'; result: null });

export type AiKnowledgePolicyManagementAction = 'create_disabled' | 'update_disabled' | 'enable' | 'disable';
export type AiKnowledgePolicyChangeDraft = {
  version: typeof AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION;
  authorityId: string;
  operationKey: string;
  expectedRevision: number;
  action: AiKnowledgePolicyManagementAction;
  requiredPermissions: string[];
  expiresAt: string;
};
export type AiKnowledgePolicyCommitDraft = {
  preparationId: string;
  changeHash: string;
  confirm: 'apply_knowledge_policy_change';
};
export type AiKnowledgePolicyPreparationSelectionDraft = { operationKey: string; changeHash?: string };
export type AiKnowledgePolicyReceiptSelectionDraft = { operationKey: string; changeHash: string };
export type AiKnowledgePolicySnapshotDraft = {
  revision: number;
  enabled: boolean;
  requiredPermissions: string[];
  expiresAt: string;
};
export type AiKnowledgePolicyManagementReceiptDraft = {
  state: 'observed';
  operationKey: string;
  preparationId: string;
  changeHash: string;
  policyKeyHash: string;
  result: AiKnowledgePolicySnapshotDraft;
  recordedAt: string;
  retryable: false;
  executionPermission: false;
};
export type AiKnowledgePolicyManagementUnknownDraft = {
  state: 'unknown' | 'not_observed';
  operationKey: string;
  changeHash?: string;
  retryable: false;
  nextAction: 'read_preparation' | 'read_operation';
  executionPermission: false;
};

export type AiKnowledgeLifecycleHeadDraft = {
  documentId: string; revision: number; documentVersion: string; attachmentId: string; aclRevision: number;
};
export type AiKnowledgeLifecycleTargetDraft = {
  version: 'knowledge-successor-target-1'; action: 'revise'; operationId: string;
  from: AiKnowledgeLifecycleHeadDraft;
  to: { documentVersion: string; attachmentId: string; uploadSessionId: string; title: string; validFrom: string; validUntil?: string };
  expiresAt: string;
} | {
  version: 'knowledge-deletion-target-1'; action: 'delete'; operationId: string; receiptOperationId: string;
  from: AiKnowledgeLifecycleHeadDraft; expiresAt: string;
};
export type AiKnowledgePolicyHttpLifecycleDraft = {
  state: 'current'; target: AiKnowledgeLifecycleTargetDraft; semantics: 'target_review_not_execution_permission';
} | {
  state: 'unavailable' | 'not_applicable'; semantics: 'target_review_not_execution_permission';
};
export type AiKnowledgePolicyHttpPreparationDraft = {
  state: 'prepared' | 'expired' | 'stale'; preparationId: string; operationKey: string; changeHash: string; policyKeyHash: string;
  before: AiKnowledgePolicySnapshotDraft | null; proposal: AiKnowledgePolicyChangeDraft; expiresAt: string;
  lifecycle: AiKnowledgePolicyHttpLifecycleDraft; executionPermission: false;
};
export type AiKnowledgePolicyHttpReceiptDraft = AiKnowledgePolicyManagementReceiptDraft & {
  lifecycle: AiKnowledgePolicyHttpLifecycleDraft;
};
export type AiKnowledgePolicyHttpResultDraft = AiKnowledgePolicyHttpPreparationDraft | AiKnowledgePolicyHttpReceiptDraft | AiKnowledgePolicyManagementUnknownDraft;
export type AiKnowledgePolicyHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_REVISION_CONFLICT' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN'; retryable: false;
  nextAction?: 'read_original_policy_operation' | 'read_original_policy_preparation' | 'read_original_policy_target';
};

const id: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9_-]+$' };
const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const hash: AiLeafSchemaDraft = { ...text(64, 64), pattern: '^[a-f0-9]{64}$' };
const revision = int(1, 4294967294), no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const permissions: AiLeafSchemaDraft = { ...list({ ...text(191), pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$' }, 64, 1), uniqueItems: true };
const snapshot = obj({ revision, enabled: { type: 'boolean' }, requiredPermissions: permissions, expiresAt: time });
const change = obj({ version: choice(AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION), authorityId: uuid, operationKey: id,
  expectedRevision: int(0, 4294967293), action: choice('create_disabled', 'update_disabled', 'enable', 'disable'),
  requiredPermissions: permissions, expiresAt: time });
const head = obj({ documentId: id, revision: int(1, 4294967293), documentVersion: id, attachmentId: id, aclRevision: revision });
const target: AiLeafSchemaDraft = { oneOf: [
  obj({ version: choice('knowledge-successor-target-1'), action: choice('revise'), operationId: id, from: head,
    to: obj({ documentVersion: id, attachmentId: id, uploadSessionId: id, title: text(256), validFrom: time, validUntil: time },
      ['documentVersion', 'attachmentId', 'uploadSessionId', 'title', 'validFrom']), expiresAt: time }),
  obj({ version: choice('knowledge-deletion-target-1'), action: choice('delete'), operationId: id, receiptOperationId: id, from: head, expiresAt: time }),
] };
const semantics = choice('target_review_not_execution_permission');
const lifecycle: AiLeafSchemaDraft = { oneOf: [obj({ state: choice('current'), target, semantics }),
  obj({ state: choice('unavailable', 'not_applicable'), semantics })] };
const unavailableLifecycle = obj({ state: choice('unavailable'), semantics });
const preparationFields = { preparationId: uuid, operationKey: id, changeHash: hash, policyKeyHash: hash,
  before: { oneOf: [snapshot, { type: 'null' }] }, proposal: change, expiresAt: time, executionPermission: no };
const preparation: AiLeafSchemaDraft = { oneOf: [
  obj({ state: choice('prepared'), ...preparationFields, lifecycle }),
  obj({ state: choice('expired', 'stale'), ...preparationFields, lifecycle: unavailableLifecycle }),
] };
const receipt = obj({ state: choice('observed'), operationKey: id, preparationId: uuid, changeHash: hash, policyKeyHash: hash,
  result: snapshot, recordedAt: time, retryable: no, executionPermission: no, lifecycle });
const unknown = obj({ state: choice('unknown', 'not_observed'), operationKey: id, changeHash: hash, retryable: no,
  nextAction: choice('read_preparation', 'read_operation'), executionPermission: no },
  ['state', 'operationKey', 'retryable', 'nextAction', 'executionPermission']);
const actor = obj({ actorKind: choice('user'), actorId: id });
const upload = { documentId: id, idempotencyKey: text(128), fileName: text(180), mimeType: choice('text/plain', 'text/markdown'),
  sizeBytes: int(1, 262144), revision: obj({ documentVersion: id, expectedRevision: int(1), aclRevision: int(1), targetVersion: id }) };
const document = obj({ documentId: id, documentVersion: id, attachmentId: id, aclRevision: revision });
const resource: AiLeafSchemaDraft = { oneOf: [obj({}), obj({ attachmentId: id }), document, obj({ owner: actor }),
  obj({ owner: actor, memoryId: id, revision, aclRevision: revision }),
  obj({ upload: obj(upload, ['documentId', 'idempotencyKey', 'fileName', 'mimeType', 'sizeBytes']) })] };
const targetFields = { targetId: uuid, operationKey: id, specHash: hash,
  specification: ref('AiKnowledgePreparationTargetSpecDraft'), expiresAt: time, executionPermission: no };
const targetResponse: AiLeafSchemaDraft = { oneOf: [
  obj({ state: choice('not_observed'), operationKey: id, retryable: no }),
  obj({ state: choice('unknown'), operationKey: id, specHash: hash, retryable: no, nextAction: choice('read_target') }),
  obj({ state: choice('prepared'), ...targetFields, revision: { type: 'integer', const: 1 }, attachmentId: { type: 'null' }, uploadSessionId: { type: 'null' } }),
  obj({ state: choice('bound'), ...targetFields, revision: { type: 'integer', const: 2 }, attachmentId: id, uploadSessionId: text(128) })
] };
const policyTargetBase = { tenantId: { ...text(128), pattern: '^[A-Za-z0-9._:-]+$' }, workspaceId: { ...text(128), pattern: '^[A-Za-z0-9._:-]+$' },
  actorKind: choice('user'), actorId: { ...text(128), pattern: '^[A-Za-z0-9._:-]+$' }, audience: choice('operator', 'staff'), resourceKey: hash };
const policyTarget: AiLeafSchemaDraft = { oneOf: [obj({ ...policyTargetBase, domain: choice('knowledge'),
  action: choice('upload', 'create', 'read_metadata', 'parse', 'publish', 'withdraw', 'delete', 'revise', 'search', 'read_body', 'snippet', 'resolve_source', 'download', 'index', 'change_acl') }),
  obj({ ...policyTargetBase, domain: choice('memory'), action: choice('read', 'propose', 'modify', 'confirm', 'delete') })] };
const currentFields = { authorityId: uuid, policyKeyHash: hash, target: policyTarget, resource, executionPermission: no };
export const AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS = {
  prepareTarget: { request: 'AiKnowledgeTargetSelectionDraft', response: 'AiKnowledgeTargetResponseDraft', write: true },
  target: { request: 'AiKnowledgeTargetReadDraft', response: 'AiKnowledgeTargetResponseDraft', write: false },
  bindTarget: { request: 'AiKnowledgeTargetBindDraft', response: 'AiKnowledgeTargetResponseDraft', write: true },
  read: { request: 'AiKnowledgeTargetSelectionDraft', response: 'AiKnowledgePolicyCurrentResponseDraft', write: false }
} as const;
export const AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiKnowledgeTargetResponseDraft: targetResponse,
  AiKnowledgePolicyCurrentResponseDraft: { oneOf: [obj({ state: choice('configured'), ...currentFields, result: snapshot }),
    obj({ state: choice('not_configured'), ...currentFields, result: { type: 'null' } })] },
  // Existing request leaves remain owned by AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.
  AiKnowledgeLifecycleTargetDraft: target,
  AiKnowledgePolicyHttpLifecycleDraft: lifecycle,
  AiKnowledgePolicyHttpPreparationDraft: preparation,
  AiKnowledgePolicyHttpReceiptDraft: receipt,
  AiKnowledgePolicyPrepareHttpResponseDraft: { oneOf: [preparation, receipt, unknown] },
  AiKnowledgePolicyReviewHttpResponseDraft: { oneOf: [preparation, receipt, unknown] },
  AiKnowledgePolicyCommitHttpResponseDraft: { oneOf: [receipt, unknown] },
  AiKnowledgePolicyOperationHttpResponseDraft: { oneOf: [receipt, unknown] },
  AiKnowledgePolicyHttpErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'),
    retryable: no, nextAction: choice('read_original_policy_operation', 'read_original_policy_preparation', 'read_original_policy_target') }, ['code', 'retryable']),
};
