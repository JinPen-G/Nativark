/** Actual task-center detail consumer: bounded persisted events discover only
 * result references; the server's source-aware reader owns payload access.
 * No execution, automatic pagination, retry, or fallback to raw artifacts. */
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  type AiTaskSnapshotDraft, type AiTaskEventPageDraft, type AiTaskEventResetDraft,
  type AiTaskModelObservationDraft } from "@rental-os/shared";

type Reads = {
  snapshot(taskId: string, signal: AbortSignal): Promise<AiTaskSnapshotDraft>;
  events(taskId: string, after: string, signal: AbortSignal): Promise<AiTaskEventPageDraft | AiTaskEventResetDraft>;
  result(taskId: string, resultId: string, signal: AbortSignal): Promise<AiTaskModelObservationDraft>;
};
const cursor = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value);
const invalid = () => Error("AI_RESOURCE_UNAVAILABLE");

/** Shared validation for manual detail reads and the opt-in snapshot follower. */
export function validateTaskCenterSnapshot(value: AiTaskSnapshotDraft, taskId: string) {
  if (!value || value.contractVersion !== AI_TASK_DRAFT_VERSION || value.taskId !== taskId
    || !AI_TASK_STATUSES_DRAFT.includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !cursor(value.cursor) || !Array.isArray(value.steps) || value.steps.length > 1000
    || new Set(value.steps.map(step => step?.stepId)).size !== value.steps.length
    || value.steps.some(step => !step || typeof step.stepId !== "string" || typeof step.runId !== "string"
      || !AI_STEP_STATUSES_DRAFT.includes(step.status)
      || step.resultId !== undefined && (typeof step.resultId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(step.resultId)))) throw invalid();
  return value;
}

export async function readTaskCenterDetail(reads: Reads, taskId: string, signal: AbortSignal, current: () => boolean) {
  const check = () => { if (signal.aborted || !current()) throw Error("AI_SCOPE_CHANGED"); };
  const snapshot = async () => {
    check(); const value = await reads.snapshot(taskId, signal); check();
    return validateTaskCenterSnapshot(value, taskId);
  };
  const first = await snapshot();
  const events = await reads.events(taskId, "0", signal); check();
  if (!events || events.taskId !== taskId || events.contractVersion !== AI_TASK_DRAFT_VERSION) throw invalid();
  let result: AiTaskModelObservationDraft | null = null;
  let resultId: string | undefined;
  let coverage: "reset_required" | "first_page_only" | "retained_events";
  if ("status" in events) {
    if (events.status !== "reset_required") throw invalid();
    coverage = "reset_required";
  } else {
    coverage = events.hasMore ? "first_page_only" : "retained_events";
    if (!Array.isArray(events.events) || events.events.length > 50 || !cursor(events.nextCursor) || typeof events.hasMore !== "boolean") throw invalid();
    let previous = 0n;
    for (const event of events.events) {
      if (!event || event.taskId !== taskId || event.contractVersion !== AI_TASK_DRAFT_VERSION || !cursor(event.cursor)
        || BigInt(event.cursor) <= previous || BigInt(event.cursor) > BigInt(first.cursor)) throw invalid();
      if (event.type === "access.revoked") throw Error("AI_ACCESS_DENIED");
      previous = BigInt(event.cursor);
    }
    if (previous.toString() !== events.nextCursor) throw invalid();
    const output = events.events.filter(event => event.type === "task.output_ready").at(-1);
    if (output?.type === "task.output_ready") resultId = output.data.resultId;
  }
  // Existing completed tasks predate output-ready publication. A unique stored
  // model reference can still be re-authorized; do not invent/backfill events
  // or guess which result is current when several are present.
  const persisted = [...new Set(first.steps.flatMap(step => step.resultId ? [step.resultId] : []))];
  resultId ??= persisted.length === 1 ? persisted[0] : undefined;
  if (["order_explanation", "opening_diagnosis", "quote_clarification"].includes(first.sceneCode) && resultId) {
    try { result = await reads.result(taskId, resultId, signal); }
    catch (error) {
      // A formally unavailable result is not a successful/empty answer.
      // Never downgrade access, context, storage or uncertain-result errors.
      const failure = error as { response?: { status?: number; data?: { code?: string } } };
      if (failure.response?.status !== 404 || failure.response?.data?.code !== "AI_RESOURCE_UNAVAILABLE") throw error;
    }
    check();
    if (result && (result.contractVersion !== AI_TASK_DRAFT_VERSION || result.taskId !== taskId || result.resultId !== resultId
      || result.sceneCode !== first.sceneCode || !["available", "stale", "unknown", "failed"].includes(result.status)
      || result.execution !== "read_only_no_start_no_reconnect_side_effect" || result.businessExecution !== "not_inferred_from_model_result"
      || !Array.isArray(result.sources) || result.sources.length > 9
      || result.sources.some(source => !source || !['order', 'knowledge'].includes(source.kind)
        || !Number.isInteger(source.index) || source.index < 0 || source.index > 4 || !/^[a-f0-9]{64}$/u.test(source.referenceHash))
      || new Set(result.sources.map(source => `${source.kind}:${source.index}`)).size !== result.sources.length
      || result.status !== 'available' && result.sources.length !== 0
      || result.status === "available" && (!result.text || typeof result.text.value !== "string"
        || result.text.value.length > 131072 || result.text.trust !== "unverified_model_text_not_execution_evidence")
      || result.status !== "available" && result.text !== null)) throw invalid();
  }
  const latest = await snapshot();
  if (latest.revision !== first.revision || latest.cursor !== first.cursor) throw Error("AI_REVISION_CONFLICT");
  return { snapshot: latest, coverage, result };
}
