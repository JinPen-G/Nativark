/** 可选工单开始动作：原C05批准与普通工单写入共用一笔Native事务。
 * 仅供原计量Runner登记；不创建Task/批准、不授予权限、不调用模型、不恢复未知写入。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { ChangeTicketStateSchema, TicketSchema, TicketIdSchema, type TicketsService, type TicketExecutionRequest } from "@rental-os/example-tickets-core";
import { AI_PROPOSAL_DRAFT_VERSION, type AiProposalPayloadDraft } from "@rental-os/platform-contracts";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import type { AiExecutionContext } from "@rental-os/platform-contracts/ai-gateway";
import { createAiProposalBinding, type createPublicAiApprovalPersistence, type HeldApprovalConsumptionInput } from "@rental-os/ai-native-server/approval-persistence";
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionAuthority, type AiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import type { TaskRegisteredExecutor } from "@rental-os/ai-native-server/task-measured-effects";
import type { createPublicTenantTaskAuthority } from "@rental-os/ai-native-server/public-tenant-task-authority";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/runtime/public-rental-adapter-ports";

type Tx = Prisma.TransactionClient;
export const TICKETS_START_TOOL = Object.freeze({ code: "example-tickets.ticket.start", version: "1", scene: "example-tickets.start" });
export const TicketsStartOriginalSchema = z.object({
  version: z.literal("example-tickets-start-1"),
  principal: z.object({ tenantId: TicketIdSchema, subjectId: TicketIdSchema, audience: z.literal("operator") }).strict(),
  command: ChangeTicketStateSchema,
  fact: TicketSchema
}).strict().superRefine((value, context) => {
  if (value.fact.tenantId !== value.principal.tenantId || value.fact.id !== value.command.ticketId
    || value.fact.revision !== value.command.expectedRevision)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "工单原输入与受权事实不一致" });
});
export type TicketsStartOriginal = z.infer<typeof TicketsStartOriginalSchema>;
const snapshot = z.object({ recordId: z.string().uuid(), revision: z.number().int().positive().max(4294967294),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const TicketsStartBindingSchema = z.object({ source: snapshot, original: TicketsStartOriginalSchema }).strict()
  .refine(value => hash(value.original) === value.source.contentHash, "原输入摘要不一致");
export type TicketsStartBinding = z.infer<typeof TicketsStartBindingSchema>;
const unavailable = () => new Error("TICKETS_AI_UNAVAILABLE");
const changed = () => new Error("TICKETS_AI_BASIS_CHANGED");
const current = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };

/** 读取真实对象形成待存原输入。只准备事实，不能由该结果推导批准或执行许可。 */
export async function prepareTicketsStart(service: Pick<TicketsService, "prepareStart">, principal: CorePrincipal, command: unknown): Promise<TicketsStartOriginal> {
  const input = ChangeTicketStateSchema.parse(command);
  return TicketsStartOriginalSchema.parse({ version: "example-tickets-start-1", principal,
    command: input, fact: await service.prepareStart(principal, input) });
}

export function ticketsStartActionInput(value: TicketsStartBinding) {
  const binding = TicketsStartBindingSchema.parse(value);
  return { tool: TICKETS_START_TOOL.code, version: TICKETS_START_TOOL.version, source: binding.source };
}
export const ticketsStartFingerprint = (value: TicketsStartBinding): string => hash(ticketsStartActionInput(value));

export const ticketsStartCatalogue = Object.freeze({ admits(action: Readonly<AiProposalPayloadDraft<string, string>["actions"][number]>) {
  return action.toolCode === TICKETS_START_TOOL.code && action.toolVersion === TICKETS_START_TOOL.version
    && action.target.resourceType === "example-ticket";
} });
const proposals = createAiProposalBinding(ticketsStartCatalogue);

