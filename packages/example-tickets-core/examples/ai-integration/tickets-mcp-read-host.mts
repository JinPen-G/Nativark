/** 工单MCP读取的原目标、业务事务、字段释放与原持久计量装配。
 * 原目标只由已登录的人类审核入口登记；工具调用只定位，不创建/换目标或重置额度。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { TICKETS_HTTP, type TicketsService } from "@rental-os/example-tickets-core";
import { TicketsMcpReleasedFieldsSchema } from "@rental-os/example-tickets-core/mcp-http";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { consumeRateLimitBucket, PLATFORM_API_RATE_LIMIT_TABLE } from "@rental-os/platform-server/public-rate-limit";
import { createPersistentOAuthAccessReader } from "@rental-os/mcp-server/persistent-oauth-tokens";
import { captureMcpReadInput } from "@rental-os/mcp-server/persistent-read-accounting";
import { createPrismaMcpReadAccounting } from "@rental-os/mcp-server/prisma-mcp-read-accounting";
import { captureOriginalMcpReadTarget, captureOriginalMcpReadBudgetSnapshot, captureOriginalMcpReadCallSnapshot,
  type OriginalMcpReadTarget } from "@rental-os/mcp-server/prisma-mcp-read-budget";
import type { McpProtocolTraffic } from "@rental-os/mcp-server/protocol-traffic";
import type { McpReadAuthorization, McpReadTools } from "@rental-os/mcp-server";
import type { JsonSchemaType } from "@rental-os/mcp-server/original-read-tool";
import { createTicketsMcpReadTools, TICKETS_MCP_READ_NAMES } from "./tickets-reads.mjs";
import { TICKETS_MCP_SCOPES, TicketsMcpError, type TicketsMcpTenant, type TicketsMcpGrant, type TicketsMcpBusiness } from "./tickets-mcp-tenant.mjs";

type Tx = Prisma.TransactionClient;
const toolNames = [TICKETS_MCP_READ_NAMES.get, TICKETS_MCP_READ_NAMES.receipt] as const;
type Tool = typeof toolNames[number];
const kind = (name: string): "get" | "receipt" => {
  if (name === toolNames[0]) return "get"; if (name === toolNames[1]) return "receipt"; throw new TicketsMcpError("denied");
};
const live = (signal: AbortSignal) => { if (signal.aborted) throw new TicketsMcpError("unavailable"); };
const equal = (a: unknown, b: unknown) => hash(a) === hash(b);
const decode = (raw: unknown): unknown => typeof raw === "string" ? JSON.parse(raw) : raw;
const keyFor = (who: CorePrincipal) => hash({ kind: "example-tickets.mcp-owner-1", tenantId: who.tenantId, userId: who.subjectId });
const bindingKey = (goalId: string, tool: string, inputHash: string) => hash({ kind: "example-tickets.mcp-input-1", goalId, tool, inputHash });
const goalSchema = z.object({ ownerKey: z.string().regex(/^[a-f0-9]{64}$/), tenantId: z.string(), userId: z.string(),
  target: z.unknown(), authorityHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Goal = Omit<z.infer<typeof goalSchema>, "target"> & { target: OriginalMcpReadTarget };
const approvalHash = (grant: TicketsMcpGrant) => hash({ principal: grant.principal, session: grant.session,
  grantId: grant.id, grantRevision: grant.revision, policyHash: grant.policyHash });
const outputSchemas: Readonly<{ get: JsonSchemaType; receipt: JsonSchemaType }> = {
  get: { type: "object", additionalProperties: false, required: ["id", "subject", "state", "revision"], properties: {
    id: { type: "string", maxLength: 36 }, subject: { type: "string", maxLength: 160 }, state: { type: "string", enum: ["open", "in_progress", "closed"] },
    revision: { type: "integer", minimum: 1 } } },
  receipt: { type: "object", additionalProperties: false, required: ["status", "receipt", "historicalSnapshot"], properties: {
    status: { type: "string", enum: ["recorded", "unavailable"] }, historicalSnapshot: { type: "boolean", const: true },
    receipt: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["operationId", "ticket"], properties: {
      operationId: { type: "string", maxLength: 36 }, ticket: { type: "object", additionalProperties: false, required: ["id", "state", "revision"], properties: {
        id: { type: "string", maxLength: 36 }, state: { type: "string", enum: ["open", "in_progress", "closed"] }, revision: { type: "integer", minimum: 1 } } } } }] } } }
};

export function createTicketsMcpReadHost(input: { database: PrismaClient; tenant: TicketsMcpTenant; tickets: TicketsMcpBusiness; resource: string }) {
  const { tenant } = input;
  const access = createPersistentOAuthAccessReader({ enabled: true, resourceUrl: input.resource, allowedScopes: TICKETS_MCP_SCOPES }, tenant.access);
  const active = new AsyncLocalStorage<{ active: boolean; service: TicketsService; grant: TicketsMcpGrant;
    authorization: McpReadAuthorization; tool: Tool; inputHash: string }>();
  const scope = (grant: TicketsMcpGrant, name: string) => {
    if (grant.policy.fieldPolicy !== "tickets-summary-v1" || !grant.policy.scopes.includes(kind(name) === "get" ? TICKETS_MCP_SCOPES[0] : TICKETS_MCP_SCOPES[1]))
      throw new TicketsMcpError("denied");
  };
  const sameAuthorization = (expected: McpReadAuthorization, actual: { subject: string; clientId: string; resource: string; scopes: readonly string[] }) => {
    if (expected.subject !== actual.subject || expected.clientId !== actual.clientId || expected.resource !== actual.resource
      || !equal(expected.scopes, actual.scopes)) throw new TicketsMcpError("denied");
  };
  // 人工预览与真正外发使用同一个字段投影；描述、受理人及tenant不离开业务边界。
  const project = (grant: TicketsMcpGrant, name: string, value: unknown) => {
    scope(grant, name);
    if (kind(name) === "get") {
      const ticket = TICKETS_HTTP.get.response.parse(value);
      if (ticket.tenantId !== grant.principal.tenantId) throw new TicketsMcpError("denied");
      return TicketsMcpReleasedFieldsSchema.parse({ id: ticket.id, subject: ticket.subject, state: ticket.state, revision: ticket.revision });
    }
    const original = TICKETS_HTTP.receipt.response.parse(value);
    if (original.status === "unavailable") return TicketsMcpReleasedFieldsSchema.parse({ status: "unavailable", receipt: null, historicalSnapshot: true });
    const { receipt } = original;
    if (receipt.ticket.tenantId !== grant.principal.tenantId) throw new TicketsMcpError("denied");
    return TicketsMcpReleasedFieldsSchema.parse({ status: "recorded", historicalSnapshot: true, receipt: { operationId: receipt.operationId,
      ticket: { id: receipt.ticket.id, state: receipt.ticket.state, revision: receipt.ticket.revision } } });
  };
  async function readGoal(native: Tx, ownerKey: string): Promise<Goal | undefined> {
    const rows = await native.$queryRaw<Array<{ id: string; tenant_id: string; user_id: string; record_json: unknown }>>`
      SELECT id, tenant_id, user_id, record_json FROM example_tickets_mcp_goals WHERE owner_key = ${ownerKey} FOR UPDATE`;
    if (rows.length > 1) throw new TicketsMcpError("unavailable"); if (!rows.length) return undefined;
    const body = goalSchema.parse(decode(rows[0].record_json)), target = captureOriginalMcpReadTarget(body.target);
    if (body.ownerKey !== ownerKey || target.goalId !== rows[0].id || body.tenantId !== rows[0].tenant_id || body.userId !== rows[0].user_id
      || keyFor({ tenantId: body.tenantId, subjectId: body.userId, audience: "operator" }) !== ownerKey) throw new TicketsMcpError("unavailable");
    return { ...body, target };
  }
  async function checkBudget(native: Tx, goal: Goal) {
    const rows = await native.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads
      FROM mcp_read_goal_budgets WHERE goalId = ${goal.target.goalId} FOR UPDATE`;
    if (rows.length > 1) throw new TicketsMcpError("unavailable");
    if (rows.length) {
      const budget = captureOriginalMcpReadBudgetSnapshot(rows[0], goal.target.goalId, goal.target);
      if (!equal(budget.target, goal.target) || budget.consumedCalls >= 20 || budget.concurrentReads >= 2
        || budget.consumedActiveMs + budget.reservedActiveMs >= 300000)
        throw new TicketsMcpError("denied", { state: "denied", reason: "limit_reached" });
    }
  }
  const current = () => { const entry = active.getStore(); if (!entry?.active) throw new TicketsMcpError("unavailable"); return entry; };
  const accounting = createPrismaMcpReadAccounting(input.database, { async resolve(call, value, native, signal) {
    // 原计量使用独立短事务；只读持久目标，不重新取得外层持有的Auth/grant/工单锁。
    const entry = current(), captured = captureMcpReadInput(value);
    if (!equal(call.authorization, entry.authorization) || call.toolName !== entry.tool || captured.inputHash !== entry.inputHash) throw new TicketsMcpError("denied");
    const goal = await readGoal(native, keyFor(entry.grant.principal)); live(signal);
    if (!goal || goal.authorityHash !== approvalHash(entry.grant) || goal.target.grantId !== entry.grant.id) return undefined;
    const key = bindingKey(goal.target.goalId, call.toolName, captured.inputHash);
    const bindings = await native.$queryRaw<Array<{ goal_id: string; record_json: unknown }>>`
      SELECT goal_id, record_json FROM example_tickets_mcp_read_bindings WHERE binding_key = ${key} FOR UPDATE`;
    live(signal); if (bindings.length > 1) throw new TicketsMcpError("unavailable"); if (!bindings.length) return undefined;
    const expected = { key, goalId: goal.target.goalId, tool: call.toolName, inputHash: captured.inputHash, authorityHash: goal.authorityHash };
    if (bindings[0].goal_id !== goal.target.goalId || !equal(decode(bindings[0].record_json), expected)) throw new TicketsMcpError("unavailable");
    return captureOriginalMcpReadTarget(goal.target, call);
  } });
  const providers: Omit<McpReadTools, "tools"> = {
    publication: { allows: (authorization, tool, signal) => tenant.store.transaction(async view => {
      const verified = await access.readIn(view, authorization.token, signal); sameAuthorization(authorization, verified.authorization);
      return tenant.withGrantIn(tenant.store.native(view), verified.grantId, async grant => grant.policy.fieldPolicy === "tickets-summary-v1"
        && grant.policy.scopes.includes(kind(tool.name) === "get" ? TICKETS_MCP_SCOPES[0] : TICKETS_MCP_SCOPES[1]), signal);
    }, signal) },
    authority: { withRead: (authorization, name, value, consume, signal) => tenant.store.transaction(async view => {
      const tool = name as Tool; kind(tool); const command = TICKETS_HTTP[kind(tool)].params.parse(value);
      const verified = await access.readIn(view, authorization.token, signal); sameAuthorization(authorization, verified.authorization);
      const native = tenant.store.native(view);
      const result = await tenant.withGrantIn(native, verified.grantId, async grant => {
        scope(grant, tool);
        return input.tickets.withTransaction(native, async service => {
          const entry = { active: true, service, grant, authorization, tool, inputHash: captureMcpReadInput(command).inputHash };
          try { return await active.run(entry, consume); } finally { entry.active = false; }
        });
      }, signal);
      const after = await access.readIn(view, authorization.token, signal); if (!equal(after, verified)) throw new TicketsMcpError("denied"); return result;
    }, signal) },
    accounting,
    release: { async project(authorization, name, value, signal) {
      const entry = current(); live(signal);
      if (name !== entry.tool || !equal(authorization, entry.authorization)) throw new TicketsMcpError("denied");
      return project(entry.grant, name, value);
    } }
  };
  const integration = createTicketsMcpReadTools({ providers, outputSchemas, currentPrincipal: () => current().grant.principal,
    service: { get: (principal, id) => { const entry = current(); if (!equal(entry.grant.principal, principal)) throw new TicketsMcpError("denied"); return entry.service.get(principal, id); },
      receipt: (principal, operationId) => { const entry = current(); if (!equal(entry.grant.principal, principal)) throw new TicketsMcpError("denied"); return entry.service.receipt(principal, operationId); } } });
  if (integration.status !== "configured") throw new TicketsMcpError("unavailable");
  const protocolTraffic: McpProtocolTraffic = { async consume(authorization, operations, signal) {
    const selected = z.array(z.enum(["mcp.initialize", "mcp.server.discover", "mcp.tools.list", "mcp.prompts.list", "mcp.prompts.get",
      "mcp.resources.list", "mcp.resources.templates.list"])).min(1).max(50).parse(operations);
    const exceeded = await tenant.store.transaction(async view => {
      const verified = await access.readIn(view, authorization.token, signal); sameAuthorization(authorization, verified.authorization);
      const native = tenant.store.native(view);
      return tenant.withGrantIn(native, verified.grantId, async grant => {
        let over = false;
        for (const operation of selected) {
          // 同Native的官方持久桶。owner不随grant/token/政策修订变化，超额也提交原计数后再拒绝。
          const count = await consumeRateLimitBucket({ $transaction: work => work(native) },
            { code: `example-tickets.${operation}`, windowSeconds: grant.policy.discovery.windowSeconds },
            keyFor(grant.principal), Date.now(), undefined, PLATFORM_API_RATE_LIMIT_TABLE);
          over ||= count > grant.policy.discovery.limit; live(signal);
        }
        const after = await access.readIn(view, authorization.token, signal);
        if (!equal(after, verified)) throw new TicketsMcpError("denied"); return over;
      }, signal);
    }, signal);
    if (exceeded) throw new TicketsMcpError("denied");
  } };
  const review = async (native: Tx, grant: TicketsMcpGrant, name: string, value: unknown) => {
    const tool = name as Tool; scope(grant, tool); const command = TICKETS_HTTP[kind(tool)].params.parse(value);
    const original = await input.tickets.withTransaction<unknown>(native, service => kind(tool) === "get"
      ? service.get(grant.principal, TICKETS_HTTP.get.params.parse(command).ticketId)
      : service.receipt(grant.principal, TICKETS_HTTP.receipt.params.parse(command).operationId));
    const captured = captureMcpReadInput(command), authorityHash = approvalHash(grant);
    const reviewHash = hash({ version: "tickets-mcp-read-review-1", tool, inputHash: captured.inputHash,
      authorityHash, factHash: hash(original), fields: grant.policy.fieldPolicy });
    return { tool, command, inputHash: captured.inputHash, authorityHash, reviewHash, released: project(grant, tool, original) };
  };
  return Object.freeze({ readTools: integration.readTools, protocolTraffic,
    available: (grantId: string, ticketId: string, signal: AbortSignal) => tenant.withBrowserGrant(grantId, async (native, grant) => {
      const selected = await review(native, grant, TICKETS_MCP_READ_NAMES.get, { ticketId });
      const goal = await readGoal(native, keyFor(grant.principal)); live(signal);
      if (!goal || goal.authorityHash !== selected.authorityHash || goal.target.grantId !== grantId) throw new TicketsMcpError("denied");
      await checkBudget(native, goal);
      const key = bindingKey(goal.target.goalId, selected.tool, selected.inputHash);
      const bindings = await native.$queryRaw<Array<{ goal_id: string; record_json: unknown }>>`
        SELECT goal_id, record_json FROM example_tickets_mcp_read_bindings WHERE binding_key = ${key} FOR UPDATE`;
      const expected = { key, goalId: goal.target.goalId, tool: selected.tool, inputHash: selected.inputHash, authorityHash: goal.authorityHash };
      if (bindings.length !== 1 || bindings[0].goal_id !== goal.target.goalId || !equal(decode(bindings[0].record_json), expected)) throw new TicketsMcpError("denied");
      live(signal);
    }, signal),
    original: (grantId: string, signal: AbortSignal) => tenant.withBrowserOwnedGrant(grantId, async (native, grant) => {
      const goal = await readGoal(native, keyFor(grant.principal)); live(signal);
      const absent = { goal: null, budget: null, calls: [], retryable: false as const, absence: "not_proof_of_no_commit" as const };
      if (!goal || goal.target.grantId !== grant.id) return absent;
      const rows = await native.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads
        FROM mcp_read_goal_budgets WHERE goalId = ${goal.target.goalId} FOR UPDATE`;
      live(signal); if (rows.length > 1) throw new TicketsMcpError("unavailable");
      const goalRef = { id: goal.target.goalId, revision: goal.target.goalRevision, grantId: goal.target.grantId };
      if (!rows.length) return { ...absent, goal: goalRef };
      const budget = captureOriginalMcpReadBudgetSnapshot(rows[0], goal.target.goalId, goal.target);
      if (!equal(budget.target, goal.target)) throw new TicketsMcpError("unavailable");
      const calls = await native.$queryRaw<Array<{ callId: string }>>`SELECT callId, goalId, grantId, callBindingHash, recordJson, state, activeMs
        FROM mcp_read_calls WHERE goalId = ${goal.target.goalId} ORDER BY callId LIMIT 21 FOR UPDATE`;
      live(signal); if (calls.length > 20 || calls.length !== budget.consumedCalls) throw new TicketsMcpError("unavailable");
      return { goal: goalRef, budget: { revision: budget.revision, consumedCalls: budget.consumedCalls, consumedActiveMs: budget.consumedActiveMs,
        reservedActiveMs: budget.reservedActiveMs, concurrentReads: budget.concurrentReads }, calls: calls.map(row => {
          const call = captureOriginalMcpReadCallSnapshot(row, row.callId, budget);
          return { callId: call.reservation.callId, state: call.state, activeMs: call.activeMs,
            inputHash: call.reservation.inputHash, retryable: false as const };
        }), retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }, signal),
    preview: (grantId: string, tool: string, value: unknown, signal: AbortSignal) => tenant.withBrowserGrant(grantId, async (native, grant) => {
      const selected = await review(native, grant, tool, value); live(signal);
      return { tool: selected.tool, input: selected.command, fieldPolicy: grant.policy.fieldPolicy,
        released: selected.released, reviewHash: selected.reviewHash, executionGranted: false as const };
    }, signal),
    authorizeRead: (grantId: string, tool: string, value: unknown, reviewedHash: string, signal: AbortSignal) => tenant.withBrowserGrant(grantId, async (native, grant) => {
      const selected = await review(native, grant, tool, value); live(signal);
      if (selected.reviewHash !== reviewedHash) throw new TicketsMcpError("changed");
      const ownerKey = keyFor(grant.principal); let goal = await readGoal(native, ownerKey);
      if (goal && (goal.authorityHash !== selected.authorityHash || goal.target.grantId !== grantId)) throw new TicketsMcpError("changed");
      if (!goal) {
        const target = captureOriginalMcpReadTarget({ goalId: randomUUID(), goalRevision: 1, grantId, subject: grant.subject,
          clientId: grant.policy.clientId, resource: input.resource, scopes: [...grant.policy.scopes], purpose: "example-tickets.read",
          originalInputHash: selected.inputHash, policyVersion: `tickets-summary-v1:${grant.policy.revision}` });
        goal = { ownerKey, tenantId: grant.principal.tenantId, userId: grant.principal.subjectId, target, authorityHash: selected.authorityHash };
        if (await native.$executeRaw`INSERT INTO example_tickets_mcp_goals (owner_key, id, tenant_id, user_id, record_json)
          VALUES (${ownerKey}, ${target.goalId}, ${goal.tenantId}, ${goal.userId}, ${JSON.stringify(goal)})` !== 1) throw new TicketsMcpError("unavailable");
      }
      await checkBudget(native, goal); live(signal);
      const key = bindingKey(goal.target.goalId, tool, selected.inputHash), record = { key, goalId: goal.target.goalId,
        tool, inputHash: selected.inputHash, authorityHash: goal.authorityHash };
      const prior = await native.$queryRaw<Array<{ record_json: unknown }>>`SELECT record_json FROM example_tickets_mcp_read_bindings WHERE binding_key = ${key} FOR UPDATE`;
      if (prior.length > 1 || prior.length === 1 && !equal(decode(prior[0].record_json), record)) throw new TicketsMcpError("changed");
      if (!prior.length) {
        if (await native.$executeRaw`INSERT INTO example_tickets_mcp_read_bindings (binding_key, goal_id, record_json)
          VALUES (${key}, ${goal.target.goalId}, ${JSON.stringify(record)})` !== 1) throw new TicketsMcpError("unavailable");
        await native.operationLog.create({ data: { id: randomUUID(), tenantId: goal.tenantId, userId: goal.userId, workspaceId: null,
          action: "example-tickets.mcp.read-authorized", detail: { bindingKey: key, goalId: goal.target.goalId, reviewHash: reviewedHash } } });
      }
      return { bindingKey: key, goalId: goal.target.goalId, retryable: false as const, executionGranted: false as const };
    }, signal)
  });
}
