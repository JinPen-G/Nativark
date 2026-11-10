/** AIN-C04 input extension: clarification data, never approval or execution authority. */
export const AI_TASK_INPUT_DRAFT_VERSION = "ain-c04-input-draft-1" as const;
export type AiTaskInputOperation = "request_input" | "submit_input" | "resume_input";
export const AI_TASK_INPUT_FIELD_IDS_DRAFT = Object.freeze([
  "customer_selection", "item_selection", "pickup_location", "return_location", "fulfillment_selection", "pricing_unit_selection", "delivery_address_selection", "enterprise_selection", "enterprise_payer_selection",
  "quantity", "usage_quantity", "starts_at", "ends_at", "clarification_text"
] as const);
export type AiTaskInputFieldIdDraft = typeof AI_TASK_INPUT_FIELD_IDS_DRAFT[number];
type ChoiceId = "customer_selection" | "item_selection" | "pickup_location" | "return_location" | "fulfillment_selection" | "pricing_unit_selection" | "delivery_address_selection" | "enterprise_selection" | "enterprise_payer_selection";
export const AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION = "ain-quote-row-target-1" as const;
/** Server-prepared original candidate binding, never client selection or authority.
 * The quote consumer checks the normalized pre-round fingerprint and row bounds. */
export interface AiTaskInputQuoteRowTargetDraft {
  bindingVersion: typeof AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION;
  kind: "quote_item";
  rowIndex: number;
  candidateInputFingerprint: string;
}
interface FieldBase { required: boolean; label: string }
export type AiTaskInputFieldDraft = FieldBase & (
  | { fieldId: Exclude<ChoiceId, "item_selection" | "pricing_unit_selection">; kind: "choice"; options: { value: string; label: string }[]; target?: never }
  | { fieldId: "item_selection" | "pricing_unit_selection"; kind: "choice"; options: { value: string; label: string }[]; target?: AiTaskInputQuoteRowTargetDraft }
  | { fieldId: "quantity"; kind: "integer"; minimum: number; maximum: number; target?: AiTaskInputQuoteRowTargetDraft }
  | { fieldId: "starts_at" | "ends_at" | "clarification_text"; kind: "text"; maxLength: number; target?: never }
  | { fieldId: "usage_quantity"; kind: "text"; maxLength: number; target?: AiTaskInputQuoteRowTargetDraft }
);
export interface AiTaskInputContractDraft {
  draftVersion: typeof AI_TASK_INPUT_DRAFT_VERSION;
  code: string;
  version: string;
  /** Registered fields must be independently verified by a server-owned source. */
  fields: AiTaskInputFieldDraft[];
}
export interface AiTaskInputAnswerDraft { fieldId: AiTaskInputFieldIdDraft; value: string | number }
export interface AiTaskInputSubmissionDraft {
  draftVersion: typeof AI_TASK_INPUT_DRAFT_VERSION;
  taskId: string;
  requestId: string;
  expectedRevision: number;
  submissionKey: string;
  answers: AiTaskInputAnswerDraft[];
}

/** Exact saved-answer lookup. It is not a new answer, approval or execution grant. */
export type AiTaskInputReceiptReferenceDraft = Pick<AiTaskInputSubmissionDraft,
  "taskId" | "requestId" | "expectedRevision" | "submissionKey">;

/** A saved human answer, not evidence that its successor ran or was approved. */
export interface AiTaskInputSavedReceiptDraft {
  status: "input_received";
  taskId: string;
  requestId: string;
  receiptId: string;
  taskRevision: number;
  replayed: boolean;
}
export type AiTaskInputReceiptObservationDraft =
  | { state: "not_observed"; retryable: false }
  | { state: "observed"; retryable: false; taskId: string; requestId: string;
      receiptId: string; taskRevision: number; runId: string; execution: "not_inferred_from_receipt" };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const id = (value: unknown, max = 191): value is string => typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const int = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const fieldId = (value: unknown): value is AiTaskInputFieldIdDraft => typeof value === "string" && (AI_TASK_INPUT_FIELD_IDS_DRAFT as readonly string[]).includes(value);

/** Structural data binding only; original server provenance and row existence
 * remain the quote consumer's responsibility. */
export function isAiTaskInputQuoteRowTargetDraft(value: unknown): value is AiTaskInputQuoteRowTargetDraft {
  return object(value) && closed(value, ["bindingVersion", "kind", "rowIndex", "candidateInputFingerprint"])
    && value.bindingVersion === AI_TASK_INPUT_QUOTE_ROW_TARGET_VERSION && value.kind === "quote_item"
    && int(value.rowIndex, 0, Number.MAX_SAFE_INTEGER) && typeof value.candidateInputFingerprint === "string"
    && /^[a-f0-9]{64}$/u.test(value.candidateInputFingerprint);
}