/** 同一份持久原输入同时承载人类预览；只含原事实，不生成第二个可变预览快照。 */
export function createTicketsStartProposal(input: { binding: TicketsStartBinding; taskId: string; actionId: string;
  proposalId: string; expiresAt: string }): AiProposalPayloadDraft<string, string> {
  const binding = TicketsStartBindingSchema.parse(input.binding);
  const payload: AiProposalPayloadDraft<string, string> = { contractVersion: AI_PROPOSAL_DRAFT_VERSION,
    proposalId: input.proposalId, taskId: input.taskId, revision: 1, audience: "operator",
    scope: { kind: "tenant", tenantId: binding.original.principal.tenantId },
    actions: [{ actionId: input.actionId, toolCode: TICKETS_START_TOOL.code, toolVersion: TICKETS_START_TOOL.version,
      input: binding.source, preview: binding.source,
      target: { resourceType: "example-ticket", resourceId: binding.original.command.ticketId, version: String(binding.original.command.expectedRevision) } }],
    atomicity: "single_action", failurePolicy: "stop_and_reconcile", expiresAt: input.expiresAt };
  proposals.fingerprintAiProposalDraft(payload);
  return payload;
}

type Execution = NonNullable<Awaited<ReturnType<TaskRegisteredExecutor["resolve"]>>>;
export type TicketsStartExecution = Parameters<Execution["execute"]>[0];
export interface TicketsStartProof {
  /** 来自当前原Task权威；不能接受HTTP body、模型或先前页面保存的执行上下文。 */
  context: AiExecutionContext;
  binding: TicketsStartBinding;
  consumption: HeldApprovalConsumptionInput;
  /** 当前原proposal version正文与摘要，供本Core核输入/预览/目标/版本，不能仅传approvalId。 */
  proposal: AiProposalPayloadDraft<string, string>;
  payloadHash: string;
}
export interface TicketsStartAuthority {
  /** 必须同Native读取原Task/Step/输入/批准和当前发布、权益、政策/授权；replay只授原结果读取。 */
  resolve(command: Readonly<TicketsStartExecution>, purpose: "execute" | "replay", transaction?: Tx): Promise<TicketsStartProof>;
}
export interface TicketsTransactionHost {
  withTransaction<T>(transaction: Tx, consume: (service: TicketsService) => Promise<T>, before?: Omit<TicketExecutionRequest, "purpose">): Promise<T>;
}

type RequestAuthority = Awaited<ReturnType<ReturnType<typeof createPublicTenantTaskAuthority>["bind"]>>;
/** 原持久元数据的读取参加者；bound的业务发布/权益/政策核验由宿主在bind时明确登记。
 * 数据库须为该宿主原正文保护view，不能从模型内容或一份临时JSON文件恢复批准。
 */
