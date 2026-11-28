/** 把工单持久原输入和已登记Step接到原C05。只准备/读取/记录人类决定；
 * 批准不会调用工单start，unknown只沿原Task/提案/操作引用读取。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { createAiProposalBinding, createPublicAiApprovalPersistence, AiProposalRepositoryError, AiApprovalRepositoryError } from "@rental-os/ai-native-server/approval-persistence";
import { aiStepActionId } from "@rental-os/ai-native-server/task-steps";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import type { AiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import type { AiExecutionContext } from "@rental-os/platform-contracts/ai-gateway";
import { createTicketsStartProposal, TICKETS_START_TOOL, ticketsStartCatalogue, ticketsStartFingerprint } from "./tickets-start.mjs";
import { TicketsAiAuthority, TicketsAiSceneError, TicketsAiUnknownError, TICKETS_AI_TRANSACTION,
  ticketsAiRegistrationRef, type TicketsBoundAuthority } from "./tickets-authority.mjs";

type Tx = Prisma.TransactionClient;
const ref = z.object({ taskId: z.string().uuid() }).strict();
export const TicketsAiDecisionSchema = ref.extend({ proposalId: z.string().uuid(), proposalRevision: z.literal(1),
  reviewedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u), decision: z.enum(["approved", "rejected"]) }).strict();
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");
const changed = () => new TicketsAiSceneError("basis_changed", "TICKETS_AI_BASIS_CHANGED");
const proposalIdFor = (taskId: string, inputRef: string) => {
  const h = hash(["example-tickets-start-proposal-1", taskId, inputRef]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function createTicketsAiApprovals(input: { database: PrismaClient; scene: TicketsAiAuthority;
  bound: TicketsBoundAuthority; transactions: AiTaskTransactionBoundary<Tx> }) {
  const { database: db, scene, bound, transactions } = input, proposals = createAiProposalBinding(ticketsStartCatalogue);
  async function expected(tx: Tx, context: AiExecutionContext, taskId: string) {
    const task = await scene.task(tx, context, taskId), source = await scene.source(tx, task.who, task.row.inputRef!);
    if (source.row.contentHash !== task.row.inputHash) throw changed();
    const access = aiTaskAccessFromContext(context, taskId, scene.clock());
    const actionId = aiStepActionId(access.scope, taskId, ticketsAiRegistrationRef(source.row.id));
    const fingerprint = ticketsStartFingerprint(source.binding), key = { scopeId: task.who.scopeId, taskId };
    const step = await tx.aiStep.findFirst({ where: { ...key, actionId } });
    if (!step || step.scopeId !== key.scopeId || step.taskId !== taskId || step.actionId !== actionId
      || step.toolCode !== TICKETS_START_TOOL.code || step.toolVersion !== TICKETS_START_TOOL.version
      || step.requestFingerprint !== fingerprint || step.inputRef !== source.row.id) throw unavailable();
    const proposalId = proposalIdFor(taskId, source.row.id);
    const payload = createTicketsStartProposal({ binding: source.binding, taskId, actionId, proposalId, expiresAt: source.row.expiresAt.toISOString() });
    return { ...task, ...source, step, actionId, fingerprint, payload, payloadHash: proposals.fingerprintAiProposalDraft(payload), proposalId };
  }

  async function stored(tx: Tx, context: AiExecutionContext, taskId: string) {
    const original = await expected(tx, context, taskId), { who, proposalId, payloadHash } = original;
    const head = await tx.aiProposal.findFirst({ where: { scopeId: who.scopeId, taskId, id: proposalId } });
    if (!head) return { ...original, head: null, decision: null };
    const key = { scopeId: who.scopeId, taskId, proposalId, proposalRevision: 1 };
    const version = await tx.aiProposalVersion.findFirst({ where: { scopeId: who.scopeId, taskId, proposalId, revision: 1 } });
    const action = await tx.aiProposalAction.findFirst({ where: { ...key, actionId: original.actionId } });
    if (head.id !== proposalId || head.scopeId !== who.scopeId || head.taskId !== taskId || head.stateRevision < 1
      || !version || version.payloadHash !== payloadHash || hash(version.payload) !== hash(original.payload)
      || version.expiresAt.getTime() !== original.row.expiresAt.getTime() || !action || action.sequence !== 1
      || action.requestFingerprint !== original.fingerprint) throw changed();
    const decision = await tx.aiApproval.findFirst({ where: { ...key, actorKind: "USER", actorId: who.actorId, audience: "OPERATOR" } });
    if (decision && (decision.payloadHash !== payloadHash || decision.scopeId !== who.scopeId || decision.taskId !== taskId
      || decision.proposalId !== proposalId || decision.proposalRevision !== 1 || decision.actorId !== who.actorId
      || decision.actorKind !== "USER" || decision.audience !== "OPERATOR" || decision.expiresAt.getTime() !== original.row.expiresAt.getTime())) throw changed();
    const status = decision?.decision === "APPROVED" ? "CONFIRMED" : decision?.decision === "REJECTED" ? "CANCELLED" : "PENDING_CONFIRMATION";
    if (head.status !== status || head.currentRevision !== (decision ? 1 : null)) throw changed();
    return { ...original, head, decision };
  }

  const approvals = createPublicAiApprovalPersistence({ db, catalogue: ticketsStartCatalogue, transactions, clock: scene.clock,
    decisions: { async authorize(context, command) {
      return db.$transaction(async tx => {
        const current = await bound.readActionOn(tx, command.taskId, "read_step_terminal");
        const before = aiTaskAccessFromContext(context, command.taskId, scene.clock());
        if (before.bindingKey !== aiTaskAccessFromContext(current, command.taskId, scene.clock()).bindingKey) throw changed();
        const original = await stored(tx, current, command.taskId);
        if (!original.head || original.who.scopeId !== command.scopeId || original.proposalId !== command.proposalId
          || command.proposalRevision !== 1 || command.reviewedPayloadHash !== original.payloadHash
          || hash(command.payload) !== hash(original.payload)) throw changed();
        if (command.decision === "approved") await scene.live(tx, current, original.row.id);
        return { scopeId: original.who.scopeId, actorKind: "user", actorId: original.who.actorId, audience: "operator" };
      }, TICKETS_AI_TRANSACTION);
    } } });

  async function read(taskId: string) {
    taskId = ref.parse({ taskId }).taskId;
    return db.$transaction(async tx => {
      const context = await bound.readActionOn(tx, taskId, "read_step_terminal"), original = await stored(tx, context, taskId);
      const result = await scene.tickets.withTransaction(tx, async service => {
        // 正文预览仍须当前普通对象读取权，任务引用不是读取另一工单的凭证。
        await service.get(original.who.principal, original.binding.original.command.ticketId);
        return { taskId, proposalId: original.proposalId, proposalRevision: 1 as const, payloadHash: original.payloadHash,
          status: original.head?.status ?? "NOT_OBSERVED", original: original.binding.original,
          decision: original.decision ? { approvalId: original.decision.id, decision: original.decision.decision.toLowerCase(),
            issuedAt: original.decision.issuedAt.toISOString(), expiresAt: original.decision.expiresAt.toISOString() } : null,
          retryable: false as const, executionGranted: false as const };
      });
      const after = await bound.readActionOn(tx, taskId, "read_step_terminal");
      if (aiTaskAccessFromContext(after, taskId, scene.clock()).bindingKey !== aiTaskAccessFromContext(context, taskId, scene.clock()).bindingKey) throw changed();
      scene.active(); return result;
    }, TICKETS_AI_TRANSACTION);
  }

  return Object.freeze({ approvals, read,
    async prepare(taskId: string) {
      taskId = ref.parse({ taskId }).taskId;
      const existing = await read(taskId);
      if (existing.status !== "NOT_OBSERVED") return existing;
      let attempted = false;
      try {
        await transactions.withAiTaskTransactionAuthority(bound.transaction, () => db.$transaction(tx =>
          transactions.withAiTaskTransaction(tx, { kind: "task", taskId }, async () => {
            const context = await bound.actionOn(tx, taskId, "transition_task"), original = await expected(tx, context, taskId);
            await scene.live(tx, context, original.row.id);
            attempted = true;
            await approvals.createPending(bound.transaction, { scopeId: original.who.scopeId, taskId, payload: original.payload,
              actions: [{ actionId: original.actionId, requestFingerprint: original.fingerprint }] }, tx);
          }), TICKETS_AI_TRANSACTION));
        return await read(taskId);
      } catch (error) {
        if (attempted && !(error instanceof AiProposalRepositoryError && ["INVALID", "CONFLICT"].includes(error.code))) throw new TicketsAiUnknownError();
        throw error;
      }
    },
    async decide(value: unknown) {
      const command = TicketsAiDecisionSchema.parse(value);
      const context = await bound.actions.resolve(command.taskId, "read_step_terminal");
      const original = await db.$transaction(tx => stored(tx, context, command.taskId), TICKETS_AI_TRANSACTION);
      if (!original.head || command.proposalId !== original.proposalId || command.reviewedPayloadHash !== original.payloadHash) throw changed();
      try {
        await approvals.decide(bound.transaction, { ...command, context, scopeId: original.who.scopeId, payload: original.payload });
      } catch (error) {
        if (!(error instanceof AiApprovalRepositoryError) || error.code === "UNAVAILABLE") throw new TicketsAiUnknownError();
        throw error;
      }
      try { return await read(command.taskId); } catch { throw new TicketsAiUnknownError(); }
    }
  });
}