export function isAiTaskInputContractDraft(value: unknown): value is AiTaskInputContractDraft {
  if (!object(value) || !closed(value, ["draftVersion", "code", "version", "fields"])
    || value.draftVersion !== AI_TASK_INPUT_DRAFT_VERSION || !id(value.code, 64) || !id(value.version, 64)
    || !Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 8) return false;
  const seen = new Set<string>(), candidateFingerprints = new Set<string>();
  const valid = value.fields.every(field => {
    if (!object(field) || !fieldId(field.fieldId) || seen.has(field.fieldId) || typeof field.required !== "boolean" || !text(field.label, 160)) return false;
    seen.add(field.fieldId);
    const targeted = Object.prototype.hasOwnProperty.call(field, "target");
    if (targeted) {
      if (!["item_selection", "quantity", "pricing_unit_selection", "usage_quantity"].includes(field.fieldId)
        || !isAiTaskInputQuoteRowTargetDraft(field.target)) return false;
      candidateFingerprints.add(field.target.candidateInputFingerprint);
    }
    const keys = (specific: string[]) => ["fieldId", "kind", "required", "label", ...specific, ...(targeted ? ["target"] : [])];
    if (field.kind === "choice") return ["customer_selection", "item_selection", "pickup_location", "return_location", "fulfillment_selection", "pricing_unit_selection", "delivery_address_selection", "enterprise_selection", "enterprise_payer_selection"].includes(field.fieldId)
      && closed(field, keys(["options"])) && Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 50
      && field.options.every(option => object(option) && closed(option, ["value", "label"]) && id(option.value) && text(option.label, 160))
      && new Set(field.options.map(option => option.value)).size === field.options.length;
    if (field.kind === "integer") return field.fieldId === "quantity" && closed(field, keys(["minimum", "maximum"]))
      && int(field.minimum, 1, 1000000) && int(field.maximum, field.minimum, 1000000);
    return field.kind === "text" && ["starts_at", "ends_at", "usage_quantity", "clarification_text"].includes(field.fieldId)
      && closed(field, keys(["maxLength"])) && int(field.maxLength, 1, 2048);
  });
  // One round binds one pre-answer candidate. Field IDs stay unique; the same
  // field for another row is offered in a later bounded round, not privately encoded.
  return valid && candidateFingerprints.size <= 1;
}

export function isAiTaskInputSubmissionDraft(value: unknown): value is AiTaskInputSubmissionDraft {
  return object(value) && closed(value, ["draftVersion", "taskId", "requestId", "expectedRevision", "submissionKey", "answers"])
    && value.draftVersion === AI_TASK_INPUT_DRAFT_VERSION && id(value.taskId, 36) && id(value.requestId, 36)
    && int(value.expectedRevision, 1, 4294967294) && id(value.submissionKey) && Array.isArray(value.answers)
    && value.answers.length > 0 && value.answers.length <= 8
    && value.answers.every(answer => object(answer) && closed(answer, ["fieldId", "value"]) && fieldId(answer.fieldId)
      && (text(answer.value, 2048) || int(answer.value, 1, 1000000)))
    && new Set(value.answers.map(answer => answer.fieldId)).size === value.answers.length;
}

export function isAiTaskInputSavedReceiptDraft(value: unknown): value is AiTaskInputSavedReceiptDraft {
  return object(value) && closed(value, ["status", "taskId", "requestId", "receiptId", "taskRevision", "replayed"])
    && value.status === "input_received" && id(value.taskId, 36) && id(value.requestId, 36)
    && id(value.receiptId, 36) && int(value.taskRevision, 1, 4294967294) && typeof value.replayed === "boolean";
}

/** Canonical input for Core's existing numeric usage DTO, never money. Reject
 * unrepresentable precision rather than silently round a human's answer. */
export function parseAiTaskUsageQuantityDraft(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value)) return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 && quantity <= 1000000 && String(quantity) === value ? quantity : null;
}

/** Shape/range validation only. No resource ownership, plan change, approval or entitlement is granted. */
export function validateAiTaskInputAnswersDraft(contract: unknown, answers: unknown): answers is AiTaskInputAnswerDraft[] {
  if (!isAiTaskInputContractDraft(contract) || !Array.isArray(answers) || answers.length < 1 || answers.length > 8) return false;
  const seen = new Set<string>();
  for (const answer of answers) {
    if (!object(answer) || !closed(answer, ["fieldId", "value"]) || !fieldId(answer.fieldId) || seen.has(answer.fieldId)) return false;
    seen.add(answer.fieldId);
    const field = contract.fields.find(item => item.fieldId === answer.fieldId);
    if (!field) return false;
    if (field.kind === "choice") { if (!field.options.some(option => option.value === answer.value)) return false; }
    else if (field.kind === "integer") { if (!int(answer.value, field.minimum, field.maximum)) return false; }
    else {
      if (!text(answer.value, field.maxLength)) return false;
      if (field.fieldId === "usage_quantity" && parseAiTaskUsageQuantityDraft(answer.value) === null) return false;
      // Canonical UTC instants only in v1; timezone/natural-language interpretation belongs to Core input preparation.
      if ((field.fieldId === "starts_at" || field.fieldId === "ends_at") && (!Number.isFinite(Date.parse(answer.value)) || new Date(answer.value).toISOString() !== answer.value)) return false;
    }
  }
  return contract.fields.every(field => !field.required || seen.has(field.fieldId));
}
