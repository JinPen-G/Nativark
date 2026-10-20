import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT, AI_STEP_TRANSITION_REASONS_DRAFT, AI_TASK_STEP_CODES, AI_ERROR_CODES } from "@rental-os/shared";
import type { SchemaObject } from "./openapi-document";

const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const choice = (...values: string[]): SchemaObject => ({ type: "string", enum: values });
const id = (): SchemaObject => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
const closed = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items: SchemaObject, maxItems: number, minItems = 0): SchemaObject => ({ type: "array", items, minItems, maxItems });
const revision: SchemaObject = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const time: SchemaObject = { type: "string", format: "date-time", maxLength: 40 };
const version = choice(AI_TASK_DRAFT_VERSION);
const status = choice(...AI_TASK_STATUSES_DRAFT);
const reason = choice(...AI_TASK_TRANSITION_REASONS_DRAFT);
const errorProperties = {
  message: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" } as SchemaObject,
  missingFields: { ...list({ type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z][A-Za-z0-9_.\\[\\]-]*$" }, 32), uniqueItems: true }
};
const unknownError = closed({ ...errorProperties, code: choice("AI_RESULT_UNKNOWN"), retryable: { type: "boolean", enum: [false] }, nextAction: choice("reconcile") });
const knownError = closed({ ...errorProperties, code: choice(...AI_ERROR_CODES.filter(code => code !== "AI_RESULT_UNKNOWN")), retryable: { type: "boolean" }, nextAction: choice("none", "clarify", "reconfirm", "reauthorize", "reconcile", "retry_later", "manual") });
const positiveCursor: SchemaObject = { type: "string", minLength: 1, maxLength: 20, pattern: "^[1-9][0-9]*$" };
const cursor: SchemaObject = { type: "string", minLength: 1, maxLength: 20, pattern: "^(0|[1-9][0-9]*)$" };
const eventBase = { contractVersion: version, taskId: id(), cursor: positiveCursor, taskRevision: revision, occurredAt: time };

/** Shared task shapes, including the owner-only read transport. Execution and
 * state transitions still require their existing application/DB authority. */
export const AI_TASK_DRAFT_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  AiTaskReviewQueryDraft: closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 } }),
  AiTaskDecisionQueryDraft: closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 },
    proposal: ref('AiApprovalApplicationDecisionDraft') }),
  AiTaskHumanContinueDraft: closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 },
    checkpointRef: { type: 'string', format: 'uuid', maxLength: 36 }, expectedTaskRevision: revision, proposal: ref('AiApprovalApplicationReferenceDraft') }),
  AiTaskHumanContinuationDraft: { oneOf: ([
    { kind: choice('not_started'), reason: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-z_]+$' } },
    { kind: choice('run_outcome'), status: choice('succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown', 'unavailable', 'failed') }
  ] as Array<Record<string, SchemaObject>>).map(result => closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 },
    automaticRetry: { type: 'boolean', enum: [false] }, businessExecution: choice('read_original_receipt'), ...result })) },
  AiTaskHumanReviewDraft: { oneOf: ['order', 'settings'].map(kind => closed({
    taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 }, taskRevision: revision,
    checkpointRef: { ...id(), maxLength: 36 }, kind: choice(kind),
    review: ref(kind === 'order' ? 'AiApprovalApplicationReviewDraft' : 'AiApprovedSettingsReviewDraft'), businessExecution: choice('not_attested') })) },
  AiTaskHumanDecisionReceiptDraft: closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 },
    receipt: ref('AiApprovalApplicationReceiptDraft'), businessExecution: choice('not_attested') }),
  AiTaskBusinessObservationDraft: { oneOf: ([
    { status: choice('committed'), kind: choice('order'), order: closed({ id: id(), status: id(), quoteId: id() }) },
    { status: choice('committed'), kind: choice('settings'), receipt: ref('AiApprovedSettingsOperationReceiptDraft') },
    { status: choice('unknown', 'not_observed'), kind: choice('order', 'settings'), retryable: { type: 'boolean', enum: [false] } }
  ] as Array<Record<string, SchemaObject>>).map(result => closed({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, stepId: { ...id(), maxLength: 36 },
    observedAt: time, execution: choice('read_only_no_start_no_reconnect_side_effect'), payment: choice('not_inferred'), fulfillment: choice('not_inferred'), ...result })) },
  AiStepOutcomeDraft: { oneOf: [
    closed({ status: choice("pending", "cancelled"), effect: choice("none") }),
    closed({ status: choice("running"), effect: choice("none", "possible") }),
    closed({ status: choice("succeeded"), effect: choice("none"), facts: list(ref("AiFactReference"), 64) }),
    closed({ status: choice("succeeded"), effect: choice("committed"), facts: list(ref("AiFactReference"), 64, 1) }),
    closed({ status: choice("failed"), effect: choice("none"), error: knownError }),
    closed({ status: choice("unknown"), effect: choice("possible"), error: unknownError })
  ] },
  AiStepStateDraft: closed({
    stepId: id(), runId: id(), sequence: revision, revision, toolCode: choice(...AI_TASK_STEP_CODES), toolVersion: id(),
    actionId: id(), requestFingerprint: { type: "string", minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" },
    outcome: ref("AiStepOutcomeDraft")
  }),
  AiTaskStateDraft: {
    ...closed({ contractVersion: version, taskId: id(), revision, status, createdContext: ref("AiExecutionContext"), steps: list(ref("AiStepStateDraft"), 1000) }),
    description: "Internal draft state only. Creation context is not renewable authority. Duplicate action/step IDs and run-sequence pairs require application/DB constraints."
  },
  AiRunLeaseDraft: closed({ contractVersion: version, taskId: id(), runId: id(), holderId: id(), fencingToken: positiveCursor, expiresAt: time }),
  AiTaskTransitionRequestDraft: {
    ...closed({ contractVersion: version, taskId: id(), expectedRevision: revision, to: status, reason, occurredAt: time, initiator: closed({ kind: choice("user", "worker", "system"), id: id() }) }),
    description: "Trusted server audit input, not a model/client command or proof of authorization. Apply atomically with persistent revision/fencing and append the event only after commit."
  },
  AiTaskTransitionDecisionDraft: { oneOf: [
    closed({ allowed: { type: "boolean", enum: [true] }, nextRevision: revision }),
    closed({ allowed: { type: "boolean", enum: [false] }, reason: choice("invalid_state", "revision_conflict", "transition_denied", "unresolved_steps", "outcome_conflict") })
  ] },
  AiTaskEventDraft: { oneOf: [
    closed({ ...eventBase, type: choice("task.transition"), data: closed({ from: status, to: status, reason }) }),
    closed({ ...eventBase, type: choice("step.registered"), data: closed({ stepId: id(), runId: id(), sequence: { type: "integer", minimum: 1, maximum: 4294967295 }, stepRevision: { type: "integer", enum: [1] } }) }),
    closed({ ...eventBase, type: choice("step.changed"), data: closed({ stepId: id(), runId: id(), stepRevision: revision, status: choice(...AI_STEP_STATUSES_DRAFT), reason: choice(...AI_STEP_TRANSITION_REASONS_DRAFT) }) }),
    closed({ ...eventBase, type: choice("task.output_ready"), data: closed({ resultId: id() }) }),
    closed({ ...eventBase, type: choice("task.input_refreshed"), data: closed({ requestId: id(), previousRevision: revision, revision }) }),
    closed({ ...eventBase, type: choice("access.revoked"), data: closed({ code: choice("AI_ACCESS_DENIED", "AI_SCOPE_CHANGED") }) })
  ] },
  AiTaskEventPageDraft: closed({ contractVersion: version, taskId: id(), events: list(ref("AiTaskEventDraft"), 100), nextCursor: cursor, hasMore: { type: "boolean" } }),
  AiTaskSnapshotDraft: closed({ contractVersion: version, taskId: id(), revision, status,
    sceneCode: id(), sceneVersion: id(), createdAt: time, updatedAt: time,
    cancelRequestedAt: { ...time, nullable: true }, cursor,
    steps: list({ type: 'object', properties: { stepId: id(), runId: id(), sequence: revision, revision,
      status: choice(...AI_STEP_STATUSES_DRAFT), resultId: id(), kind: choice('model', 'confirmation') }, required: ['stepId', 'runId', 'sequence', 'revision', 'status'], additionalProperties: false }, 1000) }),
  AiTaskEventResetDraft: closed({ contractVersion: version, taskId: id(), status: choice("reset_required"), reason: choice("cursor_expired", "unsupported_version") }),
  AiTaskMetadataQueryDraft: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 },
    cursor: { type: 'string', maxLength: 512 }, status, sceneCode: id() }, additionalProperties: false },
  AiTaskModelObservationDraft: { ...closed({ contractVersion: version, taskId: id(), runId: id(), resultId: id(),
    sceneCode: choice('order_explanation', 'opening_diagnosis', 'quote_clarification'), status: choice('available', 'stale', 'unknown', 'failed'),
    text: { ...closed({ value: { type: 'string', maxLength: 131072 }, trust: choice('unverified_model_text_not_execution_evidence') }), nullable: true },
    observedAt: time, businessExecution: choice('not_inferred_from_model_result'), execution: choice('read_only_no_start_no_reconnect_side_effect') }),
    description: 'Available text only after original task, current business facts and referenced knowledge ACL/consent revalidation. Stale, unknown and failed observations return null text. No generic raw artifact or execution grant.' },
  AiTaskMetadataPageDraft: closed({ items: list(closed({ taskId: id(), status, revision, sceneCode: id(), sceneVersion: id(),
    createdAt: time, updatedAt: time, cancelRequestedAt: { ...time, nullable: true } }), 50),
    nextCursor: { type: 'string', maxLength: 512, nullable: true } })
};
