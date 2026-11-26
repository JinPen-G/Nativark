/** Validate the original public context schema without loading business/tool
 * catalogues. Shape validity never establishes current identity or permission. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_EXECUTION_CONTEXT_SCHEMAS, type AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries(AI_EXECUTION_CONTEXT_SCHEMAS)) {
  ajv.addSchema(JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'urn:zelo:ai-context:')),
    `urn:zelo:ai-context:${name}`);
}
const validate = ajv.getSchema<AiExecutionContext>('urn:zelo:ai-context:AiExecutionContext')!;
export function isAiStepExecutionContext(value: unknown): value is AiExecutionContext { return validate(value) === true; }
