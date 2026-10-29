/** Original owner-managed task/scene policy transport. Schema validity grants no
 * action, model call or business approval. Permissions/tools remain server-owned;
 * these contracts preserve the existing CAS and current-row recovery semantics. */
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiClientModelPlanLimitsDraft } from './ai-client-policy-http-draft';
import { AI_CLIENT_POLICY_HTTP_SCHEMAS } from './ai-client-policy-http-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafRef as ref, leafTime as time, leafList as list, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_ORIGINAL_TASK_POLICY_OPERATIONS = Object.freeze([
  'read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run',
  'transition_task', 'read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input', 'decide_approval',
] as const);
export type AiOriginalTaskPolicyOperationDraft = typeof AI_ORIGINAL_TASK_POLICY_OPERATIONS[number];
export interface AiOriginalTaskPolicyReadDraft { original: AiSceneRequestReadDraft; operation: AiOriginalTaskPolicyOperationDraft }
export interface AiOriginalTaskPolicyConfigureDraft extends AiOriginalTaskPolicyReadDraft { expectedRevision: number | null }
export interface AiOriginalTaskPolicyClearDraft extends AiOriginalTaskPolicyReadDraft { expectedRevision: number }
export interface AiOriginalTaskPolicySnapshotDraft {
  taskId: string; operation: AiOriginalTaskPolicyOperationDraft; revision: number; requiredPermissions: string[]; expiresAt: string;
}
export type AiOriginalTaskPolicyReadResponseDraft = { original: AiSceneRequestReadDraft; retryable: false;
  semantics: 'action_policy_not_dispatch_or_business_approval' } & (
  | { state: 'observed'; policy: AiOriginalTaskPolicySnapshotDraft }
  | { state: 'not_observed'; policy: null }
);
export interface AiOriginalTaskPolicyConfigureResponseDraft { original: AiSceneRequestReadDraft; state: 'configured';
  policy: AiOriginalTaskPolicySnapshotDraft; retryable: false; semantics: 'action_policy_not_dispatch_or_business_approval' }
export interface AiOriginalTaskPolicyClearResponseDraft { original: AiSceneRequestReadDraft; state: 'revoked';
  policy: AiOriginalTaskPolicySnapshotDraft; retryable: false; semantics: 'new_task_actions_denied_not_remote_rollback' }
export interface AiOriginalScenePlanReadDraft { sceneCode: 'order_explanation' }
export interface AiOriginalScenePlanChangeDraft extends AiOriginalScenePlanReadDraft {
  change: { expectedRevision: number | null; enabled: boolean; limits: AiClientModelPlanLimitsDraft; expiresAt: string };
}
export interface AiOriginalScenePlanChangeResponseDraft { sceneCode: 'order_explanation'; revision: number; enabled: boolean;
  limits: AiClientModelPlanLimitsDraft; expiresAt: string; execution: 'not_attested'; taskActionPolicy: 'not_granted' }
/** A current plan read is not an exact historical mutation receipt or a new-call grant. */
export type AiOriginalScenePlanReadResponseDraft = { state: 'configured' } & AiOriginalScenePlanChangeResponseDraft
  | { sceneCode: 'order_explanation'; state: 'not_configured'; execution: 'not_attested'; taskActionPolicy: 'not_granted' };
export interface AiOriginalPolicyHttpRequestsDraft {
  taskRead: AiOriginalTaskPolicyReadDraft; taskConfigure: AiOriginalTaskPolicyConfigureDraft; taskClear: AiOriginalTaskPolicyClearDraft;
  planRead: AiOriginalScenePlanReadDraft; planChange: AiOriginalScenePlanChangeDraft;
}
export interface AiOriginalPolicyHttpResponsesDraft {
  taskRead: AiOriginalTaskPolicyReadResponseDraft; taskConfigure: AiOriginalTaskPolicyConfigureResponseDraft; taskClear: AiOriginalTaskPolicyClearResponseDraft;
  planRead: AiOriginalScenePlanReadResponseDraft; planChange: AiOriginalScenePlanChangeResponseDraft;
}
export const AI_ORIGINAL_POLICY_HTTP_CONTRACTS = Object.freeze({
  taskRead: { request: 'AiOriginalTaskPolicyReadDraft', response: 'AiOriginalTaskPolicyReadResponseDraft', write: false },
  taskConfigure: { request: 'AiOriginalTaskPolicyConfigureDraft', response: 'AiOriginalTaskPolicyConfigureResponseDraft', write: true },
  taskClear: { request: 'AiOriginalTaskPolicyClearDraft', response: 'AiOriginalTaskPolicyClearResponseDraft', write: true },
  planRead: { request: 'AiOriginalScenePlanReadDraft', response: 'AiOriginalScenePlanReadResponseDraft', write: false },
  planChange: { request: 'AiOriginalScenePlanChangeDraft', response: 'AiOriginalScenePlanChangeResponseDraft', write: true },
} as const);
const revision = integer(1, 4294967294), nil: AiLeafSchemaDraft = { type: 'null' };
const operation = choice(...AI_ORIGINAL_TASK_POLICY_OPERATIONS), original = ref('AiSceneRequestReadDraft');
const taskRead = { original, operation }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const semantics = choice('action_policy_not_dispatch_or_business_approval');
const policy = ref('AiOriginalTaskPolicySnapshotDraft'), sceneCode = choice('order_explanation');
// Shared runner limits retain the original bounds and one-concurrent-run rule.
const limits = AI_CLIENT_POLICY_HTTP_SCHEMAS.AiClientModelPlanChangeDraft.properties!.limits;
const plan = { sceneCode, revision, enabled: { type: 'boolean' } as AiLeafSchemaDraft, limits, expiresAt: time,
  execution: choice('not_attested'), taskActionPolicy: choice('not_granted') };
export const AI_ORIGINAL_POLICY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOriginalTaskPolicyReadDraft: object(taskRead),
  AiOriginalTaskPolicyConfigureDraft: object({ ...taskRead, expectedRevision: { oneOf: [revision, nil] } }),
  AiOriginalTaskPolicyClearDraft: object({ ...taskRead, expectedRevision: integer(1, 4294967293) }),
  AiOriginalTaskPolicySnapshotDraft: object({ taskId: id(), operation, revision,
    requiredPermissions: { ...list(id(), 64, 1), uniqueItems: true }, expiresAt: time }),
  AiOriginalTaskPolicyReadResponseDraft: { oneOf: [object({ original, state: choice('observed'), policy, retryable: no, semantics }),
    object({ original, state: choice('not_observed'), policy: nil, retryable: no, semantics })] },
  AiOriginalTaskPolicyConfigureResponseDraft: object({ original, state: choice('configured'), policy, retryable: no, semantics }),
  AiOriginalTaskPolicyClearResponseDraft: object({ original, state: choice('revoked'), policy, retryable: no,
    semantics: choice('new_task_actions_denied_not_remote_rollback') }),
  AiOriginalScenePlanReadDraft: object({ sceneCode }),
  AiOriginalScenePlanChangeDraft: object({ sceneCode, change: object({ expectedRevision: { oneOf: [integer(1, 4294967293), nil] },
    enabled: plan.enabled, limits, expiresAt: time }) }),
  AiOriginalScenePlanReadResponseDraft: { oneOf: [object({ state: choice('configured'), ...plan }),
    object({ sceneCode, state: choice('not_configured'), execution: plan.execution, taskActionPolicy: plan.taskActionPolicy })] },
  AiOriginalScenePlanChangeResponseDraft: object(plan),
};
