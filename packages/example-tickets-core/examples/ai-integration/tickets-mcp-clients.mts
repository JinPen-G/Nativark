/** 工单宿主的显式SaaS public-client管理，复用原注册CAS、原收据与原身份租约。
 * 租户管理员、模型或OAuth客户端不能注册；注册不产生租户发布或个人grant。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlatformAuthService, PlatformPrincipalAuthority, RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";
import { TicketsMcpError, TICKETS_MCP_SCOPES, TICKETS_MCP_TRANSACTION } from "./tickets-mcp-tenant.mjs";
import type { TicketsMcpRequest } from "./tickets-mcp-application.mjs";
const { z } = createRequire(import.meta.url)("zod") as typeof import("zod");
import { TICKETS_MCP_CLIENT_INPUTS, type TicketsMcpClientAction } from "@rental-os/example-tickets-core/mcp-http";
export { TICKETS_MCP_CLIENT_INPUTS, TICKETS_MCP_CLIENT_RESPONSES } from "@rental-os/example-tickets-core/mcp-http";
const paths = Object.keys(TICKETS_MCP_CLIENT_INPUTS).map(action => `/cores/example-tickets/mcp-clients/${action}`);
export function createTicketsMcpClients(input: { database: PrismaClient; auth: Pick<PlatformAuthService, "resolveAccessContext">;
  principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, "lock">; origin: string;
  assertDataAvailable(native: Prisma.TransactionClient): Promise<void> }) {
  const browser = new AsyncLocalStorage<{ actorId: string; tenantId: string; active: boolean }>();
  const current = () => {
    const identity = getRequestIdentity();
    if (!identity?.userId || !identity.tenantId || identity.isSaasAdmin !== true || identity.audience !== "operator"
      || identity.workspaceId !== undefined || identity.staffApi || !identity.accessSession) throw new TicketsMcpError("denied");
    return identity as typeof identity & { userId: string; tenantId: string };
  };
  const authorize = async (native: Prisma.TransactionClient, signal: AbortSignal) => {
    signal.throwIfAborted(); const identity = current(); await input.assertDataAvailable(native);
    const lease = await input.principals.lock(native, { tenantId: identity.tenantId, subjectId: identity.userId, audience: "operator" }, identity.tenantId);
    const user = await lease.revalidate();
    if (!user.isSaasAdmin || !hasEffectivePermission(user.permissions, "system:params:manage")) throw new TicketsMcpError("denied");
    signal.throwIfAborted(); current(); return { actorId: user.id, tenantId: user.tenantId };
  };
  const registry = createPrismaPublicClientRegistry(input.database, {
    async authorize(native, command, signal) {
      const entry = browser.getStore(); if (!entry?.active) throw new TicketsMcpError("denied");
      const owner = await authorize(native, signal);
      if (owner.actorId !== entry.actorId || owner.tenantId !== entry.tenantId || command.registration?.scopes.some(scope => !TICKETS_MCP_SCOPES.includes(scope as typeof TICKETS_MCP_SCOPES[number])))
        throw new TicketsMcpError("denied");
      return { actorId: owner.actorId };
    },
    async audit(native, receipt, signal) {
      const owner = await authorize(native, signal);
      if (owner.actorId !== receipt.actorId) throw new TicketsMcpError("denied");
      await native.operationLog.create({ data: { id: randomUUID(), tenantId: owner.tenantId, userId: owner.actorId, workspaceId: null,
        action: "example-tickets.mcp.client-registered", detail: receipt } }); signal.throwIfAborted();
    }
  });
  const access: RegisteredCoreHttpAccess = {
    registered: (method, path, audience) => method === "POST" && audience === "operator" && paths.includes(path),
    async authorize(method, path) {
      try {
        if (method !== "POST" || !paths.includes(path)) throw new TicketsMcpError("denied");
        await input.database.$transaction(native => authorize(native, AbortSignal.timeout(15000)), TICKETS_MCP_TRANSACTION);
      } catch (error) {
        // 原Guard在Controller外调用此口；拒绝不能被当作500，也不能把未知权威当作已拒绝。
        if (error instanceof HttpException) throw error;
        if (error instanceof TicketsMcpError && error.kind === "denied") throw new ForbiddenException({ code: "MCP_ACCESS_DENIED", retryable: false });
        throw new ServiceUnavailableException({ code: "MCP_UNAVAILABLE", retryable: false });
      }
    }
  };
  return Object.freeze({ access, async consume(action: TicketsMcpClientAction, request: TicketsMcpRequest, value: unknown, signal: AbortSignal) {
    if (request.headers.origin !== undefined && request.headers.origin !== new URL(input.origin).origin) throw new TicketsMcpError("denied");
    const identity = current(), header = z.string().max(8192).parse(request.headers.authorization);
    const auth = await input.auth.resolveAccessContext(header), user = auth?.tenantUser;
    if (!user?.isSaasAdmin || user.mustChangePassword || user.id !== identity.userId || user.tenantId !== identity.tenantId
      || !auth?.accessSession || hash(auth.accessSession) !== hash(identity.accessSession)) throw new TicketsMcpError("denied");
    const entry = { actorId: user.id, tenantId: user.tenantId, active: true };
    try { return await browser.run(entry, () => {
      if (action === "read") return registry.readManaged(TICKETS_MCP_CLIENT_INPUTS.read.parse(value).clientId, signal);
      if (action === "save") return registry.save(TICKETS_MCP_CLIENT_INPUTS.save.parse(value), signal);
      const command = TICKETS_MCP_CLIENT_INPUTS.operation.parse(value); return registry.operation(command.clientId, command.operationKey, signal);
    }); } finally { entry.active = false; }
  } });
}
export type TicketsMcpClients = ReturnType<typeof createTicketsMcpClients>;
