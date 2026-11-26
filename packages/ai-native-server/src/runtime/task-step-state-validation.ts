/** Validate the same C04 state shape before using a registered tool code.
 * The host separately owns the catalogue and current action authority. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_EXECUTION_CONTEXT_SCHEMAS } from '@rental-os/platform-contracts/ai-gateway';
import { AI_TASK_FACT_SCHEMA, createAiStepDraftSchemas, type AiStepStateDraft } from '@rental-os/platform-contracts/ai-task';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const schemas = { ...AI_EXECUTION_CONTEXT_SCHEMAS, AiFactReference: AI_TASK_FACT_SCHEMA, ...createAiStepDraftSchemas() };
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'urn:zelo:ai-step:')), `urn:zelo:ai-step:${name}`);
}
const validate = ajv.getSchema<AiStepStateDraft>('urn:zelo:ai-step:AiStepStateDraft')!;

export function isPublicAiStepState(value: unknown): value is AiStepStateDraft { return validate(value) === true; }
