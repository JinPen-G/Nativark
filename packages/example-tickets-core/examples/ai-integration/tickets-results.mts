/** 当前身份下读取同一Task、C05消费和工单原收据。只有原事实可证明提交；
 * 不创建任务/租约、不补写artifact、不把计量unknown当回滚或重发许可。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import { aiStepActionId } from "@rental-os/ai-native-server/task-steps";
import type { createPublicAiTaskPersistence } from "@rental-os/ai-native-server/task-persistence";
import { TicketsAiAuthority, TicketsAiSceneError, TICKETS_AI_TRANSACTION, ticketsAiRegistrationRef,
  type TicketsBoundAuthority } from "./tickets-authority.mjs";
import { TICKETS_START_TOOL, ticketsStartFingerprint } from "./tickets-start.mjs";

type Tx = Prisma.TransactionClient;
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");

export function createTicketsAiResultReaders(input: { database: PrismaClient; scene: TicketsAiAuthority;
  bound: TicketsBoundAuthority; tasks: ReturnType<typeof createPublicAiTaskPersistence> }) {
  const { database: db, scene, bound, tasks } = input;
  async function readSnapshot(taskId: string) {
    return db.$transaction(async (tx: Tx) => {
      const context = await bound.readActionOn(tx, taskId, "read_step_terminal"), task = await scene.task(tx, context, taskId);
      const source = await scene.source(tx, task.who, task.row.inputRef!);
      if (source.row.contentHash !== task.row.inputHash) throw unavailable();
      const run = await tx.aiRun.findFirst({ where: { scopeId: task.who.scopeId, taskId, sequence: 1 } });
      if (!run || run.scopeId !== task.who.scopeId || run.taskId !== taskId || run.sequence !== 1
        || run.actorKind !== "USER" || run.actorId !== task.who.actorId || run.inputReceiptId || run.resourceOriginRunId) throw unavailable();
      const actionId = aiStepActionId(aiTaskAccessFromContext(context, taskId, scene.clock()).scope, taskId, ticketsAiRegistrationRef(source.row.id));
      const step = await tx.aiStep.findFirst({ where: { scopeId: task.who.scopeId, taskId, actionId } });
      if (step && (step.taskId !== taskId || step.runId !== run.id || step.scopeId !== task.who.scopeId || step.actionId !== actionId
        || step.inputRef !== source.row.id || step.requestFingerprint !== ticketsStartFingerprint(source.binding)
        || step.toolCode !== TICKETS_START_TOOL.code || step.toolVersion !== TICKETS_START_TOOL.version)) throw unavailable();
      const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: task.who.scopeId, taskId, actionId } });
      const { principal, command } = source.binding.original;
      const original = await scene.tickets.withTransaction(tx, service => service.receiptFor(principal, "start", command));
      if (consumption) {
        if (!step || consumption.scopeId !== task.who.scopeId || consumption.taskId !== taskId || consumption.actionId !== actionId
          || consumption.actionFingerprint !== step.requestFingerprint || consumption.businessIdempotencyKey !== command.operationId) throw unavailable();
        const approval = await tx.aiApproval.findFirst({ where: { id: consumption.approvalId, scopeId: task.who.scopeId,
          taskId, proposalId: consumption.proposalId, proposalRevision: consumption.proposalRevision } });
        if (!approval || approval.id !== consumption.approvalId || approval.actorKind !== "USER" || approval.actorId !== task.who.actorId
          || approval.audience !== "OPERATOR" || approval.decision !== "APPROVED") throw unavailable();
        if (consumption.status === "COMMITTED" && (consumption.resultRef !== command.operationId || original.status !== "recorded")) throw unavailable();
      }
      const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: task.who.scopeId, taskId } } });
      const resources = budget ? [
        ["steps", budget.maxSteps, budget.consumedSteps, budget.reservedSteps],
        ["calls", budget.maxCalls, budget.consumedCalls, budget.reservedCalls],
        ["active_ms", budget.maxActiveMs, budget.consumedActiveMs, budget.reservedActiveMs],
        ["output_bytes", budget.maxOutputBytes, budget.consumedOutputBytes, budget.reservedOutputBytes]
      ].map(([kind, maximum, consumed, reserved]) => {
        if (typeof kind !== "string" || typeof maximum !== "bigint" || typeof consumed !== "bigint" || typeof reserved !== "bigint"
          || maximum < 1n || consumed < 0n || reserved < 0n || consumed + reserved > maximum) throw unavailable();
        return { kind, maximum: maximum.toString(), consumed: consumed.toString(), reserved: reserved.toString() };
      }) : null;
      if (budget && (budget.scopeId !== task.who.scopeId || budget.taskId !== taskId)) throw unavailable();
      const current = await bound.readActionOn(tx, taskId, "read_step_terminal");
      if (aiTaskAccessFromContext(current, taskId, scene.clock()).bindingKey !== task.who.binding) throw unavailable();
      return { taskId, runId: run.id, taskStatus: task.row.status.toLowerCase(), taskRevision: task.row.revision,
        runStatus: run.status.toLowerCase(), runRevision: run.revision, operationId: command.operationId, ticketId: command.ticketId,
        step: step ? { stepId: step.id, status: step.status.toLowerCase(), effect: step.effect.toLowerCase(), revision: step.revision,
          resultId: step.resultRef } : null,
        approvalConsumption: consumption?.status.toLowerCase() ?? "not_observed",
        business: consumption?.status === "COMMITTED" && original.status === "recorded" ? "committed" : "not_confirmed",
        originalReceipt: original.status === "recorded" ? original.receipt : null, resources,
        retryable: false as const, execution: "not_invoked" as const };
    }, TICKETS_AI_TRANSACTION);
  }
  return Object.freeze({ async read(value: unknown) {
    const { taskId } = z.object({ taskId: z.string().uuid() }).strict().parse(value);
    const before = await readSnapshot(taskId), results = await tasks.readRunResults({ taskId, runId: before.runId, limit: 1 });
    const after = await readSnapshot(taskId);
    if (hash(before) !== hash(after) || results.taskRevision !== after.taskRevision || results.runRevision !== after.runRevision
      || results.hasMore || results.items.length > 1 || results.items.some(item => item.stepId !== after.step?.stepId)) throw unavailable();
    // 公共读口只把已完成的原artifact作为结果；业务收据不能代填丢失的时间/资源事实。
    const item = results.items[0], result = item?.observation === "terminal_result" ? item.result : null;
    if (result?.status === "succeeded") {
      const payload = z.object({ operationId: z.string(), ticketId: z.string(), replayed: z.boolean() }).strict().parse(result.payload);
      if (payload.operationId !== after.operationId || payload.ticketId !== after.ticketId || after.business !== "committed") throw unavailable();
    }
    bound.assertCurrent(); scene.active();
    return { ...after, result: result ? { resultId: result.resultId, status: result.status, errorCode: result.errorCode,
      completeMeasurement: result.completeMeasurement, observedAt: result.observedAt } : null,
      taskReconciliationRequired: after.taskStatus === "waiting_external" || ["running", "unknown"].includes(after.step?.status ?? "")
        || after.resources?.some(resource => resource.reserved !== "0") === true };
  } });
}