export function createTicketsStartSource(input: {
  database: Pick<PrismaClient, "aiTask" | "aiStep" | "aiTaskOriginalRequest" | "aiProposalAction" | "aiProposalVersion" | "aiApproval">;
  bound: Pick<RequestAuthority, "actions" | "actionOn" | "readActionOn">;
  clock?: () => Date;
}): TicketsStartAuthority {
  const { database, bound } = input, clock = input.clock ?? (() => new Date());
  return Object.freeze<TicketsStartAuthority>({ async resolve(command, purpose, tx) {
    const operation = purpose === "execute" ? "transition_task" : "read_step_terminal";
    const context = await (tx ? purpose === "execute" ? bound.actionOn(tx, command.taskId, operation)
      : bound.readActionOn(tx, command.taskId, "read_step_terminal") : bound.actions.resolve(command.taskId, operation));
    const access = aiTaskAccessFromContext(context, command.taskId, clock()), reader = tx ?? database;
    const task = await reader.aiTask.findFirst({ where: access.where });
    if (!task || task.sceneCode !== TICKETS_START_TOOL.scene || task.sceneVersion !== TICKETS_START_TOOL.version
      || !task.inputRef || !task.inputRevision || !task.inputHash) throw unavailable();
    const source = await reader.aiTaskOriginalRequest.findFirst({ where: { id: task.inputRef, scopeId: task.scopeId,
      sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId } });
    if (!source || source.id !== task.inputRef || source.scopeId !== task.scopeId || source.status !== "STORED" || source.erasedAt !== null
      || source.contractVersion !== "example-tickets-start-1" || source.revision !== task.inputRevision || source.contentHash !== task.inputHash
      || purpose === "execute" && (source.creationClosedAt !== null || source.expiresAt <= clock())) throw unavailable();
    const binding = TicketsStartBindingSchema.parse({ source: { recordId: source.id, revision: source.revision, contentHash: source.contentHash }, original: source.payload });
    const step = await reader.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: command.runId, id: command.stepId,
      actionId: command.actionId, inputRef: source.id, requestFingerprint: ticketsStartFingerprint(binding),
      toolCode: TICKETS_START_TOOL.code, toolVersion: TICKETS_START_TOOL.version } });
    if (!step || step.actionId !== command.actionId || step.id !== command.stepId || step.requestFingerprint !== command.fingerprint) throw changed();
    const actions = await reader.aiProposalAction.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
      actionId: step.actionId, requestFingerprint: step.requestFingerprint }, take: 2 });
    // 此小样例每份原输入只有一项提案；依据变化须显式生成新原输入，不能改旧版本或猜最近一条。
    if (actions.length !== 1) throw unavailable();
    const action = actions[0], key = { scopeId: task.scopeId, taskId: task.id, proposalId: action.proposalId, proposalRevision: action.proposalRevision };
    const version = await reader.aiProposalVersion.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
      proposalId: key.proposalId, revision: key.proposalRevision } });
    const approval = await reader.aiApproval.findFirst({ where: { ...key, actorKind: access.actorKind, actorId: access.actorId,
      audience: access.audience, decision: "APPROVED" } });
    if (!version || !approval || version.payloadHash !== approval.payloadHash) throw unavailable();
    // 原公共validator先核完整闭合payload，本Core随后在executor核每个输入/预览/目标字段。
    if (proposals.fingerprintAiProposalDraft(version.payload) !== version.payloadHash) throw changed();
    return { context, binding, proposal: version.payload as unknown as AiProposalPayloadDraft<string, string>, payloadHash: version.payloadHash,
      consumption: { context, ...key, actionId: command.actionId, approvalId: approval.id,
        actionFingerprint: command.fingerprint, businessIdempotencyKey: binding.original.command.operationId,
        lease: { runId: command.lease.runId, holderId: command.lease.holderId, revision: command.lease.revision, fencingToken: command.lease.fencingToken } } };
  } });
}

