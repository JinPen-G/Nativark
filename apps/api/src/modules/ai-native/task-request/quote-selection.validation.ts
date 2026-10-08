import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_QUOTE_SELECTION_DRAFT_SCHEMAS } from '../../../../../../packages/shared/src/ai-quote-selection-draft-schemas';
import type { AiQuoteSelectionCreateDraft, AiQuoteSelectionReadDraft } from '../../../../../../packages/shared/src/ai-quote-selection-draft';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from './original-request.validation';

export type AiQuoteSelectionProofRequest = AiQuoteSelectionReadDraft & { taskId: string; runId: string; inputHash: string };
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const create = ajv.compile<AiQuoteSelectionCreateDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionCreateDraft);
const read = ajv.compile<AiQuoteSelectionReadDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionReadDraft);
const proof = ajv.compile<AiQuoteSelectionProofRequest>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionProofRequest);
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
