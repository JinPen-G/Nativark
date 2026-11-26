/** Original C04 Step shapes. Business tool codes are fixed by the host's
 * registered catalogue and checked again at the persistence boundary. */
import { AI_ERROR_CODES } from './ai-task';
import { leafClosed as closed, leafEnum as choice, leafId as id, leafList,
  leafRef as ref, leafInt, type AiLeafSchemaDraft } from './ai-leaf-schema';

const revision = leafInt(1, Number.MAX_SAFE_INTEGER);
const list = (items: AiLeafSchemaDraft, maxItems: number, minItems = 0) => leafList(items, maxItems, minItems);
const timestamp: AiLeafSchemaDraft = { type: 'string', format: 'date-time' };
const errorProperties = {
  message: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" } as AiLeafSchemaDraft,
  missingFields: { ...list({ type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z][A-Za-z0-9_.\\[\\]-]*$" }, 32), uniqueItems: true }
};
const unknownError = closed({ ...errorProperties, code: choice("AI_RESULT_UNKNOWN"), retryable: { type: "boolean", enum: [false] }, nextAction: choice("reconcile") });
const knownError = closed({ ...errorProperties, code: choice(...AI_ERROR_CODES.filter(code => code !== "AI_RESULT_UNKNOWN")), retryable: { type: "boolean" }, nextAction: choice("none", "clarify", "reconfirm", "reauthorize", "reconcile", "retry_later", "manual") });

export const AI_TASK_FACT_SCHEMA = closed({
    scope: ref("AiExecutionScope"), resourceType: choice("order", "quote", "configuration", "report", "inspection", "knowledge"),
    resourceId: id(), observedAt: timestamp,
    basis: { oneOf: [
      closed({ kind: choice("current") }),
      closed({ kind: choice("snapshot"), version: id() }),
      closed({ kind: choice("missing"), reason: choice("snapshot_missing", "source_unavailable") }),
      closed({ kind: choice("legacy_current_fallback"), reason: choice("snapshot_missing") })
    ] }
});

export function createAiStepDraftSchemas(toolCode: AiLeafSchemaDraft = id()): Record<'AiStepStateDraft' | 'AiStepOutcomeDraft', AiLeafSchemaDraft> {
  return {
    AiStepOutcomeDraft: { oneOf: [
      closed({ status: choice("pending", "cancelled"), effect: choice("none") }),
      closed({ status: choice("running"), effect: choice("none", "possible") }),
      closed({ status: choice("succeeded"), effect: choice("none"), facts: list(ref("AiFactReference"), 64) }),
      closed({ status: choice("succeeded"), effect: choice("committed"), facts: list(ref("AiFactReference"), 64, 1) }),
      closed({ status: choice("failed"), effect: choice("none"), error: knownError }),
      closed({ status: choice("unknown"), effect: choice("possible"), error: unknownError })
    ] },
    AiStepStateDraft: closed({
      stepId: id(), runId: id(), sequence: revision, revision, toolCode, toolVersion: id(),
      actionId: id(), requestFingerprint: { type: "string", minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" },
      outcome: ref("AiStepOutcomeDraft")
    }),
  };
}
