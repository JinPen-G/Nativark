/** 工单场景的原输入、发布/权益及对象依据参加者。只使用公共Task/C05出口；
 * 不写Task/Run/Step状态，不创建默认政策，不执行模型或批准后的业务动作。
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChangeTicketStateSchema, type TicketAiRouteState } from "@rental-os/example-tickets-core";
import type { CorePrincipal } from "@rental-os/core-contracts";
import type { SubscriptionService } from "@rental-os/platform-server/subscription";
import type { AiExecutionContext } from "@rental-os/platform-contracts/ai-gateway";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import { aiTaskRunnerLimitsSchema } from "@rental-os/ai-native-server/task-runner-resources";
import type { AiTaskCreationAuthority, AiTaskRepositoryOperation } from "@rental-os/ai-native-server/task-persistence";
import type { AiTaskTransactionReference } from "@rental-os/ai-native-server/task-transactions";
import type { createPublicTenantTaskAuthority } from "@rental-os/ai-native-server/public-tenant-task-authority";
import { TICKETS_START_TOOL, TicketsStartBindingSchema, prepareTicketsStart,
  type TicketsStartBinding, type TicketsTransactionHost } from "./tickets-start.mjs";

type Tx = Prisma.TransactionClient;
export type TicketsBoundAuthority = Awaited<ReturnType<ReturnType<typeof createPublicTenantTaskAuthority>["bind"]>>;
export const TICKETS_AI_WORK_ACTIONS: readonly AiTaskRepositoryOperation[] = ["claim_run", "transition_task"];
export const TICKETS_AI_READ_ACTIONS: readonly AiTaskRepositoryOperation[] = ["read_metadata", "read_step_terminal", "claim_recovery_run", "release_run"];
export const ticketsAiEntryPermission = (action: AiTaskRepositoryOperation) => TICKETS_AI_WORK_ACTIONS.includes(action)
  ? "example-tickets:ticket:start" : TICKETS_AI_READ_ACTIONS.includes(action) ? "example-tickets:ticket:read" : undefined;
export const ticketsAiCreationKey = (inputRef: string) => `example-tickets:${inputRef}`;
export const ticketsAiRegistrationRef = (inputRef: string) => `ticket-start:${inputRef}`;
export const TICKETS_AI_TOOLS = Object.freeze([{ code: TICKETS_START_TOOL.code, version: TICKETS_START_TOOL.version }]);
export const TICKETS_AI_RETENTION_MS = 30 * 86400000;
export const TICKETS_AI_TRANSACTION = { isolationLevel: "ReadCommitted", maxWait: 2500, timeout: 15000 } as const;
const feature = "ai.native.use";
const reference = z.string().uuid();
const policyShape = z.object({ revision: z.number().int().min(1).max(4294967294), enabled: z.boolean(),
  expiresAt: z.date(), limits: aiTaskRunnerLimitsSchema }).strict();
export class TicketsAiSceneError extends Error {
  constructor(readonly reason: TicketAiRouteState["reason"], readonly code = "TICKETS_AI_UNAVAILABLE") { super(code); }
}
export class TicketsAiUnknownError extends Error {
  readonly code = "AI_RESULT_UNKNOWN"; readonly retryable = false;
  constructor() { super("AI_RESULT_UNKNOWN"); }
}
const unavailable = () => new TicketsAiSceneError("original_evidence_unavailable");
const changed = () => new TicketsAiSceneError("basis_changed", "TICKETS_AI_BASIS_CHANGED");
const deny = () => new TicketsAiSceneError("permission_denied", "AI_ACCESS_DENIED");
const ownerFields = (who: { scopeId: string; actorId: string }) => ({ scopeId: who.scopeId,
  audience: "OPERATOR" as const, ownerKind: "USER" as const, ownerId: who.actorId });

export function ticketsAiPrincipal(context: AiExecutionContext): CorePrincipal {
  if (context.scope.kind !== "tenant" || context.actor.kind !== "user" || context.audience !== "operator") throw deny();
  return { tenantId: context.scope.tenantId, subjectId: context.actor.userId, audience: "operator" };
}

/** 此class核工单自己的场景/业务来源，公共bound继续拥有签名会话、Task政策与同Native复权。 */
export class TicketsAiAuthority {
  constructor(readonly database: PrismaClient, readonly tickets: TicketsTransactionHost,
    private readonly subscriptions: Pick<SubscriptionService, "readCategoryCommercialContext" | "lockCategoryCommercialContext">,
    readonly signal: AbortSignal, readonly clock: () => Date = () => new Date()) {}

