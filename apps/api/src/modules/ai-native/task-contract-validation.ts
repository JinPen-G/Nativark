import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { AiExecutionContext, AiStepStateDraft, AiTaskMetadataPageDraft,
  AiTaskSnapshotDraft, AiTaskEventPageDraft, AiTaskEventResetDraft } from "@rental-os/shared";
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

type Observations = { AiTaskMetadataPageDraft: AiTaskMetadataPageDraft; AiTaskSnapshotDraft: AiTaskSnapshotDraft;
  AiTaskEventsObservationDraft: AiTaskEventPageDraft | AiTaskEventResetDraft };
/** Closed wire observations only. No field stripping, lease claim or retry grant. */
export function validateAiTaskObservation<K extends keyof Observations>(name: K, value: unknown): Observations[K] {
  try {
    const copy = structuredClone(value), validate = ajv.getSchema(`urn:rental:step:${name}`);
    if (validate?.(copy)) return copy as Observations[K];
  } catch { /* malformed producer content and parser details stay internal */ }
  throw Object.assign(new Error('AI_STORAGE_UNAVAILABLE'), { code: 'AI_STORAGE_UNAVAILABLE', retryable: false });
}
