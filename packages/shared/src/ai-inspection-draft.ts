import type { AiExecutionScope } from "./ai-native";
import type { RentalInspectionTemplate } from "./core";
import type { AiTaskEventDraft, AiTaskStatusDraft } from './ai-task-draft';
import type { AiModelCancellationTransitionReceiptDraft, AiSceneModelPendingInputDraft,
  AiSceneModelResumeResponseDraft, AiSceneModelExecutionDraft } from './ai-task-recovery-draft';
import type { AiTaskInputReceiptObservationDraft } from './ai-task-input-draft';
import { AI_TASK_DRAFT_VERSION } from './ai-task-draft';
import type { AiInspectionResultReadRequest } from './ai-inspection-lifecycle-http-draft';

/** Relative to the original inspection-task controller, not an arbitrary navigation target. */
export const AI_INSPECTION_TASK_RESULT_REFERENCE_PATH = 'results/reference/read' as const;

export const AI_INSPECTION_TASK_POLICY_OPERATIONS = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run',
  'claim_recovery_run', 'release_run', 'transition_task', 'takeover_run', 'request_input', 'submit_input', 'resume_input'] as const;
export type AiInspectionTaskPolicyOperation = typeof AI_INSPECTION_TASK_POLICY_OPERATIONS[number];
export type AiInspectionTaskPolicyRequest = { reference: import('./ai-inspection-persistence').AiInspectionRecognitionTaskReference;
  operation: AiInspectionTaskPolicyOperation };
export type AiInspectionTaskPolicyConfigureRequest = AiInspectionTaskPolicyRequest & { expectedRevision: number | null };
export type AiInspectionTaskPolicyClearRequest = AiInspectionTaskPolicyRequest & { expectedRevision: number };
export type AiInspectionTaskPolicy = { taskId: string; operation: AiInspectionTaskPolicyOperation; revision: number;
  requiredPermissions: readonly string[]; expiresAt: string };
type InspectionPolicySemantics = { purpose: 'original_inspection_candidate_runtime_only'; approval: 'not_granted'; inspectionSubmission: 'not_attempted' };
export type AiInspectionTaskPolicyReadResponse = InspectionPolicySemantics & { result:
  | { state: 'observed'; policy: AiInspectionTaskPolicy; retryable: false; nextAction: 'read_original_policy' }
  | { state: 'not_observed'; retryable: false; nextAction: 'reconcile' } };
export type AiInspectionTaskPolicyChangeResponse = InspectionPolicySemantics & { result: AiInspectionTaskPolicy };
export const AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS = {
  read: { request: 'AiInspectionTaskPolicyRequest', response: 'AiInspectionTaskPolicyReadResponse', write: false },
  configure: { request: 'AiInspectionTaskPolicyConfigureRequest', response: 'AiInspectionTaskPolicyChangeResponse', write: true },
  clear: { request: 'AiInspectionTaskPolicyClearRequest', response: 'AiInspectionTaskPolicyChangeResponse', write: true }
} as const;

export const AI_INSPECTION_TASK_HTTP_CONTRACTS = {
  create: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskCreationResponse', write: true, nextAction: 'read_creation' },
  readCreation: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskCreationObservation', write: false, nextAction: 'read_creation' },
  start: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskExecutionResponse', write: true, nextAction: 'reconcile' },
  reconcile: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskExecutionResponse', write: true, nextAction: 'reconcile' },
  readInput: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskPendingInputResponse', write: false, nextAction: 'read_creation' },
  resume: { request: 'AiInspectionRecognitionTaskResumeRequest', response: 'AiInspectionTaskResumeResponse', write: true, nextAction: 'read_answer' },
  readAnswer: { request: 'AiInspectionRecognitionTaskResumeRequest', response: 'AiInspectionTaskAnswerObservation', write: false, nextAction: 'read_answer' },
  continueAnswer: { request: 'AiInspectionRecognitionTaskResumeRequest', response: 'AiInspectionTaskContinueResponse', write: true, nextAction: 'read_answer' },
  readResultReference: { request: 'AiInspectionRecognitionTaskReference', response: 'AiInspectionTaskResultReferenceObservation', write: false, nextAction: 'read_original_task' }
} as const;
export type AiInspectionTaskCreationResponse = { task: { taskId: string; runId: string; status: AiTaskStatusDraft; revision: number; replayed: boolean };
  execution: 'not_attested'; purpose: 'inspection_candidates_only' };
export type AiInspectionTaskCreationObservation = {
  creationKey: string; execution: 'not_attested'; retryable: false;
} & ({ state: 'not_observed'; task: null; nextAction: 'read_original_task' }
  | { state: 'not_observed' | 'unknown'; task: null; nextAction: 'reconcile'; semantics: 'original_metadata_not_dispatch_or_candidate_evidence' }
  | { state: 'observed'; task: AiInspectionTaskCreationResponse['task']; nextAction: 'read_original_task'; semantics: 'original_metadata_not_dispatch_or_candidate_evidence' });
export type AiInspectionTaskExecutionResponse = Exclude<AiSceneModelExecutionDraft, { takeover: string }>;
export type AiInspectionTaskPendingInputResponse = AiSceneModelPendingInputDraft;
export type AiInspectionTaskResumeResponse = Omit<AiSceneModelResumeResponseDraft, 'continuation'> & {
  continuation: Exclude<AiSceneModelResumeResponseDraft['continuation'], { takeover: string }> };
