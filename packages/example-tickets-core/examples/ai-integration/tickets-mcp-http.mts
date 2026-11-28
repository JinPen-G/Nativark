/** 工单MCP人工控制面的同源输入、响应、OpenAPI与原Guard路由贡献。
 * 不挂匿名管理路由，不把OAuth授权当业务执行许可；写结果不明只能回读原键。
 */
import { createRequire } from "node:module";
import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Param, Post, Req,
  type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { TicketError } from "@rental-os/example-tickets-core";
import { type TicketsMcpAction, type TicketsMcpApplication, type TicketsMcpRequest } from "./tickets-mcp-application.mjs";
import { TicketsMcpError } from "./tickets-mcp-tenant.mjs";
import type { TicketsMcpClients } from "./tickets-mcp-clients.mjs";
import { TICKETS_MCP_HTTP, TICKETS_MCP_CLIENT_INPUTS, TICKETS_MCP_CLIENT_RESPONSES, type TicketsMcpClientAction } from "@rental-os/example-tickets-core/mcp-http";
export { TICKETS_MCP_HTTP, TICKETS_MCP_RESPONSES, createTicketsMcpHttpContribution, createTicketsMcpOpenApi } from "@rental-os/example-tickets-core/mcp-http";
const { z } = createRequire(import.meta.url)("zod") as typeof import("zod");
const token = Symbol("example-tickets.mcp.application");
const clientsToken = Symbol("example-tickets.mcp.clients");
type Request = TicketsMcpRequest & { aborted?: boolean; once(event: "aborted", callback: () => void): unknown;
  removeListener(event: "aborted", callback: () => void): unknown; res?: { once(event: "close", callback: () => void): unknown; removeListener(event: "close", callback: () => void): unknown } };
@Controller("cores/example-tickets/mcp")
class TicketsMcpController {
  constructor(@Inject(token) private readonly application: TicketsMcpApplication) {}
  @Post(":action") @HttpCode(200) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  async consume(@Param("action") name: string, @Body() body: unknown, @Req() request: Request) {
    const selected = Object.entries(TICKETS_MCP_HTTP).find(([, route]) => route.path === `mcp/${name}`);
    if (!selected) throw new HttpException({ code: "MCP_INVALID_INPUT", retryable: false }, 400);
    const action = selected[0] as TicketsMcpAction, route = selected[1], abort = new AbortController(), cancel = () => abort.abort();
    if (request.aborted) cancel(); request.once("aborted", cancel); request.res?.once("close", cancel);
    let invoked = false;
    try {
      const command = route.body.parse(body); invoked = true;
      return route.response.parse(await this.application.consume(action, request, command, AbortSignal.any([abort.signal, AbortSignal.timeout(30000)])));
    } catch (error) {
      const denied = error instanceof TicketsMcpError && error.kind === "denied" || error instanceof TicketError && ["denied", "not_found"].includes(error.code);
      const invalid = !invoked && error instanceof z.ZodError, changed = error instanceof TicketsMcpError && error.kind === "changed";
      const code = invalid ? "MCP_INVALID_INPUT" : denied ? "MCP_ACCESS_DENIED" : changed ? "MCP_BASIS_CHANGED" : route.write ? "MCP_RESULT_UNKNOWN" : "MCP_UNAVAILABLE";
      throw new HttpException({ code, retryable: false, ...(code === "MCP_RESULT_UNKNOWN" ? { nextAction: "read_original_result" } : {}) },
        invalid ? 400 : denied ? 403 : changed || route.write ? 409 : 503);
    } finally { request.removeListener("aborted", cancel); request.res?.removeListener("close", cancel); }
  }
}
@Controller("cores/example-tickets/mcp-clients")
class TicketsMcpClientsController {
  constructor(@Inject(clientsToken) private readonly clients: TicketsMcpClients) {}
  @Post(":action") @HttpCode(200) @Header("Cache-Control", "no-store")
  async consume(@Param("action") name: string, @Body() body: unknown, @Req() request: Request) {
    if (!Object.hasOwn(TICKETS_MCP_CLIENT_INPUTS, name)) throw new HttpException({ code: "MCP_INVALID_INPUT", retryable: false }, 400);
    const action = name as TicketsMcpClientAction;
    let called = false;
    try {
      const command = TICKETS_MCP_CLIENT_INPUTS[action].parse(body); called = true;
      return TICKETS_MCP_CLIENT_RESPONSES[action].parse(await this.clients.consume(action, request, command, AbortSignal.timeout(15000)));
    } catch (error) {
      const invalid = !called && error instanceof z.ZodError;
      const denied = error instanceof TicketsMcpError && error.kind === "denied";
      throw new HttpException({ code: invalid ? "MCP_INVALID_INPUT" : denied ? "MCP_ACCESS_DENIED" : action === "save" ? "MCP_RESULT_UNKNOWN" : "MCP_UNAVAILABLE", retryable: false },
        invalid ? 400 : denied ? 403 : action === "save" ? 409 : 503);
    }
  }
}
@Module({})
export class TicketsMcpHttpModule {
  static register(options: { imports?: ModuleMetadata["imports"]; clients: Pick<FactoryProvider<TicketsMcpClients>, "inject" | "useFactory"> }
    & Pick<FactoryProvider<TicketsMcpApplication>, "inject" | "useFactory">): DynamicModule {
    return { module: TicketsMcpHttpModule, imports: options.imports ?? [], controllers: [TicketsMcpController, TicketsMcpClientsController],
      providers: [{ provide: token, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: clientsToken, inject: options.clients.inject ?? [], useFactory: options.clients.useFactory }] };
  }
}
