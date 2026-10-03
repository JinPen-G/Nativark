import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { AiExecutionContext, AiStepStateDraft } from "@rental-os/shared";
import { AI_NATIVE_COMPONENT_SCHEMAS } from "../../contracts/ai-native-schemas";
import { AI_TASK_DRAFT_COMPONENT_SCHEMAS } from "../../contracts/ai-task-draft-schemas";

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
function localRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === "$ref" && typeof child === "string" ? child.replace(/^#\/components\/schemas\//u, "urn:rental:step:") : localRefs(child)]));
}
for (const [name, schema] of Object.entries({ ...AI_NATIVE_COMPONENT_SCHEMAS, ...AI_TASK_DRAFT_COMPONENT_SCHEMAS })) {
  ajv.addSchema(localRefs(schema) as object, `urn:rental:step:${name}`);
}
const step = ajv.getSchema<AiStepStateDraft>("urn:rental:step:AiStepStateDraft")!;
const context = ajv.getSchema<AiExecutionContext>("urn:rental:step:AiExecutionContext")!;

/** Validation only: a valid context or lifecycle record never grants execution permission. */
export function isAiStepState(value: unknown): value is AiStepStateDraft { return step(value) === true; }
export function isAiStepExecutionContext(value: unknown): value is AiExecutionContext { return context(value) === true; }