/** 原Runner拥有阶段标记、累计额度、租约与unknown。此处只贡献一个确定的业务工具。 */
export function createTicketsStartExecutor(input: {
  database: Pick<PrismaClient, "$transaction">;
  transactions: AiTaskTransactionBoundary<Tx>;
  authority: AiTaskTransactionAuthority<Tx>;
  approvals: Pick<ReturnType<typeof createPublicAiApprovalPersistence>, "attachEffect">;
  source: TicketsStartAuthority;
  tickets: TicketsTransactionHost;
}): TaskRegisteredExecutor {
  if (!isStrictAiTaskTransactionBoundary(input.transactions) || typeof input.source?.resolve !== "function"
    || typeof input.tickets?.withTransaction !== "function" || typeof input.approvals?.attachEffect !== "function"
    || typeof input.database?.$transaction !== "function") throw unavailable();
  const resolve = input.source.resolve.bind(input.source), withTickets = input.tickets.withTransaction.bind(input.tickets);
  const contextKey = ({ requestId: _request, authorizedAt: _at, ...context }: AiExecutionContext) => hash(context);
  function proof(value: TicketsStartProof, command: TicketsStartExecution): TicketsStartProof {
    const fixed = structuredClone(value), binding = TicketsStartBindingSchema.parse(fixed.binding), { original } = binding;
    const { context, consumption, proposal } = fixed;
    if (context.audience !== "operator" || context.actor.kind !== "user" || context.scope.kind !== "tenant"
      || context.actor.userId !== original.principal.subjectId || context.scope.tenantId !== original.principal.tenantId
      || contextKey(context) !== contextKey(consumption.context)
      || consumption.taskId !== command.taskId || consumption.actionId !== command.actionId || command.lease.taskId !== command.taskId
      || command.runId !== command.lease.runId
      || consumption.businessIdempotencyKey !== original.command.operationId
      || consumption.actionFingerprint !== command.fingerprint || command.fingerprint !== ticketsStartFingerprint(binding)
      || command.inputRef !== binding.source.recordId
      || hash(consumption.lease) !== hash({ runId: command.lease.runId, holderId: command.lease.holderId,
        revision: command.lease.revision, fencingToken: command.lease.fencingToken })) throw changed();
    const expected = createTicketsStartProposal({ binding, taskId: command.taskId, actionId: command.actionId,
      proposalId: consumption.proposalId, expiresAt: proposal.expiresAt });
    if (consumption.proposalRevision !== expected.revision || hash(proposal) !== hash(expected)
      || fixed.payloadHash !== proposals.fingerprintAiProposalDraft(expected)) throw changed();
    return { ...fixed, binding };
  }
  async function verifyBusiness(tx: Tx, binding: TicketsStartBinding, requireReceipt: boolean) {
    return withTickets(tx, async service => {
      const { principal, command, fact } = binding.original;
      const result = await service.receiptFor(principal, "start", command);
      if (result.status === "recorded") return result.receipt;
      if (requireReceipt) throw unavailable();
      if (hash(await service.get(principal, command.ticketId)) !== hash(fact)) throw changed();
      return null;
    });
  }
  return Object.freeze<TaskRegisteredExecutor>({ async resolve(code, version) {
    if (code !== TICKETS_START_TOOL.code || version !== TICKETS_START_TOOL.version) return null;
    return { operation: "idempotent" as const, async execute(command, signal) {
      command = structuredClone(command);
      current(signal);
      const initial = proof(await resolve(command, "execute"), command), fixed = initial.binding;
      const consumptionKey = ({ context: _context, ...value }: HeldApprovalConsumptionInput) => hash(value);
      const effect = input.approvals.attachEffect<TicketsStartBinding>(initial.consumption, TICKETS_START_TOOL.code, {
        async resolve(held, binding, purpose, tx) {
          current(signal);
          const fresh = proof(await resolve(command, purpose, tx), command);
          if (hash(fresh.binding) !== hash(binding) || hash(held) !== hash(initial.consumption)
            || consumptionKey(fresh.consumption) !== consumptionKey(initial.consumption)) throw changed();
          if (tx && purpose === "execute") await verifyBusiness(tx, fresh.binding, false);
          current(signal);
          return fresh.context;
        },
        async assertCommitted(tx, binding, resultRef) {
          if (resultRef !== binding.original.command.operationId) throw changed();
          await verifyBusiness(tx, binding, true);
        }
      });
      const originalResult = await effect.recover(fixed);
      if (originalResult !== null) {
        if (originalResult !== fixed.original.command.operationId) throw changed();
        await effect.replay(fixed, originalResult);
        await input.database.$transaction(tx => verifyBusiness(tx, fixed, true), { isolationLevel: "ReadCommitted", maxWait: 2500, timeout: 15000 });
        current(signal);
        return { kind: "succeeded" as const, payload: { operationId: originalResult, ticketId: fixed.original.command.ticketId, replayed: true } };
      }
      let callbackCompleted = false;
      try {
        const receipt = await input.transactions.withAiTaskTransactionAuthority(input.authority, () =>
          input.database.$transaction(tx => input.transactions.withAiTaskTransaction(tx, { kind: "task", taskId: command.taskId }, async () => {
            const receipt = await withTickets(tx, async service => {
              current(signal);
              if (await verifyBusiness(tx, fixed, false)) throw changed();
              await effect.prepare(tx, fixed);
              const receipt = await service.start(fixed.original.principal, fixed.original.command);
              current(signal);
              await effect.commit(tx, fixed, receipt.operationId);
              current(signal);
              return receipt;
            }, { principal: fixed.original.principal, permission: "start" });
            callbackCompleted = true;
            return receipt;
          }), { isolationLevel: "Serializable", maxWait: 2500, timeout: 15000 }));
        current(signal);
        // 同原批准/收据再观察当前权限；已提交但失去交付权时只交unknown元数据。
        await effect.replay(fixed, receipt.operationId);
        current(signal);
        return { kind: "succeeded" as const, payload: { operationId: receipt.operationId, ticketId: receipt.ticket.id, replayed: false } };
      } catch (error) {
        if (!callbackCompleted && !signal.aborted) throw error;
        // COMMIT回包、交付或取消不能证明回滚。原Runner持久保留unknown，不能自动再调start。
        return { kind: "unknown" as const, payload: { operationId: fixed.original.command.operationId,
          ticketId: fixed.original.command.ticketId, retryable: false } };
      }
    } };
  } });
}
