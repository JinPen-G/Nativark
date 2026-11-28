/** 显式发布唯一工单开始能力到原AiTaskPlanPolicy；沿公共租户配置授权与原审计收据。
 * 不创建默认权限、权益或额度；发布并不批准/执行任务，读取也不补建scope或policy。
 */
import type { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
import type { CorePrincipal } from "@rental-os/core-contracts";
import type { AiExecutionContext } from "@rental-os/platform-contracts/ai-gateway";
import { AI_CONTRACT_DRAFT_VERSION } from "@rental-os/platform-contracts/ai-gateway";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import { aiTaskAccessFromContext } from "@rental-os/ai-native-server/task-observation";
import { aiTaskRunnerLimitsSchema } from "@rental-os/ai-native-server/task-runner-resources";
import { beginTenantConfigurationTransaction, type TenantConfigurationTransactionParticipant } from "@rental-os/ai-native-server/tenant-configuration-transactions";
import type { Prisma } from "@prisma/client";
import { TICKETS_START_TOOL } from "./tickets-start.mjs";
import { TICKETS_AI_TOOLS, TICKETS_AI_TRANSACTION, TICKETS_AI_RETENTION_MS, TicketsAiSceneError, TicketsAiUnknownError } from "./tickets-authority.mjs";

type Tx = Prisma.TransactionClient;
const { z } = createRequire(import.meta.url)("zod") as typeof import("zod");
const revision = z.number().int().min(1).max(4294967294);
export const TicketsAiPolicySchema = z.object({ revision, enabled: z.boolean(), expiresAt: z.string().datetime({ offset: true }), limits: aiTaskRunnerLimitsSchema }).strict();
const policySchema = TicketsAiPolicySchema;
export const TicketsAiPublicationCommandSchema = policySchema.omit({ revision: true }).extend({ operationId: z.string().uuid(), expectedRevision: revision.nullable() }).strict();
export const TicketsAiPublicationReceiptSchema = z.object({ version: z.literal("example-tickets-ai-publication-1"), operationId: z.string().uuid(),
  scopeId: z.string().uuid(), commandHash: z.string().regex(/^[a-f0-9]{64}$/), policy: policySchema, policyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const receiptSchema = TicketsAiPublicationReceiptSchema;
const conflict = () => new TicketsAiSceneError("basis_changed", "TICKETS_AI_BASIS_CHANGED");
const unavailable = () => new TicketsAiSceneError("authority_unavailable");
const logId = (principal: CorePrincipal, operationId: string) => {
  const h = hash(["example-tickets-ai-publication-1", principal, operationId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function createTicketsAiPublication(input: { database: PrismaClient;
  configurations: TenantConfigurationTransactionParticipant<Tx>;
  /** 从当前已绑定的公共Task身份读取；不会接受HTTP body提供的context。 */
  current(): Promise<AiExecutionContext>;
  clock?: () => Date }) {
  const clock = input.clock ?? (() => new Date()), action = "example-tickets.ai-publication.changed";
  // 原scope正规化取正式helper；current是当前身份权威，不能由发布输入补造。
  const identity = async () => {
    const context = await input.current();
    if (context.contractVersion !== AI_CONTRACT_DRAFT_VERSION || context.audience !== "operator"
      || context.actor.kind !== "user" || context.scope.kind !== "tenant") throw unavailable();
    return { principal: { tenantId: context.scope.tenantId, subjectId: context.actor.userId, audience: "operator" as const },
      access: aiTaskAccessFromContext(context, "tickets-publication", clock()) };
  };
  const policyKey = (scopeId: string) => ({ scopeId, sceneCode: TICKETS_START_TOOL.scene, sceneVersion: TICKETS_START_TOOL.version });
  async function readRow(tx: Tx, scopeId: string) {
    const key = policyKey(scopeId), row = await tx.aiTaskPlanPolicy.findUnique({ where: { scopeId_sceneCode_sceneVersion: key } });
    if (!row) return null;
    if (Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value) || hash(row.allowedTools) !== hash(TICKETS_AI_TOOLS)) throw unavailable();
    return policySchema.parse({ revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt.toISOString(), limits: row.limits });
  }
  async function original(tx: Tx, principal: CorePrincipal, operationId: string) {
    const id = logId(principal, operationId), row = await tx.operationLog.findUnique({ where: { id } });
    if (!row) return { id, receipt: null };
    const receipt = receiptSchema.parse(row.detail);
    if (row.id !== id || row.tenantId !== principal.tenantId || row.userId !== principal.subjectId || row.workspaceId !== null
      || row.action !== action || receipt.operationId !== operationId || receipt.policyHash !== hash(receipt.policy)) throw unavailable();
    return { id, receipt };
  }
  async function withManagement<T>(work: (tx: Tx, who: Awaited<ReturnType<typeof identity>>) => Promise<T>, writes = false) {
    const before = await identity(); let callbackCompleted = false;
    try {
      const result = await input.database.$transaction(async tx => {
        const lease = await beginTenantConfigurationTransaction(tx,
          { tenantId: before.principal.tenantId, actorId: before.principal.subjectId }, input.configurations);
        try { const result = await work(tx, before); await lease.revalidate(); callbackCompleted = writes; return result; }
        finally { lease.close(); }
      }, TICKETS_AI_TRANSACTION);
      if ((await identity()).access.bindingKey !== before.access.bindingKey) throw unavailable();
      return result;
    } catch (error) { if (callbackCompleted) throw new TicketsAiUnknownError(); throw error; }
  }
  return Object.freeze({
    read: () => withManagement(async (tx, who) => {
      const scope = await tx.aiScope.findFirst({ where: who.access.scope });
      if (scope && Object.entries(who.access.scope).some(([key, value]) => scope[key as keyof typeof scope] !== value)) throw unavailable();
      return { policy: scope ? await readRow(tx, scope.id) : null, executionGranted: false as const };
    }),
    operation: (operationId: string) => withManagement(async (tx, who) => {
      const receipt = (await original(tx, who.principal, z.string().uuid().parse(operationId))).receipt;
      return { receipt, retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }),
    save: (value: unknown) => {
      const command = TicketsAiPublicationCommandSchema.parse(value), deadline = new Date(command.expiresAt);
      if (command.limits.maxStepMs > command.limits.maxTotalMs || deadline <= clock()
        || deadline.getTime() - clock().getTime() > TICKETS_AI_RETENTION_MS) throw conflict();
      return withManagement(async (tx, who) => {
        const prior = await original(tx, who.principal, command.operationId);
        if (prior.receipt) { if (prior.receipt.commandHash !== hash(command)) throw conflict(); return prior.receipt; }
        const scope = await tx.aiScope.upsert({ where: { scopeKey: who.access.scope.scopeKey }, create: who.access.scope, update: {} });
        if (Object.entries(who.access.scope).some(([key, value]) => scope[key as keyof typeof scope] !== value)) throw unavailable();
        await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_scopes WHERE id = ${scope.id} FOR UPDATE`);
        const key = policyKey(scope.id), old = await readRow(tx, scope.id);
        if ((old?.revision ?? null) !== command.expectedRevision || deadline <= clock()) throw conflict();
        const policy = policySchema.parse({ revision: (old?.revision ?? 0) + 1, enabled: command.enabled,
          limits: command.limits, expiresAt: command.expiresAt });
        const data = { ...policy, expiresAt: deadline, allowedTools: [...TICKETS_AI_TOOLS] };
        if (old) {
          if ((await tx.aiTaskPlanPolicy.updateMany({ where: { ...key, revision: old.revision }, data })).count !== 1) throw conflict();
        } else await tx.aiTaskPlanPolicy.create({ data: { ...key, ...data } });
        const receipt = receiptSchema.parse({ version: "example-tickets-ai-publication-1", operationId: command.operationId,
          scopeId: scope.id, commandHash: hash(command), policy, policyHash: hash(policy) });
        await tx.operationLog.create({ data: { id: prior.id, tenantId: who.principal.tenantId, userId: who.principal.subjectId,
          workspaceId: null, action, detail: receipt } });
        return receipt;
      }, true);
    }
  });
}