  active() { if (this.signal.aborted) throw unavailable(); }

  async owner(reader: Pick<Tx, "aiScope">, context: AiExecutionContext) {
    this.active();
    const principal = ticketsAiPrincipal(context), access = aiTaskAccessFromContext(context, "tickets-scene", this.clock());
    const row = await reader.aiScope.findFirst({ where: access.scope });
    if (!row || Object.entries(access.scope).some(([key, value]) => row[key as keyof typeof row] !== value)) throw unavailable();
    return { scopeId: row.id, actorId: principal.subjectId, principal, binding: access.bindingKey };
  }

  async policy(reader: Pick<Tx, "aiTaskPlanPolicy">, scopeId: string, requireEnabled = true) {
    this.active();
    const key = { scopeId, sceneCode: TICKETS_START_TOOL.scene, sceneVersion: TICKETS_START_TOOL.version };
    const row = await reader.aiTaskPlanPolicy.findUnique({ where: { scopeId_sceneCode_sceneVersion: key } });
    if (!row) throw new TicketsAiSceneError("tool_not_published");
    if (Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
      || hash(row.allowedTools) !== hash(TICKETS_AI_TOOLS)) throw unavailable();
    const policy = policyShape.parse({ revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt, limits: row.limits });
    if (policy.limits.maxStepMs > policy.limits.maxTotalMs) throw unavailable();
    if (requireEnabled && !policy.enabled) throw new TicketsAiSceneError("tool_not_published");
    if (requireEnabled && policy.expiresAt <= this.clock()) throw new TicketsAiSceneError("publication_expired");
    return { ...policy, hash: hash({ ...key, ...policy, expiresAt: policy.expiresAt.toISOString(), tools: TICKETS_AI_TOOLS }) };
  }

  async entitlement(tx: Tx, tenantId: string) {
    this.active();
    // 新宿主尚未发布功能目录时是明确缺权益；原订阅锁要求目录已存在，不能把此观察变成驱动不可用。
    // 只有确认无行才归类拒绝；读取异常仍抛出。已存在项继续沿原锁/期限/授权复核。
    if (!await tx.subscriptionFeatureCatalog.findUnique({ where: { code: feature } }))
      throw new TicketsAiSceneError("entitlement_denied", "AI_ACCESS_DENIED");
    await this.subscriptions.lockCategoryCommercialContext(tenantId, tx, [feature]);
    const current = await this.subscriptions.readCategoryCommercialContext(tenantId, tx, this.clock(), [feature]);
    const rows = current.entitlements.filter(row => row.code === feature);
    if (!["active", "expiring"].includes(current.serviceStatus) || !current.newBusinessAllowed
      || !Number.isSafeInteger(current.revision) || current.revision < 1 || rows.length !== 1 || !rows[0].available
      || rows[0].categories.length !== 0) throw new TicketsAiSceneError("entitlement_denied", "AI_ACCESS_DENIED");
    this.active(); return current.revision;
  }

  async source(reader: Pick<Tx, "aiTaskOriginalRequest">, who: Awaited<ReturnType<TicketsAiAuthority["owner"]>>, inputRef: string) {
    const row = await reader.aiTaskOriginalRequest.findFirst({ where: { ...ownerFields(who), id: reference.parse(inputRef),
      sceneCode: TICKETS_START_TOOL.scene, sceneVersion: TICKETS_START_TOOL.version } });
    if (!row || row.id !== inputRef || row.scopeId !== who.scopeId || row.ownerId !== who.actorId || row.ownerKind !== "USER"
      || row.audience !== "OPERATOR" || row.sceneCode !== TICKETS_START_TOOL.scene || row.sceneVersion !== TICKETS_START_TOOL.version
      || row.contractVersion !== "example-tickets-start-1" || row.status !== "STORED" || row.erasedAt !== null
      || row.revision !== 1 || row.previousRequestId !== null) throw unavailable();
    const binding = TicketsStartBindingSchema.parse({ source: { recordId: row.id, revision: row.revision, contentHash: row.contentHash }, original: row.payload });
    if (hash(binding.original.principal) !== hash(who.principal)) throw deny();
    return { row, binding };
  }

