import { AI_TASK_INPUT_DRAFT_VERSION, AI_TASK_INPUT_FIELD_IDS_DRAFT } from "./ai-task-input-draft";
import { leafClosed as obj, leafEnum as choice, leafInt as int, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const id = (maxLength = 191) => ({ type: "string", minLength: 1, maxLength, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "\\S", not: { pattern: "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]" } });
const base = { required: { type: "boolean" }, label: text(160) };
const field: AiLeafSchemaDraft = { oneOf: [
  obj({ ...base, fieldId: choice("customer_selection", "item_selection", "pickup_location", "return_location", "fulfillment_selection", "pricing_unit_selection", "delivery_address_selection", "enterprise_selection", "enterprise_payer_selection"), kind: choice("choice"),
    options: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: obj({ value: id(), label: text(160) }) } }),
  obj({ ...base, fieldId: choice("quantity"), kind: choice("integer"), minimum: int(1, 1000000), maximum: int(1, 1000000) }),
  obj({ ...base, fieldId: choice("starts_at", "ends_at", "usage_quantity", "clarification_text"), kind: choice("text"), maxLength: int(1, 2048) })
] };
const answer = obj({ fieldId: choice(...AI_TASK_INPUT_FIELD_IDS_DRAFT), value: { oneOf: [text(2048), int(1, 1000000)] } });
/** Cross-field uniqueness, bounds and answer membership also require the exported semantic validators. */
export const AI_TASK_INPUT_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskInputFieldDraft: field,
  AiTaskInputContractDraft: obj({ draftVersion: choice(AI_TASK_INPUT_DRAFT_VERSION), code: id(64), version: id(64),
    fields: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: field } }),
  AiTaskInputAnswerDraft: answer,
  AiTaskInputReceiptReferenceDraft: obj({ taskId: id(36), requestId: id(36),
    expectedRevision: int(1, 4294967294), submissionKey: id() }),
  AiTaskInputSavedReceiptDraft: obj({ status: choice("input_received"), taskId: id(36), requestId: id(36),
    receiptId: id(36), taskRevision: int(1, 4294967294), replayed: { type: "boolean" } }),
  AiTaskInputReceiptObservationDraft: { oneOf: [
    obj({ state: choice("not_observed"), retryable: { type: "boolean", const: false } }),
    obj({ state: choice("observed"), retryable: { type: "boolean", const: false }, taskId: id(36), requestId: id(36),
      receiptId: id(36), taskRevision: int(1, 4294967294), runId: id(36), execution: choice("not_inferred_from_receipt") })] },
  AiTaskInputSubmissionDraft: obj({ draftVersion: choice(AI_TASK_INPUT_DRAFT_VERSION), taskId: id(36), requestId: id(36),
    expectedRevision: int(1, 4294967294), submissionKey: id(), answers: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: answer } })
};
