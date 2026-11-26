/** Original result locators are transport-neutral. They carry no requester, scope or authority. */
import { leafClosed, leafEnum, leafId, leafInt, leafList } from './ai-leaf-schema';
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, type AiTaskStatusDraft, type AiStepStatusDraft } from './ai-task';

export const AI_CONVERSATION_DRAFT_VERSION = 'ain-conversation-draft-2' as const;
export const AI_SCENE_REQUEST_DRAFT_VERSION = 'ain-scene-request-draft-1' as const;

export interface AiConversationReferenceDraft { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION; conversationId: string }
export interface AiConversationTurnReferenceDraft extends AiConversationReferenceDraft { admissionKey: string }
export interface AiConversationModelResultReadDraft extends AiConversationTurnReferenceDraft { resultId: string }
export interface AiSceneRequestReadDraft { draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION; inputRef: string }
export type AiSceneTaskReceiptDraft =
  | { state: 'not_observed'; retryable: false }
  | { state: 'observed'; taskId: string; runId: string; status: AiTaskStatusDraft; revision: number;
      plan: 'stored' | 'not_observed'; resultAvailable: boolean; execution: 'not_inferred_from_metadata' };
export interface AiSceneRecoveryStepDraft {
  stepId: string; runId: string; actionId: string; revision: number;
  status: AiStepStatusDraft; effect: 'none' | 'possible' | 'committed'; resultAvailable: boolean;
  nextAction: 'reconcile_original_action' | 'read_authorized_result' | 'runner_owned';
}
export type AiSceneRequestRecoveryDraft =
  | { task: Extract<AiSceneTaskReceiptDraft, { state: 'not_observed' }>; nextAction: 'reconcile_request_or_explicit_create_task'; automaticExecution: false }
  | { task: Extract<AiSceneTaskReceiptDraft, { state: 'observed' }>; steps: AiSceneRecoveryStepDraft[]; hasMore: boolean; automaticExecution: false;
      nextAction: 'host_plan_handoff' | 'existing_runner_recovery'; observedResults: 'preserved_even_if_task_cancelled'; snapshot: 'bounded_sequential_read' };

const conversation = { draftVersion: leafEnum(AI_CONVERSATION_DRAFT_VERSION), conversationId: leafId(),
  admissionKey: { ...leafId(), maxLength: 128 } };
export const AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS = Object.freeze({
  AiConversationTurnReferenceDraft: leafClosed(conversation),
  AiConversationModelResultReadDraft: leafClosed({ ...conversation, resultId: leafId() }),
  AiSceneRequestReadDraft: leafClosed({ draftVersion: leafEnum(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' } })
});

const uuid = { type: 'string', format: 'uuid' }, bool = { type: 'boolean' }, no = { ...bool, const: false };
const noTask = leafClosed({ state: leafEnum('not_observed'), retryable: no });
const observedTask = leafClosed({ state: leafEnum('observed'), taskId: uuid, runId: uuid, status: leafEnum(...AI_TASK_STATUSES_DRAFT),
  revision: leafInt(1, 4294967294), plan: leafEnum('stored', 'not_observed'), resultAvailable: bool, execution: leafEnum('not_inferred_from_metadata') });
const recoveryStep = leafClosed({ stepId: leafId(), runId: leafId(), actionId: leafId(), revision: leafInt(1, 4294967294), status: leafEnum(...AI_STEP_STATUSES_DRAFT),
  effect: leafEnum('none', 'possible', 'committed'), resultAvailable: bool, nextAction: leafEnum('reconcile_original_action', 'read_authorized_result', 'runner_owned') });
export const AI_ORIGINAL_TASK_RECOVERY_SCHEMAS = Object.freeze({
  AiSceneTaskReceiptDraft: { oneOf: [noTask, observedTask] },
  AiSceneRequestRecoveryDraft: { oneOf: [leafClosed({ task: noTask, nextAction: leafEnum('reconcile_request_or_explicit_create_task'), automaticExecution: no }),
    leafClosed({ task: observedTask, steps: leafList(recoveryStep, 50), hasMore: bool, automaticExecution: no,
      nextAction: leafEnum('host_plan_handoff', 'existing_runner_recovery'), observedResults: leafEnum('preserved_even_if_task_cancelled'),
      snapshot: leafEnum('bounded_sequential_read') })] }
});
