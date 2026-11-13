/** Explicit explanation of an original automation input. Preparation, first
 * model startup and historical observation are separate; none approves or
 * executes a business action, and unknowns retain the original input key. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafRef as ref,
  leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiBusinessEventDraft } from './ai-events-draft';

export const AI_AUTOMATION_EXPLANATION_HTTP = Object.freeze({ method: 'POST',
  basePath: 'ai-native/automation/explanation', read: 'read', prepare: 'prepare', start: 'start' } as const);
export const AI_AUTOMATION_EXPLANATION_CONTRACTS = Object.freeze({
  read: { request: 'AiAutomationExplanationReadDraft', response: 'AiAutomationExplanationObservationDraft' },
  prepare: { request: 'AiAutomationExplanationReadDraft', response: 'AiAutomationExplanationPreparationDraft' },
  start: { request: 'AiAutomationExplanationStartDraft', response: 'AiAutomationExplanationObservationDraft' },
} as const);
export interface AiAutomationExplanationReadDraft { inputRef: string }
export interface AiAutomationExplanationOriginalDraft { inputRef: string; taskId: string; runId: string }
export type AiAutomationExplanationPreparationDraft = {
  version: 'automation-explanation-preparation-1'; original: AiAutomationExplanationOriginalDraft;
  bindingHash: string; sourceHash: string; policyHash: string; event: AiBusinessEventDraft;
  inputMode: 'shadow' | 'manual_confirmation'; expiresAt: string;
  executionPermission: false; businessActionRequested: false; automaticRetry: false;
};
export type AiAutomationExplanationStartDraft = AiAutomationExplanationReadDraft & {
  decision: 'start_original_automation_explanation'; preparation: AiAutomationExplanationPreparationDraft;
};
type Observation = { original: AiAutomationExplanationOriginalDraft; readOnly: true; automaticRetry: false;
  executionPermission: false; businessActionRequested: false; businessExecution: 'not_attempted';
  source: { inputHash: string; event: AiBusinessEventDraft; inputMode: 'shadow' | 'manual_confirmation' };
  /** Optional only for stored older packets. Without a current review the text
   * remains historical evidence, never an actionable current suggestion. */
  currentReview?: { suggestion: 'current' | 'stale' | 'unavailable'; resourceRevision: number | null;
    reviewStatus: 'open' | 'closed'; checkedAt: string } };
export type AiAutomationExplanationObservationDraft = Observation & (
  | { state: 'not_started' | 'unknown'; result: null }
  | { state: 'failed'; result: { resultId: string; stepId: string; callId: string; errorCode: string | null } }
  | { state: 'completed'; result: { resultId: string; stepId: string; callId: string; text: string;
      semantics: 'model_explanation_not_core_fact_or_handling_receipt' } }
);
const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const original = object({ inputRef: uuid, taskId: uuid, runId: uuid });
const semantics = { executionPermission: no, businessActionRequested: no, automaticRetry: no };
const source = object({ inputHash: hash, event: ref('AiBusinessEventDraft'), inputMode: choice('shadow', 'manual_confirmation') });
const currentReview = object({ suggestion: choice('current', 'stale', 'unavailable'),
  resourceRevision: { oneOf: [{ type: 'integer', minimum: 1, maximum: 4294967294 }, { type: 'null' }] },
  reviewStatus: choice('open', 'closed'), checkedAt: { type: 'string', format: 'date-time' } });
const base = { original, ...semantics, readOnly: { type: 'boolean', const: true },
  businessExecution: choice('not_attempted'), source, currentReview };
const observationObject = (properties: Record<string, AiLeafSchemaDraft>) => object(properties,
  Object.keys(properties).filter(name => name !== 'currentReview'));
const result = { resultId: id(), stepId: id(), callId: id() };
export const AI_AUTOMATION_EXPLANATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiAutomationExplanationReadDraft: object({ inputRef: uuid }),
  AiAutomationExplanationPreparationDraft: object({ version: choice('automation-explanation-preparation-1'), original,
    bindingHash: hash, sourceHash: hash, policyHash: hash, event: ref('AiBusinessEventDraft'),
    inputMode: choice('shadow', 'manual_confirmation'), expiresAt: { type: 'string', format: 'date-time' }, ...semantics }),
  AiAutomationExplanationStartDraft: object({ inputRef: uuid, decision: choice('start_original_automation_explanation'),
    preparation: ref('AiAutomationExplanationPreparationDraft') }),
  AiAutomationExplanationObservationDraft: { oneOf: [
    observationObject({ ...base, state: choice('not_started', 'unknown'), result: { type: 'null' } }),
    observationObject({ ...base, state: choice('failed'), result: object({ ...result,
      errorCode: { oneOf: [text(64), { type: 'null' }] } }) }),
    observationObject({ ...base, state: choice('completed'), result: object({ ...result, text: text(131072, 0),
      semantics: choice('model_explanation_not_core_fact_or_handling_receipt') }) }),
  ] },
};
