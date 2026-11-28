/** 当前签名请求的工单AI组合：原正文保护、Auth、Task/C05及业务原收据。
 * 缺数据/事务/执行证据就拒绝装配，不创建模型配置、默认发布或后台工作者。
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { PlatformAuthService, PlatformPrincipalAuthority, SecretBox, SubscriptionService } from "@rental-os/platform-server";
import { ChangeTicketStateSchema, TicketError, TicketIdSchema, type TicketAiRouteState } from "@rental-os/example-tickets-core";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { createAiBodyStorageDatabase } from "@rental-os/ai-native-server/runtime/public-rental-adapter-ports";
import { createPublicTenantTaskAuthority } from "@rental-os/ai-native-server/public-tenant-task-authority";
import { createPublicAiTaskPersistence } from "@rental-os/ai-native-server/task-persistence";
import { createAiTaskTransactionBoundary } from "@rental-os/ai-native-server/task-transactions";
import { createTenantConfigurationTransactions } from "@rental-os/ai-native-server/tenant-configuration-transactions";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import type { AiStepTransitionAuthority } from "@rental-os/ai-native-server/task-steps";
import { TICKETS_START_TOOL, type TicketsTransactionHost } from "./tickets-start.mjs";
import { TicketsAiAuthority, TicketsAiSceneError, TicketsAiUnknownError, TICKETS_AI_TRANSACTION,
  ticketsAiCreationKey, ticketsAiEntryPermission, ticketsAiPrincipal, type TicketsBoundAuthority } from "./tickets-authority.mjs";
import { createTicketsAiPublication, TicketsAiPublicationCommandSchema } from "./tickets-publication.mjs";
import { createTicketsAiApprovals, TicketsAiDecisionSchema } from "./tickets-approval.mjs";
import { createTicketsAiResultReaders } from "./tickets-results.mjs";
import { createTicketsAiRunner, TicketsAiRunCommandSchema } from "./tickets-runner.mjs";

type Tx = Prisma.TransactionClient;
const taskRef = z.object({ taskId: z.string().uuid() }).strict(), sourceRef = z.object({ inputRef: z.string().uuid() }).strict();
const operationRef = z.object({ operationId: TicketIdSchema }).strict();
export const TICKETS_AI_INPUTS = {
  status: z.object({ ticketId: TicketIdSchema, taskId: z.string().uuid().optional() }).strict(),
  publication: z.object({}).strict(), publish: TicketsAiPublicationCommandSchema,
  publicationOperation: z.object({ operationId: z.string().uuid() }).strict(),
  prepareInput: ChangeTicketStateSchema, originalInput: operationRef, createTask: sourceRef, originalTask: sourceRef,
  prepareApproval: TicketsAiRunCommandSchema, approval: taskRef, decide: TicketsAiDecisionSchema,
  execute: TicketsAiRunCommandSchema, observeInterrupted: TicketsAiRunCommandSchema, result: taskRef
} as const;
export type TicketsAiAction = keyof typeof TICKETS_AI_INPUTS;
export type TicketsAiRequest = { headers: { authorization?: unknown } };
type EvidenceInput = { database: PrismaClient; scene: TicketsAiAuthority; bound: TicketsBoundAuthority;
  transactions: ReturnType<typeof createAiTaskTransactionBoundary<Tx>> };

export function createTicketsAiRequests(input: {
  database: PrismaClient; tickets: TicketsTransactionHost; secrets: Pick<SecretBox, "encrypt" | "decrypt">;
  auth: Pick<PlatformAuthService, "resolveAccessContext">; principals: Pick<PlatformPrincipalAuthority<Tx>, "lock">;
  subscriptions: Pick<SubscriptionService, "readCategoryCommercialContext" | "lockCategoryCommercialContext">;
  assertDataAvailable(database: Pick<Tx, "$queryRaw">): Promise<void>;
  /** 宿主固定工单证据实现，和本次请求共用scene/Native；不能接受请求指定的实现。 */
  stepEvidence(current: EvidenceInput): AiStepTransitionAuthority;
  clock?: () => Date;
}) {
  if (typeof input.stepEvidence !== "function") throw new TicketsAiSceneError("task_adapter_missing");
  const db = createAiBodyStorageDatabase(input.database, input.secrets), transactions = createAiTaskTransactionBoundary<Tx>();
  const clock = input.clock ?? (() => new Date());
  return Object.freeze({ async consume<Action extends TicketsAiAction>(action: Action, request: TicketsAiRequest,
    value: unknown, signal: AbortSignal): Promise<unknown> {
    if (!Object.hasOwn(TICKETS_AI_INPUTS, action)) throw new TicketsAiSceneError("authority_unavailable");
    const command = TICKETS_AI_INPUTS[action].parse(value);
    const scene = new TicketsAiAuthority(db, input.tickets, input.subscriptions, signal, clock);
    const bound = await createPublicTenantTaskAuthority({ db, auth: input.auth, principals: input.principals,
      creationPermission: "example-tickets:ticket:start", entryPermission: ticketsAiEntryPermission, clock,
      assertDataAvailable: input.assertDataAvailable, assertTaskAction: scene.assertTaskAction.bind(scene), assertReference: scene.assertReference.bind(scene) }).bind(request, signal);
    try {
      const tasks = createPublicAiTaskPersistence({ db, actions: bound.actions, transactions, clock, creation: scene.creation(bound),
        creationReceipt: { async resolve(sceneCode, inputRef) {
          if (sceneCode !== TICKETS_START_TOOL.scene) throw new TicketsAiSceneError("permission_denied");
          return db.$transaction(async tx => {
            const context = await bound.principalOn(tx), who = await scene.owner(tx, context), original = await scene.source(tx, who, inputRef);
            await input.tickets.withTransaction(tx, service => service.get(who.principal, original.binding.original.command.ticketId));
            const after = await scene.owner(tx, await bound.principalOn(tx));
            if (after.binding !== who.binding) throw new TicketsAiSceneError("permission_denied");
            return { context, sceneCode, sceneVersion: TICKETS_START_TOOL.version, inputRef: original.row.id,
              inputRevision: original.row.revision, inputHash: original.row.contentHash };
          }, TICKETS_AI_TRANSACTION);
        } } });
      const publication = createTicketsAiPublication({ database: db, clock, current: bound.identities.resolve,
        configurations: createTenantConfigurationTransactions<Tx>({ principalAuthority: input.principals,
          requiredPermission: "system:params:manage", assertDataAvailable: input.assertDataAvailable }) });
      const approvals = createTicketsAiApprovals({ database: db, scene, bound, transactions });
      const results = createTicketsAiResultReaders({ database: db, scene, bound, tasks });
      const transition = input.stepEvidence({ database: db, scene, bound, transactions });
      if (typeof transition?.resolve !== "function") throw new TicketsAiSceneError("task_adapter_missing");
      const run = () => createTicketsAiRunner({ database: db, scene, bound, tasks, transactions, approvals, transition });
      const create = async (inputRef: string, write: boolean) => {
        const locator = { inputRef, sceneCode: TICKETS_START_TOOL.scene, creationKey: ticketsAiCreationKey(inputRef) };
        const before = await tasks.readCreation(locator);
        if (!write || before.state !== "not_observed") return before;
        try { await tasks.create(bound.transaction, locator); }
        catch (error) {
          const current = await tasks.readCreation(locator).catch(() => null);
          if (current?.state === "observed") return current;
          if (error instanceof Error && "code" in error && error.code === "AI_ACCESS_DENIED") throw error;
          throw new TicketsAiUnknownError();
        }
        const current = await tasks.readCreation(locator);
        if (current.state !== "observed") throw new TicketsAiUnknownError();
        return current;
      };

      async function status(raw: unknown): Promise<TicketAiRouteState> {
        const selected = TICKETS_AI_INPUTS.status.parse(raw);
        try {
          if (selected.taskId) {
            const original = await results.read({ taskId: selected.taskId });
            if (original.ticketId !== selected.ticketId) throw new TicketsAiSceneError("permission_denied");
            if (original.taskReconciliationRequired) return { state: "reconciliation_required", reason: "original_result_unknown",
              taskId: selected.taskId, operationId: original.operationId, retryable: false };
            const approval = original.step ? await approvals.read(selected.taskId) : null;
            if (approval?.status === "PENDING_CONFIRMATION") return { state: "pending_approval", reason: "original_proposal_pending",
              taskId: selected.taskId, proposalId: approval.proposalId, proposalRevision: approval.proposalRevision };
            if (approval?.status === "CANCELLED") return { state: "denied", reason: "policy_denied" };
          }
          return await db.$transaction(async tx => {
            const context = await bound.principalOn(tx), principal = ticketsAiPrincipal(context);
            // 普通Core与真实start准备都核当前绑定、成员、权限及对象范围；随机只读键不会保存。
            await input.tickets.withTransaction(tx, async service => {
              const ticket = await service.get(principal, selected.ticketId);
              await service.prepareStart(principal, { ticketId: ticket.id, operationId: randomUUID(), expectedRevision: ticket.revision });
            }, { principal, permission: "start" });
            await scene.entitlement(tx, principal.tenantId);
            if (!await tx.aiScope.findFirst({ where: aiTaskAccessFromContext(context, "tickets-publication", clock()).scope }))
              return { state: "unpublished", reason: "tool_not_published" };
            const who = await scene.owner(tx, context), policy = await scene.policy(tx, who.scopeId);
            if (selected.taskId) {
              const task = await scene.task(tx, context, selected.taskId), source = await scene.source(tx, task.who, task.row.inputRef!);
              await scene.live(tx, context, source.row.id);
              const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: who.scopeId, taskId: task.row.id } } });
              if (budget && (budget.scopeId !== who.scopeId || budget.taskId !== task.row.id)) throw new TicketsAiSceneError("original_evidence_unavailable");
              if (budget && (budget.consumedSteps + budget.reservedSteps >= budget.maxSteps
                || budget.consumedActiveMs + budget.reservedActiveMs + BigInt(policy.limits.maxStepMs) >= budget.maxActiveMs
                || budget.consumedOutputBytes + budget.reservedOutputBytes >= budget.maxOutputBytes)) return { state: "denied", reason: "limit_reached" };
            }
            if (hash(ticketsAiPrincipal(await bound.principalOn(tx))) !== hash(principal)) throw new TicketsAiSceneError("permission_denied");
            return { state: "available", reason: "current_authorities_verified" };
          }, TICKETS_AI_TRANSACTION);
        } catch (error) {
          if (error instanceof TicketError) return error.code === "denied" || error.code === "not_found"
            ? { state: "denied", reason: "permission_denied" } : { state: "unavailable", reason: "basis_changed" };
          if (error instanceof TicketsAiSceneError) {
            if (error.reason === "tool_not_published" || error.reason === "publication_expired") return { state: "unpublished", reason: error.reason };
            if (["permission_denied", "entitlement_denied", "policy_denied", "core_unavailable", "limit_reached"].includes(error.reason))
              return { state: "denied", reason: error.reason as "permission_denied" | "entitlement_denied" | "policy_denied" | "core_unavailable" | "limit_reached" };
            if (error.reason === "basis_changed" || error.reason === "original_evidence_unavailable") return { state: "unavailable", reason: error.reason };
          }
          if (error instanceof Error && "code" in error && error.code === "AI_ACCESS_DENIED") return { state: "denied", reason: "permission_denied" };
          return { state: "unavailable", reason: "authority_unavailable" };
        }
      }

      let result: unknown;
      switch (action) {
        case "status": result = await status(command); break;
        case "publication": result = await publication.read(); break;
        case "publish": result = await publication.save(command); break;
        case "publicationOperation": result = await publication.operation(TICKETS_AI_INPUTS.publicationOperation.parse(command).operationId); break;
        case "prepareInput": result = await scene.prepare(bound, command); break;
        case "originalInput": result = await scene.readPreparation(bound, operationRef.parse(command).operationId); break;
        case "createTask": result = await create(sourceRef.parse(command).inputRef, true); break;
        case "originalTask": result = await create(sourceRef.parse(command).inputRef, false); break;
        case "prepareApproval": result = await run().prepare(command); break;
        case "approval": result = await approvals.read(taskRef.parse(command).taskId); break;
        case "decide": result = await approvals.decide(command); break;
        case "execute": result = await run().execute(command); break;
        case "observeInterrupted": result = await run().observeInterrupted(command); break;
        case "result": result = await results.read(command); break;
      }
      try { bound.assertCurrent(); scene.active(); }
      catch (error) {
        if (["publish", "prepareInput", "createTask", "prepareApproval", "decide", "execute", "observeInterrupted"].includes(action))
          throw new TicketsAiUnknownError();
        throw error;
      }
      return result;
    } finally { bound.close(); }
  } });
}
export type TicketsAiRequests = ReturnType<typeof createTicketsAiRequests>;
