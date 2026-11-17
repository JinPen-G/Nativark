/** Wire boundary for original manual drafts, template/host reads and immutable
 * receipts. Authority and Core validation stay in the original services; this
 * neither adopts candidates nor grants submission. Bad writes remain unknown. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_INSPECTION_MANUAL_HTTP_CONTRACTS, AI_INSPECTION_MANUAL_HTTP_SCHEMAS, AI_INSPECTION_DRAFT_SCHEMAS,
  type AiInspectionManualHttpRequests, type AiInspectionManualHttpResponses, type AiInspectionOperationResult,
  type AiInspectionDraftReadRequest, type AiInspectionOriginalOperationRequest, type AiInspectionTarget } from '@rental-os/shared';
import { InspectionAssistError, inspectionId } from './inspection-assist.validation';
import { snapshotInspectionCandidates } from './inspection-candidate.service';
import { createHash } from 'node:crypto';

type Action = keyof typeof AI_INSPECTION_MANUAL_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const definitions = { ...AI_INSPECTION_MANUAL_HTTP_SCHEMAS,
  ...Object.fromEntries(['AiInspectionCandidateDraft', 'AiInspectionSourceDraft', 'AiInspectionValueDraft']
    .map(name => [name, AI_INSPECTION_DRAFT_SCHEMAS[name]])) };
for (const [name, schema] of Object.entries(definitions)) ajv.addSchema(schema, `#/components/schemas/${name}`);
const contracts = Object.fromEntries(Object.entries(AI_INSPECTION_MANUAL_HTTP_CONTRACTS).map(([action, names]) => [action, {
  request: ajv.getSchema(`#/components/schemas/${names.request}`)!, response: ajv.getSchema(`#/components/schemas/${names.response}`)!,
}]));
export const isInspectionManualAction = (action: string): action is Action => Object.hasOwn(AI_INSPECTION_MANUAL_HTTP_CONTRACTS, action);
const fieldKeys = (value: object) => {
  if (Object.keys(value).some(code => !inspectionId.safeParse(code).success)) throw Error();
};
export function inspectionManualRequest<A extends Action>(action: A, value: unknown): AiInspectionManualHttpRequests[A] {
  try {
    const copy = structuredClone(value) as AiInspectionManualHttpRequests[Action];
    if (!contracts[action].request(copy)) throw Error();
    const command = action === 'draft-operation' ? (copy as AiInspectionOriginalOperationRequest).request : copy;
    if ('results' in command) {
      if (!command.results || typeof command.results !== 'object' || Array.isArray(command.results)) throw Error();
      fieldKeys(command.results);
    }
    if ('candidates' in command) {
      if (!Array.isArray(command.candidates)) throw Error();
      snapshotInspectionCandidates(command.candidates);
    }
    return copy as AiInspectionManualHttpRequests[A];
  } catch { throw new InspectionAssistError('INVALID_INPUT'); }
}
const sameTarget = (expected: AiInspectionTarget, actual: AiInspectionTarget) => {
  if (['orderId', 'allocationId', 'templateId', 'stage'].some(key => expected[key as keyof AiInspectionTarget] !== actual[key as keyof AiInspectionTarget])) throw Error();
};
const receiptFor = (receipt: AiInspectionOperationResult, expected: { draftId?: string; expectedRevision?: number }, create = false) => {
  if (expected.draftId && receipt.draftId !== expected.draftId
    || receipt.revision !== (create ? 1 : expected.expectedRevision! + 1)
    || receipt.status !== 'draft_saved' || receipt.inspectionId !== null) throw Error();
};
export function inspectionManualResponse<A extends Action>(action: A, value: unknown,
  command: AiInspectionManualHttpRequests[A]): AiInspectionManualHttpResponses[A] {
  try {
    const copy = structuredClone(value) as AiInspectionManualHttpResponses[A];
    // Stored draft state is already capped at 240000 bytes by its repository.
    // Templates can legitimately carry 100 fields x 100 options; do not apply
    // the much smaller draft limit to that separately bounded projection.
    // Current candidate reviews sit beside the bounded stored state; do not
    // reject a previously valid draft merely because its review was refreshed.
    const maxBytes = action === 'template-read' ? 16777216 : action === 'draft-read' ? 524288 : 262144;
    if (!contracts[action].response(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > maxBytes) throw Error();
    if (action === 'template-read') {
      const result = copy as AiInspectionManualHttpResponses['template-read'];
      sameTarget(command as AiInspectionTarget, { ...result, templateId: result.template.id });
      if (result.template.tenantId !== result.scope.tenantId || result.template.stage !== result.stage
        || result.template.allocationIds && !result.template.allocationIds.includes(result.allocationId)
        || new Set(result.template.fields.map(field => field.code)).size !== result.template.fields.length) throw Error();
      const { bindingFingerprint, status: _status, semantics: _semantics, ...binding } = result;
      if (createHash('sha256').update(JSON.stringify(binding)).digest('hex') !== bindingFingerprint) throw Error();
    }
    if (action === 'history-read') {
      const result = copy as AiInspectionManualHttpResponses['history-read'];
      const expected = command as AiInspectionManualHttpRequests['history-read'];
      if (result.items.length > expected.limit || result.items.some(item => item.target.orderId !== expected.orderId
        || item.target.stage !== expected.stage || item.recognitionSaves.some(saved => {
          sameTarget(item.target, saved);
          return saved.draftId !== item.draftId;
        }))) throw Error();
    }
    if (action === 'receipt-host-read') {
      const result = copy as AiInspectionManualHttpResponses['receipt-host-read'];
      const expected = command as AiInspectionManualHttpRequests['receipt-host-read'];
      sameTarget(expected, result.target);
      if (result.draftId !== expected.draftId || result.capabilities.recognitionReceipt !== (result.recognitionSave !== null)) throw Error();
      if (result.recognitionSave) {
        if (!expected.recognitionSave) throw Error();
        for (const [key, value] of Object.entries(expected.recognitionSave))
          if (result.recognitionSave[key as keyof typeof result.recognitionSave] !== value) throw Error();
      }
    }
    if (action === 'host-read' || action === 'draft-read') {
      const result = copy as AiInspectionManualHttpResponses['host-read'] | AiInspectionManualHttpResponses['draft-read'];
      const expected = command as AiInspectionDraftReadRequest;
      sameTarget(expected, result.target);
      if (expected.draftId !== result.draftId) throw Error();
      if ('state' in result) {
        if (result.bodyRetention && (result.state.candidates.length || result.state.recognitionInputs !== undefined
          || !result.state.reviewRequired || new Set(result.bodyRetention.candidateRefs.map(ref => ref.candidateId)).size !== result.bodyRetention.candidateRefs.length
          || new Set(result.bodyRetention.inputRefs.map(ref => ref.inputId)).size !== result.bodyRetention.inputRefs.length
          || Object.entries(result.state.fields).some(([code, field]) => field.candidateId
            && !result.bodyRetention!.candidateRefs.some(ref => ref.candidateId === field.candidateId && ref.fieldCode === code)))) throw Error();
        fieldKeys(result.state.fields);
        if (result.state.submission) fieldKeys(result.state.submission.body.results);
        snapshotInspectionCandidates(result.state.candidates);
        if (result.candidateReviews.length !== result.state.candidates.length
          || new Set(result.candidateReviews.map(review => review.candidateId)).size !== result.candidateReviews.length) throw Error();
        for (const review of result.candidateReviews) {
          const candidate = result.state.candidates.find(item => item.candidateId === review.candidateId);
          if (!candidate || review.basisIssues.some(issue => issue.fieldCode !== candidate.fieldCode)
            || review.reviewIssues.length !== new Set(review.basisIssues.map(issue => issue.code)).size
            || review.basisIssues.some(issue => !review.reviewIssues.includes(issue.code))
            || review.adoption === 'human_confirmation_required' && (candidate.status !== 'candidate'
              || review.basis.status !== 'recorded' || review.basisIssues.length || !review.sourcesMatchDraftEvidence
              || !['draft_saved', 'prepared'].includes(result.status))) throw Error();
        }
      }
    }
    if (action === 'evidence-bind' && (copy as AiInspectionManualHttpResponses['evidence-bind']).attachmentId
      !== (command as AiInspectionManualHttpRequests['evidence-bind']).attachmentId) throw Error();
    if (action === 'draft-create' || action === 'draft-edit' || action === 'evidence-replace') {
      receiptFor(copy as AiInspectionOperationResult, command as { draftId?: string; expectedRevision?: number }, action === 'draft-create');
    }
    if (action === 'draft-operation' || action === 'result-save-receipt') {
      const result = copy as AiInspectionManualHttpResponses['draft-operation'];
      if (result.status === 'found') {
        if (action === 'draft-operation') {
          const expected = command as AiInspectionOriginalOperationRequest;
          if (expected.kind === 'create') receiptFor(result.result, {}, true);
          else receiptFor(result.result, expected.request);
        } else receiptFor(result.result, command as AiInspectionManualHttpRequests['result-save-receipt']);
      }
    }
    return copy;
  } catch {
    throw new InspectionAssistError(AI_INSPECTION_MANUAL_HTTP_CONTRACTS[action].write ? 'RECONCILIATION_REQUIRED' : 'STORAGE_UNAVAILABLE');
  }
}
