/** 工单单动作的Step证据参加者，只读原计划、计量、C05和业务收据。
 * 原公共仓储继续拥有状态迁移、CAS与事件；此处不补写结果、不结算账、不重执行。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AiStepStateDraft, AiStepOutcomeDraft } from "@rental-os/platform-contracts/ai-task";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import type { AiStepTransitionAuthority, AiStepTransitionCommand } from "@rental-os/ai-native-server/task-steps";
import type { AiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import { createTicketsAiPlans } from "./tickets-plan.mjs";
import { createTicketsStartSource, createTicketsStartProposal, TICKETS_START_TOOL, ticketsStartFingerprint } from "./tickets-start.mjs";
import { TicketsAiAuthority, TicketsAiSceneError, TICKETS_AI_TRANSACTION, ticketsAiRegistrationRef,
  type TicketsBoundAuthority } from "./tickets-authority.mjs";

type Tx = Prisma.TransactionClient;
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");
const unknownOutcome = (): AiStepOutcomeDraft => ({ status: "unknown", effect: "possible", error: {
  code: "AI_RESULT_UNKNOWN", message: "工单执行结果待核对，请读取原操作结果。", retryable: false, nextAction: "reconcile", missingFields: [] } });
const resultPayload = z.object({ operationId: z.string(), ticketId: z.string(), replayed: z.boolean() }).strict();

export function createTicketsAiStepEvidence(input: { database: PrismaClient; scene: TicketsAiAuthority;
  bound: TicketsBoundAuthority; transactions: AiTaskTransactionBoundary<Tx> }): AiStepTransitionAuthority {
  const { database: db, scene, bound, transactions } = input, plans = createTicketsAiPlans(input);
  const source = createTicketsStartSource({ database: db, bound, clock: scene.clock });
  return Object.freeze({ async resolve(command: Readonly<AiStepTransitionCommand>, native?: Tx) {
    command = structuredClone(command);
    const starting = command.reason === "start", reconciling = command.reason === "reconciled_committed";
    if (!["start", "result_observed", "result_unknown", "reconciled_committed"].includes(command.reason)) throw unavailable();
    const read = async (tx: Tx) => {
      const current = () => starting ? bound.actionOn(tx, command.taskId, "transition_task")
        : bound.readActionOn(tx, command.taskId, "read_step_terminal");
      const context = await current(), task = await scene.task(tx, context, command.taskId), key = {
        scopeId: task.who.scopeId, taskId: command.taskId, runId: command.lease.runId };
      const original = await scene.source(tx, task.who, task.row.inputRef!);
      const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
      // 原仓储第二次解析前已CAS Task/Run各加一；证据摘要不包含这两个可变修订。
      const increment = native ? 1 : 0;
      if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.sequence !== 1
        || run.actorKind !== "USER" || run.actorId !== task.who.actorId || run.inputReceiptId || run.resourceOriginRunId
        || run.revision !== command.lease.revision + increment || task.row.revision !== command.expectedTaskRevision + increment
        || run.leaseOwnerId !== command.lease.holderId || run.fencingToken.toFixed(0) !== command.lease.fencingToken
        || !run.leaseExpiresAt || run.leaseExpiresAt <= scene.clock() || run.status !== "RUNNING"
        || !["RUNNING", "WAITING_EXTERNAL", "CANCEL_REQUESTED"].includes(task.row.status)
        || task.row.inputHash !== original.row.contentHash) throw unavailable();
      const registration = { taskId: key.taskId, registrationRef: ticketsAiRegistrationRef(original.row.id),
        expectedTaskRevision: task.row.revision, lease: { ...command.lease, revision: run.revision } };
      const planProof = await (starting ? plans.registration.resolve(registration, tx) : plans.registration.resolveOriginal(registration, tx));
      const step = await tx.aiStep.findFirst({ where: { ...key, id: command.stepId } });
      if (!step || step.id !== command.stepId || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
        || step.sequence !== 1 || step.revision !== command.expectedStepRevision || step.inputRef !== original.row.id
        || step.requestFingerprint !== ticketsStartFingerprint(original.binding) || step.requestFingerprint !== planProof.requestFingerprint
        || step.toolCode !== TICKETS_START_TOOL.code || step.toolVersion !== TICKETS_START_TOOL.version
        || step.status !== (starting ? "PENDING" : reconciling ? "UNKNOWN" : "RUNNING")
        || step.effect !== (starting ? "NONE" : "POSSIBLE")
        || (reconciling ? !step.resultRef || step.errorCode !== "AI_RESULT_UNKNOWN" : step.resultRef !== null || step.errorCode !== null)) throw unavailable();
      const proof = await source.resolve({ taskId: key.taskId, runId: key.runId, stepId: step.id, actionId: step.actionId,
        inputRef: original.row.id, fingerprint: step.requestFingerprint,
        lease: { taskId: key.taskId, ...command.lease, revision: run.revision, expiresAt: run.leaseExpiresAt.toISOString() } }, starting ? "execute" : "replay", tx);
      const proposal = createTicketsStartProposal({ binding: original.binding, taskId: key.taskId, actionId: step.actionId,
        proposalId: proof.consumption.proposalId, expiresAt: original.row.expiresAt.toISOString() });
      if (hash(proof.binding) !== hash(original.binding) || hash(proof.proposal) !== hash(proposal)
        || proof.consumption.proposalRevision !== 1 || aiTaskAccessFromContext(proof.context, key.taskId, scene.clock()).bindingKey !== task.who.binding) throw unavailable();
      const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: step.actionId } });
      const { principal, command: business } = original.binding.original;
      const receipt = await scene.tickets.withTransaction(tx, service => service.receiptFor(principal, "start", business));
      if (consumption && (consumption.scopeId !== key.scopeId || consumption.taskId !== key.taskId || consumption.actionId !== step.actionId
        || consumption.actionFingerprint !== step.requestFingerprint || consumption.businessIdempotencyKey !== business.operationId
        || consumption.proposalId !== proof.consumption.proposalId || consumption.proposalRevision !== 1
        || consumption.approvalId !== proof.consumption.approvalId)) throw unavailable();
      let outcome: AiStepOutcomeDraft = { status: "running", effect: "possible" }, resultRef: string | null = null, resultEvidence: unknown = null;
      if (starting) {
        if (command.evidenceId !== `start-${step.id}` || task.row.status !== "RUNNING" || task.row.cancelRequestedAt
          || consumption || receipt.status === "recorded") throw unavailable();
      } else {
        const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, stepId: step.id, id: command.evidenceId } });
        if (!artifact || artifact.id !== command.evidenceId || artifact.scopeId !== key.scopeId || artifact.taskId !== key.taskId
          || artifact.runId !== key.runId || artifact.stepId !== step.id || artifact.actionId !== step.actionId
          || artifact.stepFingerprint !== step.requestFingerprint || !artifact.leaseOwnerId || artifact.errorCode !== null
          || !/^[1-9][0-9]{0,19}$/u.test(artifact.fencingToken.toFixed(0))
          || BigInt(artifact.fencingToken.toFixed(0)) > BigInt(command.lease.fencingToken)
          || artifact.fencingToken.toFixed(0) === command.lease.fencingToken && artifact.leaseOwnerId !== run.leaseOwnerId
          || hash(artifact.payload) !== artifact.contentHash || reconciling && step.resultRef !== artifact.id) throw unavailable();
        const charges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, stepId: step.id }, take: 4 });
        // 本工具没有模型或外部调用，只消费原steps/active_ms/output_bytes三种账；不能接入额外CALLS账。
        if (charges.length !== 3 || new Set(charges.map(c => c.resource)).size !== 3
          || charges.some(c => !["STEPS", "ACTIVE_MS", "OUTPUT_BYTES"].includes(c.resource)
            || c.scopeId !== key.scopeId || c.taskId !== key.taskId || c.runId !== key.runId || c.stepId !== step.id
            || c.actionId !== step.actionId || c.stepFingerprint !== step.requestFingerprint || c.gatewayInvocationId !== null
            || c.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0) || c.leaseOwnerId !== artifact.leaseOwnerId
            || !["RESERVED", "RECORDED", "UNKNOWN"].includes(c.status))) throw unavailable();
        const time = charges.find(c => c.resource === "ACTIVE_MS")!, bytes = charges.find(c => c.resource === "OUTPUT_BYTES")!;
        if (typeof artifact.activeMs !== "bigint" || artifact.activeMs < 0n || artifact.activeMs > time.amount
          || typeof artifact.outputBytes !== "bigint" || artifact.outputBytes < 0n || artifact.outputBytes > bytes.amount
          || artifact.createdAt > scene.clock()) throw unavailable();
        if (command.reason === "result_unknown") {
          if (artifact.completeMeasurement || !["RUNNING", "UNKNOWN"].includes(artifact.outcome)
            || artifact.outcome === "RUNNING" && (hash(artifact.payload) !== hash({}) || artifact.activeMs !== 0n || artifact.outputBytes !== 0n)
            || artifact.outcome === "UNKNOWN" && BigInt(Buffer.byteLength(JSON.stringify(artifact.payload))) !== artifact.outputBytes) throw unavailable();
          outcome = unknownOutcome();
        } else {
          const payload = resultPayload.parse(artifact.payload);
          if (!artifact.completeMeasurement || artifact.outcome !== "SUCCEEDED" || !consumption || consumption.status !== "COMMITTED"
            || consumption.resultRef !== business.operationId || receipt.status !== "recorded"
            || payload.operationId !== business.operationId || payload.ticketId !== business.ticketId
            || receipt.receipt.ticket.state !== "in_progress" || receipt.receipt.ticket.revision !== business.expectedRevision + 1
            || BigInt(Buffer.byteLength(JSON.stringify(artifact.payload))) !== artifact.outputBytes) throw unavailable();
          outcome = { status: "succeeded", effect: "committed", facts: [{ scope: context.scope,
            resourceType: "core:example-tickets:ticket", resourceId: receipt.receipt.ticket.id,
            observedAt: receipt.receipt.ticket.updatedAt, basis: { kind: "snapshot", version: String(receipt.receipt.ticket.revision) } }] };
        }
        resultRef = artifact.id;
        resultEvidence = { id: artifact.id, hash: artifact.contentHash, outcome: artifact.outcome, complete: artifact.completeMeasurement,
          activeMs: artifact.activeMs.toString(), outputBytes: artifact.outputBytes.toString(), fence: artifact.fencingToken.toFixed(0),
          holder: artifact.leaseOwnerId, charges: charges.map(c => ({ id: c.chargeId, resource: c.resource,
            fingerprint: c.requestFingerprint, revision: c.revision, status: c.status })).sort((a, b) => a.id.localeCompare(b.id)) };
      }
      const previous: AiStepStateDraft = { stepId: step.id, runId: step.runId, sequence: step.sequence, revision: step.revision,
        toolCode: step.toolCode, toolVersion: step.toolVersion, actionId: step.actionId, requestFingerprint: step.requestFingerprint,
        outcome: starting ? { status: "pending", effect: "none" } : reconciling ? unknownOutcome() : { status: "running", effect: "possible" } };
      const after = await current();
      if (aiTaskAccessFromContext(after, key.taskId, scene.clock()).bindingKey !== task.who.binding || run.leaseExpiresAt <= scene.clock()) throw unavailable();
      scene.active();
      return { context: after, transitionAllowed: true as const, taskId: key.taskId, reason: command.reason,
        evidenceId: command.evidenceId, evidenceRevision: step.revision, expiresAt: run.leaseExpiresAt.toISOString(),
        authorizationKey: `tickets-${hash({ registration: planProof.authorizationKey, source: original.binding.source,
          proposal: proof.payloadHash, approval: proof.consumption.approvalId, consumption: consumption ? {
            status: consumption.status, resultRef: consumption.resultRef } : null, receipt, resultEvidence })}`,
        previous, next: { ...previous, revision: previous.revision + 1, outcome }, previousResultRef: step.resultRef, resultRef };
    };
    return native ? read(native) : starting
      ? transactions.withAiTaskTransactionAuthority(bound.transaction, () => db.$transaction(tx =>
        transactions.withAiTaskTransaction(tx, { kind: "task", taskId: command.taskId }, () => read(tx)), TICKETS_AI_TRANSACTION))
      : db.$transaction(read, TICKETS_AI_TRANSACTION);
  } });
}
