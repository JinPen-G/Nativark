import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_GATEWAY_DRAFT_SCHEMAS, type AiGatewayIntentDraft, type AiGatewayResultDraft, type AiGatewayStreamEventDraft } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../contracts/ai-native-schemas';

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
function localRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === '$ref' && typeof child === 'string' ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:gateway:') : localRefs(child)]));
}
for (const [name, schema] of Object.entries({ ...AI_NATIVE_COMPONENT_SCHEMAS, ...AI_GATEWAY_DRAFT_SCHEMAS })) {
  ajv.addSchema(localRefs(schema) as object, `urn:rental:gateway:${name}`);
}
const intent = ajv.getSchema<AiGatewayIntentDraft>('urn:rental:gateway:AiGatewayIntentDraft')!;
const result = ajv.getSchema<AiGatewayResultDraft>('urn:rental:gateway:AiGatewayResultDraft')!;
const event = ajv.getSchema<AiGatewayStreamEventDraft>('urn:rental:gateway:AiGatewayStreamEventDraft')!;
const config = ajv.getSchema('urn:rental:gateway:AiGatewayConfigReferenceDraft')!;
export const isGatewayConfig = (value: unknown): boolean => config(value) === true;
export const isGatewayIntent = (value: unknown): value is AiGatewayIntentDraft => intent(value) === true;
export const isGatewayResult = (value: unknown): value is AiGatewayResultDraft => result(value) === true;
export const isGatewayEvent = (value: unknown): value is AiGatewayStreamEventDraft => event(value) === true;
