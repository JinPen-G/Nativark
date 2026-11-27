/** Public work-center HTTP contract. The only built-in zero-Core scene is the
 * registered text verification challenge. Result fields also serve MCP reads. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS } from './ai-original-result';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from './ai-task';
import { AI_USAGE_DRAFT_SCHEMAS } from './ai-usage';
import { leafClosed as obj, leafEnum as choice, leafId as id, leafInt as int, leafList as list,
  leafRef as ref, leafTime as time, type AiLeafSchemaDraft } from './ai-leaf-schema';

export const AI_PUBLIC_TEXT_SCENE = 'ai.capability.text' as const;
export const AI_PUBLIC_WORK_CENTER_PERMISSION = 'system:params:manage' as const;
export const AI_PUBLIC_WORK_CENTER_OPERATIONS = Object.freeze({
  create: ['conversations', 'create', 'AiPublicConversationCreate', 'AiPublicConversationOperation', true],
  list: ['conversations', 'list', 'AiPublicConversationList', 'AiPublicConversationPage', false],
  read: ['conversations', 'read', 'AiPublicConversationRef', 'AiPublicConversationRead', false],
  archive: ['conversations', 'archive', 'AiPublicConversationMutation', 'AiPublicConversationOperation', true],
  delete: ['conversations', 'delete', 'AiPublicConversationMutation', 'AiPublicConversationOperation', true],
  operation: ['conversations', 'operation', 'AiPublicConversationOperationRef', 'AiPublicConversationOperation', false],
  admit: ['conversations', 'admit', 'AiPublicConversationAdmit', 'AiPublicConversationAdmission', true],
  admission: ['conversations', 'admission', 'AiConversationTurnReferenceDraft', 'AiPublicConversationAdmission', false],
  turns: ['conversations', 'turns', 'AiPublicConversationTurns', 'AiPublicConversationTurnPage', false],
  release: ['conversations', 'release', 'AiPublicConversationMutation', 'AiPublicConversationOperation', true],
  conversationResult: ['conversations', 'modelResult', 'AiConversationModelResultReadDraft', 'AiPublicConversationResult', false],
  createTask: ['task-center', 'create', 'AiConversationTurnReferenceDraft', 'AiPublicTaskCreation', true],
  taskCreation: ['task-center', 'creation', 'AiConversationTurnReferenceDraft', 'AiPublicTaskCreation', false],
  snapshot: ['task-center', 'snapshot', 'AiPublicTaskRef', 'AiPublicTaskSnapshot', false],
  start: ['task-center', 'start', 'AiPublicTaskStart', 'AiPublicTaskExecution', true],
  reconcile: ['task-center', 'reconcile', 'AiPublicTaskStart', 'AiPublicTaskExecution', true],
  result: ['task-center', 'result', 'AiPublicTaskResultRef', 'AiPublicTaskResult', false],
  policy: ['task-center', 'textPolicy', 'AiPublicTextPolicyRead', 'AiPublicTextPolicy', false],
  savePolicy: ['task-center', 'saveTextPolicy', 'AiPublicTextPolicySave', 'AiPublicTextPolicyOperation', true],
  policyOperation: ['task-center', 'textPolicyOperation', 'AiPublicTextPolicyOperationRef', 'AiPublicTextPolicyOperation', false],
  allowText: ['task-center', 'allowTextProbe', 'AiPublicTextAllowanceSave', 'AiTenantModelSettingsSummaryDraft', true],
} as const);
export type AiPublicWorkCenterOperation = keyof typeof AI_PUBLIC_WORK_CENTER_OPERATIONS;
export function publicWorkCenterPath(operation: AiPublicWorkCenterOperation) {
  const [group, method] = AI_PUBLIC_WORK_CENTER_OPERATIONS[operation];
  return `/ai-native/${group}/${method}`;
}

const key = { ...id(), maxLength: 128 }, nil = { type: 'null' }, no = { type: 'boolean', const: false };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' }, decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const revision = int(1, 4294967294), observedRevision = int(1, 4294967295), bool = { type: 'boolean' };
const scope = { draftVersion: choice(AI_CONVERSATION_DRAFT_VERSION) }, scene = choice(AI_PUBLIC_TEXT_SCENE);
const status = choice('active', 'archived'), meta = { conversationId: id(), capabilityCode: scene, revision: observedRevision, status, createdAt: time, updatedAt: time };
const conversation = { ...scope, conversationId: id() }, kind = choice(...AI_TASK_STATUSES_DRAFT);
const task = obj({ taskId: id(), runId: id(), status: kind, revision: observedRevision });
const optional = (value: AiLeafSchemaDraft) => ({ oneOf: [value, nil] });
const taskSnapshot = { contractVersion: choice(AI_TASK_DRAFT_VERSION), taskId: id(), runId: id(), status: kind, revision: observedRevision,
  resultId: optional(id()), runStatus: kind, execution: choice('observed_original_task') };
const handoff = obj({ status: choice('unavailable'), nextAction: choice('manual_handoff'), completedSteps: int(), cleanupFailed: int(),
  stopReason: choice('input_limit_reached'), runTimeAccounting: choice('pending_original_time', 'not_observed') },
  ['status', 'nextAction', 'completedSteps', 'cleanupFailed', 'runTimeAccounting']);
const runtimeLimits = obj({ maxSteps: int(1, 1000), maxCalls: int(1, 1000), maxConcurrent: int(1, 1),
  maxTotalMs: int(1, 86400000), maxStepMs: int(1, 86400000), maxOutputBytes: int(1, 16777216) });
const policy = obj({ revision: observedRevision, enabled: bool, expiresAt: time, limits: runtimeLimits });
const turn = obj({ admissionKey: key, turnId: id(), originalRequestKey: key, requestHash: hash, capabilityCode: scene, capabilityVersion: id(),
  createdAt: time, automaticRetry: no, status: choice('original_bound'), original: ref('AiSceneRequestReadDraft'),
  material: choice('retained'), creation: choice('available_for_review', 'permanently_closed'),
  task: optional(obj({ taskId: id(), runId: id() })), execution: choice('not_inferred_from_association') });
export const AI_PUBLIC_WORK_CENTER_SCHEMAS: Readonly<Record<string, AiLeafSchemaDraft>> = Object.freeze({
  ...AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS,
  AiTenantModelSettingsSummaryDraft: AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsSummaryDraft,
  AiPublicConversationCreate: obj({ ...scope, operationKey: key, capabilityCode: scene }),
  AiPublicConversationRef: obj(conversation),
  AiPublicConversationList: obj({ ...scope, status, limit: int(1, 20), beforeId: id(), capabilityCode: scene }, ['draftVersion', 'status', 'limit']),
  AiPublicConversationPage: obj({ ...scope, items: list(obj(meta), 20), nextBeforeId: optional(id()), coverage: choice('page_not_total') }),
  AiPublicConversationMutation: obj({ ...conversation, operationKey: key, expectedRevision: revision }),
  AiPublicConversationOperationRef: obj({ ...scope, operationKey: key }),
  AiPublicConversationOperation: { oneOf: [obj({ ...scope, operationKey: key, retryable: no, status: choice('observed'),
    conversationId: id(), revision: observedRevision, operation: choice('create', 'archive', 'delete', 'release_turn'),
    taskCancellation: choice('not_requested'), businessRecords: choice('not_modified') }),
  obj({ ...scope, operationKey: key, retryable: no, status: choice('not_observed'), nextAction: choice('read_original_operation'),
    absence: choice('not_proof_of_no_commit') })] },
  AiPublicConversationRead: obj({ ...scope, ...meta, currentTurn: optional(ref('AiPublicConversationTurn')),
    taskCancellation: choice('separate_original_operation'), businessRecords: choice('not_modified') }),
  AiPublicConversationAdmit: obj({ ...conversation, expectedRevision: revision, admissionKey: key,
    request: obj({ sceneCode: scene, input: obj({ capability: choice('text') }) }) }),
  AiPublicConversationTurn: turn,
  AiPublicConversationAdmission: obj({ ...conversation, admissionKey: key, result: optional(ref('AiPublicConversationTurn')),
    absence: choice('not_proof_of_no_commit'), retryable: no }),
  AiPublicConversationTurns: obj({ ...conversation, limit: int(1, 20), beforeId: id() }, ['draftVersion', 'conversationId', 'limit']),
  AiPublicConversationTurnPage: obj({ ...conversation, items: list(ref('AiPublicConversationTurn'), 20), nextBeforeId: optional(id()),
    coverage: choice('page_not_total'), execution: choice('not_started_by_read') }),
  AiPublicTaskCreation: obj({ creationKey: key, state: choice('observed', 'not_observed', 'unknown'), task: optional(task), retryable: no,
    nextAction: choice('read_original_task', 'reconcile') }),
  AiPublicTaskRef: obj({ taskId: id(), runId: id() }),
  AiPublicTaskStart: obj({ taskId: id(), runId: id(), expectedRevision: revision }),
  AiPublicTaskSnapshot: obj(taskSnapshot),
  AiPublicTaskExecution: { oneOf: [ref('AiPublicTaskSnapshot'), obj({ ...taskSnapshot, runner: handoff })] },
  AiPublicTaskResultRef: obj({ taskId: id(), resultId: id() }),
  AiPublicTaskResult: obj({ contractVersion: choice(AI_TASK_DRAFT_VERSION), taskId: id(), runId: id(), resultId: id(),
    status: choice('available', 'failed', 'unknown'), diagnostic: optional(obj({ capability: choice('text'),
      check: choice('verified', 'mismatch', 'unverified') })),
    contentHash: hash, activeMs: decimal, outputBytes: decimal, observedAt: time, execution: choice('read_only_no_start_no_reconnect_side_effect'),
    businessExecution: choice('not_inferred_from_model_result') }),
  AiPublicConversationResult: obj({ ...conversation, admissionKey: key, result: optional(ref('AiPublicTaskResult')),
    status: choice('observed', 'not_observed'), execution: choice('read_only_no_start_no_dispatch') }),
  AiPublicTextPolicyRead: obj({}),
  AiPublicTextPolicySave: obj({ operationKey: key, expectedRevision: optional(revision), enabled: bool, expiresAt: time, limits: runtimeLimits }),
  AiPublicTextPolicyOperationRef: obj({ operationKey: key }),
  AiPublicTextPolicy: obj({ policy: optional(policy), execution: choice('not_granted') }),
  AiPublicTextPolicyOperation: { oneOf: [obj({ operationKey: key, status: choice('observed'), policy, retryable: no }),
    obj({ operationKey: key, status: choice('not_observed'), policy: nil, retryable: no, absence: choice('not_proof_of_no_commit') })] },
  AiPublicTextAllowanceSave: obj({ operationKey: key, expectedRevision: revision, allowText: bool })
});

/** Same named result components as the public API; locator-only and read-only
 * for MCP. A tool still needs the current host credentials and source policy. */
export const AI_PUBLIC_WORK_CENTER_ORIGINAL_READS = Object.freeze({
  task: AI_PUBLIC_WORK_CENTER_OPERATIONS.snapshot,
  taskResult: AI_PUBLIC_WORK_CENTER_OPERATIONS.result,
  conversation: AI_PUBLIC_WORK_CENTER_OPERATIONS.read,
  conversationResult: AI_PUBLIC_WORK_CENTER_OPERATIONS.conversationResult
});

export function publicTextOriginalReference(inputRef: string) { return { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef }; }
