import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_QUOTE_SELECTION_DRAFT_SCHEMAS, type AiQuoteSelectionCreateDraft, type AiQuoteSelectionReadDraft,
  type AiClarifiedQuoteSelectionRequestDraft, type AiQuoteSelectionProofDraft,
  type AiQuoteSelectionSelectResponseDraft, type AiQuoteSelectionReconcileResponseDraft, type AiQuoteSelectionReceiptDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from './original-request.validation';
import { HttpException } from '@nestjs/common';

export type AiQuoteSelectionProofRequest = AiQuoteSelectionProofDraft;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const create = ajv.compile<AiQuoteSelectionCreateDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionCreateDraft);
const read = ajv.compile<AiQuoteSelectionReadDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionReadDraft);
const proof = ajv.compile<AiQuoteSelectionProofRequest>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionProofRequest);
const clarified = ajv.compile<AiClarifiedQuoteSelectionRequestDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiClarifiedQuoteSelectionRequestDraft);
type QuoteSelectionResponses = { AiQuoteSelectionSelectResponseDraft: AiQuoteSelectionSelectResponseDraft;
  AiQuoteSelectionReconcileResponseDraft: AiQuoteSelectionReconcileResponseDraft;
  AiQuoteSelectionReceiptDraft: AiQuoteSelectionReceiptDraft };
const responseNames = ['AiQuoteSelectionSelectResponseDraft', 'AiQuoteSelectionReconcileResponseDraft', 'AiQuoteSelectionReceiptDraft'] as const;
const responseDefinitions = JSON.parse(JSON.stringify(Object.fromEntries(responseNames
  .map(name => [name, AI_QUOTE_SELECTION_DRAFT_SCHEMAS[name]]))).replaceAll('#/components/schemas/', '#/$defs/'));
const responseValidators = Object.fromEntries(responseNames.map(name => [name,
  ajv.compile({ $ref: `#/$defs/${name}`, $defs: responseDefinitions })]));
/** A malformed saved-selection reply may follow COMMIT; only the original
 * selection command can observe it. Validation does not strip extra fields. */
export function validateQuoteSelectionResponse<K extends keyof QuoteSelectionResponses>(name: K, value: unknown, mayHaveCommitted = false): QuoteSelectionResponses[K] {
  try {
    const snapshot = structuredClone(value);
    const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item)
      : item && typeof item === 'object' ? Object.values(item).every(finite) : true;
    if (finite(snapshot)) {
      const wire = JSON.parse(JSON.stringify(snapshot));
      if (responseValidators[name](wire)) return wire as QuoteSelectionResponses[K];
    }
  } catch { /* never expose malformed producer content */ }
  if (mayHaveCommitted) throw new HttpException({ code: 'AI_RESULT_UNKNOWN' }, 409);
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
export function parseClarifiedQuoteSelection(value: unknown) {
  if (!clarified(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelection(value: unknown) {
  if (!create(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 32768
    || Date.parse(value.order.endAt) <= Date.parse(value.order.startAt)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelectionRead(value: unknown) {
  if (!read(value)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelectionProof(value: unknown) {
  if (!proof(value)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
