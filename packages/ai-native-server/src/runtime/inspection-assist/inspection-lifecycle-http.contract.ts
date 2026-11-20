/** Validation for the existing recognition/submission transport. Never executes
 * a model, chooses human values or creates a business receipt. A corrupt reply
 * after a possible write remains unknown and must use the original read path. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS, AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS,
  AI_INSPECTION_MANUAL_HTTP_SCHEMAS, AI_INSPECTION_DRAFT_SCHEMAS,
  type AiInspectionLifecycleHttpRequests, type AiInspectionLifecycleHttpResponses,
  type AiInspectionPrepareSubmissionRequest, type AiInspectionOperationResult } from '@rental-os/shared';
import { InspectionAssistError } from './inspection-assist.validation';
import { snapshotInspectionCandidates } from './inspection-candidate.service';

type Action = keyof typeof AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const definitions = { ...AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS,
  ...Object.fromEntries(['AiInspectionDraftReadRequest', 'AiStaffInspectionSavedReference', 'AiInspectionRecognitionBasisReference']
    .map(name => [name, AI_INSPECTION_MANUAL_HTTP_SCHEMAS[name]])),
  ...Object.fromEntries(['AiInspectionCandidateDraft', 'AiInspectionSourceDraft', 'AiInspectionValueDraft']
    .map(name => [name, AI_INSPECTION_DRAFT_SCHEMAS[name]])) };
for (const [name, schema] of Object.entries(definitions)) ajv.addSchema(schema, `#/components/schemas/${name}`);
const contracts = Object.fromEntries(Object.entries(AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS).map(([action, names]) => [action, {
  request: ajv.getSchema(`#/components/schemas/${names.request}`)!, response: ajv.getSchema(`#/components/schemas/${names.response}`)!,
}]));
export const isInspectionLifecycleAction = (action: string): action is Action => Object.hasOwn(AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS, action);
export function inspectionLifecycleRequest<A extends Action>(action: A, value: unknown): AiInspectionLifecycleHttpRequests[A] {
  try {
    const copy = structuredClone(value);
    // Original input producer trims the human question before hashing it.
    if ((action === 'input-prepare' || action === 'input-receipt') && copy && typeof copy === 'object'
      && 'question' in copy && typeof copy.question === 'string') copy.question = copy.question.trim();
    if (!contracts[action].request(copy)) throw Error();
    return copy as AiInspectionLifecycleHttpRequests[A];
  } catch { throw new InspectionAssistError('INVALID_INPUT'); }
}
const receiptMatches = (receipt: AiInspectionOperationResult, command: { draftId: string; expectedRevision: number }) => {
  if (receipt.draftId !== command.draftId || receipt.revision !== command.expectedRevision + 1) throw Error();
};
export function inspectionLifecycleResponse<A extends Action>(action: A, value: unknown,
  command: AiInspectionLifecycleHttpRequests[A]): AiInspectionLifecycleHttpResponses[A] {
  try {
    const copy = structuredClone(value) as AiInspectionLifecycleHttpResponses[Action];
    if (!contracts[action].response(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 262144) throw Error();
    if (action === 'input-prepare') receiptMatches(copy as AiInspectionLifecycleHttpResponses['input-prepare'],
      command as AiInspectionLifecycleHttpRequests['input-prepare']);
    if (action === 'input-receipt' || action === 'result-save') {
      const result = copy as AiInspectionLifecycleHttpResponses['input-receipt'] | AiInspectionLifecycleHttpResponses['result-save'];
      if ('result' in result) receiptMatches(result.result, command as AiInspectionLifecycleHttpRequests['result-save']);
    }
    if (action === 'result-read') {
      const result = copy as AiInspectionLifecycleHttpResponses['result-read'];
      const expected = command as AiInspectionLifecycleHttpRequests['result-read'];
      for (const key of ['orderId', 'allocationId', 'stage', 'templateId', 'draftId', 'inputId', 'expectedRevision', 'taskId', 'resultId'] as const)
        if (result[key] !== expected[key]) throw Error();
      snapshotInspectionCandidates(result.candidates);
      if (result.status === 'available') {
        const kind = result.recognitionEvidence === 'persisted_audio_step' ? 'audio' : 'image';
        if (result.candidates.some(candidate => candidate.sources.some(source => source.kind !== kind))) throw Error();
      }
    }
    if (action === 'submission-prepare' || action === 'submission-review') {
      const result = copy as AiInspectionLifecycleHttpResponses['submission-prepare'];
      receiptMatches(result, command as AiInspectionPrepareSubmissionRequest);
      if (result.mode !== (action === 'submission-review' ? 'manual_review_only' : 'original_single')) throw Error();
    }
    if (action === 'submission-preparation') {
      const result = copy as AiInspectionLifecycleHttpResponses['submission-preparation'];
      const expected = command as AiInspectionLifecycleHttpRequests['submission-preparation'];
      if (result.status === 'found') {
        receiptMatches(result.result, expected.request);
        if (result.mode !== (expected.kind === 'prepareReview' ? 'manual_review_only' : 'original_single')) throw Error();
      }
    }
    if (action === 'submission-read' || action === 'submission-submit') {
      if ((copy as AiInspectionLifecycleHttpResponses['submission-read']).draftId
        !== (command as AiInspectionLifecycleHttpRequests['submission-read']).draftId) throw Error();
    }
    return copy as AiInspectionLifecycleHttpResponses[A];
  } catch {
    throw new InspectionAssistError(AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS[action].write ? 'RECONCILIATION_REQUIRED' : 'STORAGE_UNAVAILABLE');
  }
}
