/** Read-only aggregation of existing task, model, approval and Core readers.
 * Independent observations are not an atomic business snapshot; an approved
 * decision, timeline or task status does not attest a business submission. */
import type { AiSceneRequestReadDraft, AiSceneRequestReceiptDraft, AiSceneRequestBody,
  AiSceneTaskReceiptDraft, AiSceneRequestRecoveryDraft } from './ai-scene-request-draft';
import type { AiWorkspaceScope } from './ai-native';
import type { AiTaskSnapshotDraft } from './ai-task-draft';
import type { AiTaskRecoverySnapshot, AiSceneModelPendingInputDraft } from './ai-task-recovery-draft';
import type { AiSceneModelResultObservationDraft } from './ai-scene-model-observation-draft';
import type { AiOrderReadFactsDraft } from './ai-order-facts-draft';
import type { AiApprovalApplicationReviewDraft, AiApprovalApplicationReceiptDraft } from './ai-approval-application-draft';
import type { AiSelectedQuoteTaskResultDraft, AiHumanQuoteOrderReviewRequestDraft,
  AiHumanQuoteOrderDecisionRequestDraft, AiSelectedQuoteTaskRequestDraft } from './ai-quote-selection-draft';
import type { AiApprovedSettingsPrepareDraft, AiApprovedSettingsCurrentDraft, AiApprovedSettingsChangeReviewDraft,
  AiApprovedSettingsPreparationReceiptDraft, AiApprovedSettingsReviewDraft, AiApprovedSettingsDecisionReceiptDraft,
  AiApprovedSettingsOperationResultDraft, AiApprovedSettingsTaskCheckpointDraft, AiApprovedSettingsErrorDraft } from './ai-approved-settings-draft';

type NotRequested = { availability: 'not_requested' };
type Unavailable = { availability: 'unavailable' };
type Snapshot = Unavailable | { availability: 'available'; value: AiTaskSnapshotDraft };
type Observation = { consistency: 'independent_authorized_reads'; execution: 'read_only_no_start_no_reconnect_side_effect' };
export type AiTaskSceneReadDraft =
  | { kind: 'original'; taskId: string; runId: string; original: AiSceneRequestReadDraft; resultId?: string;
      review?: AiHumanQuoteOrderReviewRequestDraft; decision?: AiHumanQuoteOrderDecisionRequestDraft; order?: AiSelectedQuoteTaskRequestDraft }
  | { kind: 'settings'; taskId: string; runId: string; reference: { preparation: AiApprovedSettingsPrepareDraft; operationKey?: string } };
export type AiSceneOrderFactsObservationDraft = { original: AiSceneRequestReceiptDraft; taskId: string; runId: string;
  result: { taskId: string; runId: string; resultId: string; observedAt: string; automaticRetry: false;
    businessExecution: 'readonly_not_business_commit' } & (
    | { status: 'available'; facts: AiOrderReadFactsDraft; nextAction: 'read_only'; modelText: 'not_used_as_business_evidence' }
    | { status: 'stale'; facts: null; nextAction: 'reread_current_facts'; modelText: 'not_used_as_business_evidence' }
    | { status: 'unknown'; facts: null; nextAction: 'reconcile_original_task' }
    | { status: 'failed'; facts: null; nextAction: 'manual_review' }
  ) | { status: 'unknown' | 'failed' | 'candidate_not_executed'; facts: null; automaticRetry: false; businessExecution: 'readonly_not_business_commit' } };
export type AiSettingsBusinessObservationDraft = {
  mode: 'read_only'; businessOutcome: 'unknown'; retryable: false; nextAction: AiApprovedSettingsErrorDraft['nextAction'];
} | {
  mode: 'read_only'; observedAt: string; scope: AiWorkspaceScope; task: AiTaskRecoverySnapshot['task']; run: AiTaskRecoverySnapshot['run'];
  step: { stepId: string; revision: number; status: AiTaskRecoverySnapshot['steps'][number]['status'];
    effect: 'none' | 'possible' | 'committed'; inputRef: string | null; fingerprint: string; resultRef: string | null };
  current: AiApprovedSettingsCurrentDraft; change: AiApprovedSettingsChangeReviewDraft | null; currentMatchesChangeBase: boolean | null;
  preparation: AiApprovedSettingsPreparationReceiptDraft; review: AiApprovedSettingsReviewDraft | null;
  decision: AiApprovedSettingsDecisionReceiptDraft | null;
  operation: AiApprovedSettingsOperationResultDraft | Omit<Extract<AiApprovedSettingsOperationResultDraft, { state: 'committed' }>, 'cacheRefreshed'> | null;
  confirmation: AiApprovedSettingsTaskCheckpointDraft | null; inputPublication: 'published_reference'; execution: 'not_attested';
  workflowStatus: AiTaskRecoverySnapshot['task']['status']; cancellation: 'requested_not_rollback' | 'not_requested';
  businessOutcome: 'committed' | 'unknown' | 'not_observed'; retryable: false;
  originalOperation: 'original_key_read' | 'persisted_original_binding_read' | 'original_result_not_observed';
};
export type AiTaskSceneObservationDraft = Observation & (
  | { kind: 'original'; taskId: string; runId: string; originRunId: string; snapshot: Snapshot;
      task: { original: AiSceneRequestReceiptDraft; task: AiSceneTaskReceiptDraft; recovery: NotRequested }
        | { original: { receipt: AiSceneRequestReceiptDraft; sceneCode: AiSceneRequestBody['sceneCode']; sceneVersion: string;
            inputRef: string; inputRevision: number; inputHash: string; scope: AiWorkspaceScope; audience: 'operator' | 'staff' };
          task: AiSceneTaskReceiptDraft; recovery: AiSceneRequestRecoveryDraft | {
            nextAction: 'reconcile_request_or_explicit_create_task'; automaticExecution: false };
          result: { status: 'available_to_authorized_result_reader' | 'not_available'; execution: 'not_inferred_from_metadata' };
          execution: 'read_only_no_start_no_reconnect_side_effect' };
      originalInput: { receipt: AiSceneRequestReceiptDraft; request: AiSceneRequestBody }
        | { receipt: AiSceneRequestReceiptDraft; material: NotRequested };
      pendingInput: NotRequested | Unavailable | { taskId: string; runId: string; input: AiSceneModelPendingInputDraft;
        execution: 'read_only_no_start_no_reconnect_side_effect' };
      model: AiSceneModelResultObservationDraft | NotRequested;
      review: NotRequested | { taskId: string; review: AiApprovalApplicationReviewDraft; order: 'not_created_by_read' };
      decision: NotRequested | { taskId: string; receipt: AiApprovalApplicationReceiptDraft; order: 'not_created_by_read' };
      business: NotRequested | { taskId: string; runId: string; result: AiSelectedQuoteTaskResultDraft;
        execution: 'read_only_no_start_no_reconnect_side_effect' };
      orderFacts?: NotRequested | AiSceneOrderFactsObservationDraft; submission: 'not_attested_by_approval' }
  | { kind: 'settings'; taskId: string; runId: string; business: AiSettingsBusinessObservationDraft; snapshot: Snapshot;
      originalInput?: { inputRef: string | null; fingerprint: string; change: AiApprovedSettingsChangeReviewDraft | null };
      submission?: 'not_attested_by_approval' }
);