export type AiInspectionTaskAnswerObservation = AiTaskInputReceiptObservationDraft;
export type AiInspectionTaskContinueResponse = { receipt: Extract<AiTaskInputReceiptObservationDraft, { state: 'not_observed' }>; continuation: 'unavailable' }
  | { receipt: Extract<AiTaskInputReceiptObservationDraft, { state: 'observed' }>; result: AiInspectionTaskExecutionResponse };

/** Original owned model result locator only. Source access and candidate
 * validity are checked again by the existing result reader; no model body,
 * approval, execution or refund is asserted by this observation. */
export type AiInspectionTaskResultReferenceObservation = {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  execution: 'read_only_no_lease_or_dispatch'; retryable: false;
} & (
  | { state: 'observed'; task: AiInspectionTaskCreationResponse['task']; reference: AiInspectionResultReadRequest; nextAction: 'read_original_result' }
  | { state: 'not_observed'; task: AiInspectionTaskCreationResponse['task'] | null; reference: null; nextAction: 'read_original_task' }
);

export const AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS = {
  requestCancel: { request: 'AiInspectionRecognitionTaskCancelRequest', response: 'AiInspectionTaskCancelResponse', write: true, nextAction: 'read_cancel_receipt' },
  readCancelReceipt: { request: 'AiInspectionRecognitionTaskCancelRequest', response: 'AiInspectionTaskCancelObservation', write: false, nextAction: 'read_cancel_receipt' },
  settleUnstartedCancellation: { request: 'AiInspectionRecognitionTaskCancelRequest', response: 'AiInspectionTaskSettlementResponse', write: true, nextAction: 'read_cancel_settlement_receipt' },
  settleReleasedInputCancellation: { request: 'AiInspectionRecognitionTaskCancelRequest', response: 'AiInspectionTaskSettlementResponse', write: true, nextAction: 'read_cancel_settlement_receipt' },
  readCancellationSettlementReceipt: { request: 'AiInspectionRecognitionTaskCancelRequest', response: 'AiInspectionTaskSettlementObservation', write: false, nextAction: 'read_cancel_settlement_receipt' }
} as const;
type InspectionCancellationTransition = Omit<AiModelCancellationTransitionReceiptDraft, 'runRevision'> & { runRevision?: null };
export type AiInspectionTaskCancelResponse = { receipt: InspectionCancellationTransition; cancellation: 'requested_not_rollback' };
export type AiInspectionTaskSettlementResponse = { receipt: InspectionCancellationTransition;
  cancellation: 'task_cancelled_not_business_rollback'; remoteCancellation: 'not_attested'; automaticRetry: false; admission: 'not_granted' };
/** The original task owns this receipt; the inspection reference grants neither
 * task execution nor remote cancellation. A missing event is not a rollback. */
export type AiInspectionTaskCancellationObservation = {
  taskId: string; expectedRevision: number; snapshot: { revision: number; cursor: string; status: AiTaskStatusDraft };
  cancellation: 'request_not_rollback' | 'task_cancelled_not_business_rollback'; remoteCancellation: 'not_attested';
  automaticRetry: false; admission: 'not_granted'; absenceSemantics: 'not_observed_is_not_proof_of_uncommitted';
} & ({ status: 'observed'; event: Extract<AiTaskEventDraft, { type: 'task.transition' }> }
  | { status: 'not_observed'; event: null });
export const AI_INSPECTION_DRAFT_VERSION = "ain-c09-draft-1" as const;
/** IDs are references only. Source reading must reauthorize attachment/order/resource ownership. */
export type AiInspectionSourceDraft = { attachmentId: string; attachmentRevision: number } & (
  | { kind: "image"; region: { x: number; y: number; width: number; height: number } }
  | { kind: "audio"; span: { startMs: number; endMs: number } }
);
export type AiInspectionValueDraft =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text" | "select"; value: string }
  | { kind: "photo"; attachmentId: string; attachmentRevision: number };
export type AiInspectionCandidateDraft = { candidateId: string; fieldCode: string; sources: AiInspectionSourceDraft[];
  /** Quoted media text is untrusted recognition evidence, never an instruction
   * or a human-approved value. Old candidates can have no recorded quote. */
  sourceText?: string } & (
  | { status: "candidate"; value: AiInspectionValueDraft; confidence: number }
  | { status: "missing" | "blurred"; reason: string }
);
/** Human correction is not submission/approval; actor identity established by server. */
export interface AiInspectionCorrectionDraft {
  correctionId: string; candidateId: string; expectedDraftRevision: number;
  value: AiInspectionValueDraft; reason: string; recordedAt: string;
}
export type AiInspectionReviewIssueDraft = "baseline_missing" | "meter_replaced" | "reading_backwards" | "field_unavailable" | "source_unclear";
export interface AiInspectionExtractDraft {
  draftVersion: typeof AI_INSPECTION_DRAFT_VERSION; draftId: string; revision: number;
  scope: Extract<AiExecutionScope, { kind: "workspace" }>;
  orderId: string; assetId: string; allocationId: string;
  stage: RentalInspectionTemplate["stage"];
  frozenTemplate: { templateId: string; version: string };
  status: "awaiting_review" | "pending_submission";
  candidates: AiInspectionCandidateDraft[]; corrections: AiInspectionCorrectionDraft[];
  reviewIssues: AiInspectionReviewIssueDraft[];
}