  async live(tx: Tx, context: AiExecutionContext, inputRef: string) {
    const who = await this.owner(tx, context), source = await this.source(tx, who, inputRef);
    const { row, binding } = source;
    if (row.authorizationBindingHash !== who.binding || row.creationClosedAt || row.creationCloseKey || row.expiresAt <= this.clock()) throw changed();
    return this.tickets.withTransaction(tx, async service => {
      const receipt = await service.receiptFor(who.principal, "start", binding.original.command);
      // 同事务结束前的原复权会在业务行已前进后再次进入；精确原收据才可解释这次变化。
      if (receipt.status !== "recorded") {
        const current = await service.prepareStart(who.principal, binding.original.command);
        if (hash(current) !== hash(binding.original.fact)) throw changed();
      }
      const entitlementRevision = await this.entitlement(tx, who.principal.tenantId), policy = await this.policy(tx, who.scopeId);
      if (row.policyHash !== policy.hash || row.policyRevision !== policy.revision) throw changed();
      this.active(); return { who, ...source, policy, entitlementRevision };
    }, { principal: who.principal, permission: "start" });
  }

  async task(reader: Pick<Tx, "aiTask" | "aiScope">, context: AiExecutionContext, taskId: string) {
    const who = await this.owner(reader, context), access = aiTaskAccessFromContext(context, reference.parse(taskId), this.clock());
    const row = await reader.aiTask.findFirst({ where: { ...access.where, scopeId: who.scopeId } });
    if (!row || row.id !== taskId || row.scopeId !== who.scopeId || row.scopeKind !== "TENANT" || row.ownerId !== who.actorId
      || row.ownerKind !== "USER" || row.audience !== "OPERATOR" || row.archivedAt || row.sceneCode !== TICKETS_START_TOOL.scene
      || row.sceneVersion !== TICKETS_START_TOOL.version || !row.inputRef || row.inputRevision !== 1
      || row.creationKey !== ticketsAiCreationKey(row.inputRef)) throw deny();
    return { who, row };
  }

  async assertTaskAction(_reader: Pick<Tx, "aiTask" | "aiScope">, context: AiExecutionContext, taskId: string,
    operation: AiTaskRepositoryOperation, native?: Tx) {
    if (!ticketsAiEntryPermission(operation)) throw deny();
    const check = async (tx: Tx) => {
      const task = await this.task(tx, context, taskId), source = await this.source(tx, task.who, task.row.inputRef!);
      if (task.row.inputHash !== source.row.contentHash) throw changed();
      if (TICKETS_AI_WORK_ACTIONS.includes(operation)) await this.live(tx, context, source.row.id);
      else if (source.row.createdAt.getTime() + TICKETS_AI_RETENTION_MS <= this.clock().getTime()) throw unavailable();
      // 历史状态不重新要求新工作权益；精确业务收据另走Core自己的善后授权。
      this.active();
    };
    return native ? check(native) : this.database.$transaction(check, TICKETS_AI_TRANSACTION);
  }

  async assertReference(tx: Tx, context: AiExecutionContext, ref: AiTaskTransactionReference) {
    this.active();
    if (ref.kind === "creation") {
      if (ref.sceneCode !== TICKETS_START_TOOL.scene) throw deny();
      await this.live(tx, context, ref.inputRef); return;
    }
    if (ref.kind === "task" || ref.kind === "task_control") {
      await this.task(tx, context, ref.taskId); return;
    }
    // 本场景没有Invocation或任意step入口，不能借本权威委托另一条模型路线。
    throw deny();
  }

