/** Opt-in, read-only discovery of already persisted human automation reviews.
 * A cursor is an untrusted position, never task access or execution permission. */
import type { AiBusinessEventDraft } from './ai-events-draft';
export const AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT = {
  method: 'POST', operation: 'reviews/queue',
  operatorBasePath: 'ai-native/automation/operator', staffBasePath: 'ai-native/automation/staff'
} as const;

export type AiAutomationReviewQueueFiltersDraft = {
  reviewStatus?: 'open' | 'closed';
  eventType?: AiBusinessEventDraft['type'];
};
export type AiAutomationReviewQueueRequestDraft = {
  /** Required, 1 through 10. No scan-to-fill. */
  limit: number;
  after?: string;
  filters?: AiAutomationReviewQueueFiltersDraft;
};
export type AiAutomationReviewQueueItemDraft = {
  inputRef: string;
  mode: 'shadow' | 'manual_confirmation';
  review: { status: 'open' | 'closed'; revision: number; closeReason: string | null; feedbackCode: string | null };
  event: { eventId: string; type: AiBusinessEventDraft['type'];
    status: string; resourceRevision: number; fence: number; expiresAt: string };
  task: { state: 'observed'; taskId: string; runId: string; status: string; revision: number; archived: boolean }
    | { state: 'not_observed'; taskId: null; runId: null };
  suggestionActive: boolean;
  nextAction: 'human_review' | 'read_original_creation' | 'read_original_resource' | 'read_review_operation';
};
export type AiAutomationReviewQueueResponseDraft = {
  items: AiAutomationReviewQueueItemDraft[];
  /** Last authorized position when the bounded window was full; does not assert more rows exist. */
  nextAfter: string | null;
  coverage: 'bounded_authorized_window';
  continuation: 'position_only_not_more_results';
  readOnly: true;
  workerStarted: false;
  executionPermission: false;
  businessActionRequested: false;
};
