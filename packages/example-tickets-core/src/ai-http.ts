/** 工单可选任务的浏览器安全合同；HTTP、OpenAPI与页面共用，无Runtime/Node依赖。
 * schema只校验传输形状，原输入摘要、当前身份、批准与执行权继续由服务端核定。
 */
import { z } from "zod";
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT } from "@rental-os/platform-contracts/ai-task";
import { ChangeTicketStateSchema, TicketIdSchema, TicketSchema } from "./contracts";
import { TicketReceiptSchema } from "./http";
import { TicketAiRouteStateSchema } from "./ai-status";

const ref = z.string().uuid(), revision = z.number().int().min(1).max(4294967295), textHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const TicketsStartOriginalSchema = z.object({ version: z.literal("example-tickets-start-1"),
  principal: z.object({ tenantId: TicketIdSchema, subjectId: TicketIdSchema, audience: z.literal("operator") }).strict(),
  command: ChangeTicketStateSchema, fact: TicketSchema }).strict().superRefine((value, context) => {
    if (value.fact.tenantId !== value.principal.tenantId || value.fact.id !== value.command.ticketId
      || value.fact.revision !== value.command.expectedRevision)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "工单原输入与受权事实不一致" });
  });
export const TicketsStartBindingDataSchema = z.object({
  source: z.object({ recordId: ref, revision: z.number().int().positive().max(4294967294), contentHash: textHash }).strict(),
  original: TicketsStartOriginalSchema }).strict();
const taskRef = z.object({ taskId: ref }).strict(), sourceRef = z.object({ inputRef: ref }).strict();
export const TicketsAiDecisionSchema = taskRef.extend({ proposalId: ref, proposalRevision: z.literal(1),
  reviewedPayloadHash: textHash, decision: z.enum(["approved", "rejected"]) }).strict();
export const TicketsAiRunCommandSchema = taskRef.extend({ runId: ref, expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
export const TICKETS_AI_TASK_INPUTS = {
  status: z.object({ ticketId: TicketIdSchema, taskId: ref.optional() }).strict(),
  prepareInput: ChangeTicketStateSchema, originalInput: z.object({ operationId: TicketIdSchema }).strict(),
  createTask: sourceRef, originalTask: sourceRef, prepareApproval: TicketsAiRunCommandSchema,
  approval: taskRef, decide: TicketsAiDecisionSchema, execute: TicketsAiRunCommandSchema,
  observeInterrupted: TicketsAiRunCommandSchema, result: taskRef
} as const;
export type TicketsAiTaskAction = keyof typeof TICKETS_AI_TASK_INPUTS;
const originalTask = z.discriminatedUnion("state", [
  z.object({ state: z.literal("observed"), creationKey: z.string(), retryable: z.literal(false), nextAction: z.literal("read_original_task"),
    task: z.object({ taskId: ref, runId: ref, status: z.enum(AI_TASK_STATUSES_DRAFT), revision, replayed: z.boolean() }).strict() }).strict(),
  z.object({ state: z.literal("not_observed"), creationKey: z.string(), retryable: z.literal(false), nextAction: z.literal("reconcile"), task: z.null() }).strict(),
  z.object({ state: z.literal("unknown"), creationKey: z.string(), retryable: z.literal(false), nextAction: z.literal("reconcile"), task: z.null() }).strict()
]);
const approval = z.object({ taskId: ref, proposalId: ref, proposalRevision: z.literal(1), payloadHash: textHash,
  status: z.enum(["NOT_OBSERVED", "PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED"]), original: TicketsStartOriginalSchema,
  decision: z.object({ approvalId: ref, decision: z.enum(["approved", "rejected"]), issuedAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict().nullable(),
  retryable: z.literal(false), executionGranted: z.literal(false) }).strict();
const counts = { completedSteps: z.number().int().nonnegative(), cleanupFailed: z.number().int().nonnegative() };
const outcome = z.union([
  z.object({ status: z.enum(["succeeded", "partially_succeeded", "paused", "cancel_requested", "cancelled", "unknown"]), ...counts }).strict(),
  z.object({ status: z.literal("unavailable"), ...counts, stopReason: z.literal("input_limit_reached").optional(), nextAction: z.literal("manual_handoff").optional() }).strict(),
  z.object({ status: z.literal("failed"), ...counts, errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u) }).strict()
]);
const result = z.object({ taskId: ref, runId: ref, taskStatus: z.enum(AI_TASK_STATUSES_DRAFT), taskRevision: revision,
  runStatus: z.enum(AI_TASK_STATUSES_DRAFT), runRevision: revision, operationId: TicketIdSchema, ticketId: TicketIdSchema,
  step: z.object({ stepId: ref, status: z.enum(AI_STEP_STATUSES_DRAFT), effect: z.enum(["none", "possible", "committed"]), revision, resultId: ref.nullable() }).strict().nullable(),
  approvalConsumption: z.enum(["not_observed", "reserved", "committed", "unknown", "failed_no_effect"]),
  business: z.enum(["committed", "not_confirmed"]), originalReceipt: TicketReceiptSchema.nullable(),
  resources: z.array(z.object({ kind: z.enum(["steps", "calls", "active_ms", "output_bytes"]), maximum: z.string().regex(/^[1-9][0-9]*$/u),
    consumed: z.string().regex(/^(0|[1-9][0-9]*)$/u), reserved: z.string().regex(/^(0|[1-9][0-9]*)$/u) }).strict()).length(4).nullable(),
  retryable: z.literal(false), execution: z.literal("not_invoked"), taskReconciliationRequired: z.boolean(),
  result: z.object({ resultId: ref, status: z.enum(["succeeded", "failed", "unknown"]), errorCode: z.string().nullable(),
    completeMeasurement: z.boolean(), observedAt: z.string().datetime() }).strict().nullable() }).strict();
export const TICKETS_AI_TASK_RESPONSES = { status: TicketAiRouteStateSchema, prepareInput: TicketsStartBindingDataSchema,
  originalInput: z.object({ binding: TicketsStartBindingDataSchema.nullable(), retryable: z.literal(false), absence: z.literal("not_proof_of_no_commit") }).strict(),
  createTask: originalTask, originalTask, prepareApproval: approval, approval, decide: approval, execute: outcome, observeInterrupted: outcome, result } as const;
export const TICKETS_AI_TASK_HTTP = Object.fromEntries(Object.entries(TICKETS_AI_TASK_INPUTS).map(([action, body]) =>
  [action, { path: `/ai/${action}`, body, response: TICKETS_AI_TASK_RESPONSES[action as TicketsAiTaskAction] }])) as {
    [Action in TicketsAiTaskAction]: { path: string; body: typeof TICKETS_AI_TASK_INPUTS[Action]; response: typeof TICKETS_AI_TASK_RESPONSES[Action] }
  };
export type TicketsAiTaskResponses = { [Action in TicketsAiTaskAction]: z.infer<typeof TICKETS_AI_TASK_RESPONSES[Action]> };