  creation(bound: TicketsBoundAuthority): AiTaskCreationAuthority {
    return { resolve: async (sceneCode, inputRef, native) => {
      if (sceneCode !== TICKETS_START_TOOL.scene) throw deny();
      const check = async (tx: Tx) => {
        const context = await bound.principalOn(tx), source = await this.live(tx, context, inputRef);
        return { context, creationAllowed: true as const, sceneCode, sceneVersion: TICKETS_START_TOOL.version,
          inputRef: source.row.id, inputRevision: source.row.revision, inputHash: source.row.contentHash };
      };
      return native ? check(native) : this.database.$transaction(check, TICKETS_AI_TRANSACTION);
    }, assertCreationOpen: async (tx, command, grant) => {
      if (command.creationKey !== ticketsAiCreationKey(command.inputRef)) throw deny();
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE id = ${command.inputRef} AND scopeId = ${grant.scopeId} FOR UPDATE`);
      const source = await this.live(tx, grant.context, command.inputRef);
      if (source.row.contentHash !== grant.inputHash || source.who.scopeId !== grant.scopeId) throw changed();
    }, registerActions: async (tx, created) => {
      const context = await bound.principalOn(tx), source = await this.live(tx, context, created.inputRef);
      if (source.who.scopeId !== created.scopeId) throw deny();
      const operations = [...TICKETS_AI_WORK_ACTIONS, ...TICKETS_AI_READ_ACTIONS];
      const inserted = await tx.aiTaskActionPolicy.createMany({ data: operations.map(operation => ({ scopeId: created.scopeId,
        taskId: created.taskId, operation, revision: 1, requiredPermissions: [ticketsAiEntryPermission(operation)!],
        expiresAt: TICKETS_AI_WORK_ACTIONS.includes(operation) ? source.row.expiresAt
          : new Date(source.row.createdAt.getTime() + TICKETS_AI_RETENTION_MS) })) });
      if (inserted.count !== operations.length) throw unavailable();
    } };
  }

  /** 显式保存一份受权事实；requestKey就是普通业务operationId，同键异参不可覆盖。 */
  async prepare(bound: TicketsBoundAuthority, command: unknown): Promise<TicketsStartBinding> {
    const parsed = ChangeTicketStateSchema.parse(command);
    let callbackCompleted = false;
    try {
      const saved = await this.database.$transaction(async tx => {
        const context = await bound.principalOn(tx), who = await this.owner(tx, context);
        const value = await this.tickets.withTransaction(tx, async service => {
          const existing = await tx.aiTaskOriginalRequest.findUnique({ where: { scopeId_audience_ownerKind_ownerId_requestKey: {
            ...ownerFields(who), requestKey: parsed.operationId } } });
          if (existing) {
            const original = await this.source(tx, who, existing.id);
            if (hash(original.binding.original.command) !== hash(parsed)) throw changed();
            return original.binding;
          }
          if ((await service.receiptFor(who.principal, "start", parsed)).status === "recorded") throw changed();
          await this.entitlement(tx, who.principal.tenantId);
          const policy = await this.policy(tx, who.scopeId), original = await prepareTicketsStart(service, who.principal, parsed);
          const now = this.clock(), expiresAt = new Date(Math.min(policy.expiresAt.getTime(), now.getTime() + 30 * 60000));
          const id = randomUUID(), contentHash = hash(original);
          await tx.aiTaskOriginalRequest.create({ data: { ...ownerFields(who), id, contractVersion: original.version,
            sceneCode: TICKETS_START_TOOL.scene, sceneVersion: TICKETS_START_TOOL.version, requestKey: parsed.operationId,
            revision: 1, payload: original, contentHash, authorizationBindingHash: who.binding,
            policyRevision: policy.revision, policyHash: policy.hash, expiresAt, createdAt: now } });
          return TicketsStartBindingSchema.parse({ source: { recordId: id, revision: 1, contentHash }, original });
        }, { principal: who.principal, permission: "start" });
        if ((await this.owner(tx, await bound.principalOn(tx))).binding !== who.binding) throw deny();
        this.active(); callbackCompleted = true; return value;
      }, TICKETS_AI_TRANSACTION);
      const read = await this.readPreparation(bound, parsed.operationId);
      if (!read.binding || hash(read.binding) !== hash(saved)) throw changed();
      bound.assertCurrent(); this.active(); return saved;
    } catch (error) { if (callbackCompleted) throw new TicketsAiUnknownError(); throw error; }
  }

  /** 原输入回读不产生新Task或操作键；缺记录不代表原prepare未提交。 */
  async readPreparation(bound: TicketsBoundAuthority, operationId: string) {
    const command = ChangeTicketStateSchema.shape.operationId.parse(operationId);
    return this.database.$transaction(async tx => {
      const context = await bound.principalOn(tx), who = await this.owner(tx, context);
      const row = await tx.aiTaskOriginalRequest.findUnique({ where: { scopeId_audience_ownerKind_ownerId_requestKey: {
        ...ownerFields(who), requestKey: command } } });
      const source = row ? await this.source(tx, who, row.id) : null;
      if (source) await this.tickets.withTransaction(tx, service => service.get(who.principal, source.binding.original.command.ticketId));
      if ((await this.owner(tx, await bound.principalOn(tx))).binding !== who.binding) throw deny();
      return { binding: source?.binding ?? null, retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }, TICKETS_AI_TRANSACTION);
  }
}
