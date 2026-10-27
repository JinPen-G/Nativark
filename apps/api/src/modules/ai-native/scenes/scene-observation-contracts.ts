/** Closed projections of existing authorized scene readers. Validation does not
 * read business data, authorize a caller, claim a lease or infer execution. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS, AI_SCENE_MODEL_OBSERVATION_SCHEMAS,
  AI_KNOWLEDGE_DRAFT_SCHEMAS, AI_TASK_SCENE_OBSERVATION_SCHEMAS, AI_TASK_OBSERVATION_DRAFT_SCHEMAS,
  AI_ORDER_FACTS_DRAFT_SCHEMAS, AI_QUOTE_SELECTION_DRAFT_SCHEMAS, AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS,
  AI_PROPOSAL_DRAFT_SCHEMAS, AI_APPROVED_SETTINGS_DRAFT_SCHEMAS, AI_TASK_RECOVERY_HTTP_SCHEMAS,
  AI_TASK_INPUT_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  type AiSceneModelResultObservationDraft, type AiTaskSceneObservationDraft } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const definitions = JSON.parse(JSON.stringify({ ...AI_NATIVE_COMPONENT_SCHEMAS,
  ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS,
  ...AI_KNOWLEDGE_DRAFT_SCHEMAS, ...AI_TASK_SCENE_OBSERVATION_SCHEMAS, ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS,
  ...AI_ORDER_FACTS_DRAFT_SCHEMAS, ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS, ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS,
  ...AI_PROPOSAL_DRAFT_SCHEMAS, ...AI_APPROVED_SETTINGS_DRAFT_SCHEMAS, ...AI_TASK_RECOVERY_HTTP_SCHEMAS,
  ...AI_TASK_INPUT_DRAFT_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const model = ajv.compile<AiSceneModelResultObservationDraft>({ $ref: '#/$defs/AiSceneModelResultObservationDraft', $defs: definitions });
const scene = ajv.compile<AiTaskSceneObservationDraft>({ $ref: '#/$defs/AiTaskSceneObservationDraft', $defs: definitions });

/** Original materialHash refers to the frozen call input, not current facts.
 * Only the retained knowledge snapshot has an observation-stable hash. */
export function validateAiSceneModelObservation(value: unknown): AiSceneModelResultObservationDraft {
  try {
    const copy = structuredClone(value);
    if (model(copy) && (copy.status !== 'available'
      || (Buffer.byteLength(copy.text.value, 'utf8') <= 131072
        && (!copy.knowledge || (Buffer.byteLength(JSON.stringify(copy.knowledge.material), 'utf8') <= 16384
          && requestFingerprint(copy.knowledge.material) === copy.knowledge.contentHash))))) return copy;
  } catch { /* model text and producer details stay internal on malformed output */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}

export function validateAiTaskSceneObservation(value: unknown): AiTaskSceneObservationDraft {
  try {
    const copy = structuredClone(value);
    if (scene(copy)) {
      if (copy.kind === 'original' && 'status' in copy.model) validateAiSceneModelObservation(copy.model);
      return copy;
    }
  } catch { /* undeclared nested data must not escape a failed aggregate */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
