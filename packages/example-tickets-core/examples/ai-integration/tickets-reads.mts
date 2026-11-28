/**
 * 工单 Core 的可选 MCP 读取装配；复用原详情、本人原收据和业务合同。
 * 宿主提供当前身份、发布、授权、持久计量与字段放行，不注册写操作或模型调用。
 */
import { coreOpenApiSchema, type CorePrincipal } from "@rental-os/core-contracts";
import { TICKETS_HTTP, type TicketsService } from "@rental-os/example-tickets-core";
import type { McpReadTools } from "@rental-os/mcp-server";
import { fromJsonSchema, snapshotJson, type JsonSchemaType } from "@rental-os/mcp-server/original-read-tool";

export const TICKETS_MCP_READ_NAMES = Object.freeze({
  get: "example_tickets_get",
  receipt: "example_tickets_receipt",
});

export interface TicketsMcpReadDependencies {
  /** 原生产宿主已装配的服务；保留当前 Core/成员/对象与原收据授权。 */
  service?: Pick<TicketsService, "get" | "receipt">;
  /** 只在原 authority.withRead 的请求上下文中读取，不能从工具输入构造。 */
  currentPrincipal?: () => CorePrincipal | undefined;
  providers?: Omit<McpReadTools, "tools">;
  /** 已审查的外发字段合同；内部完整工单不默认成为外发结果。 */
  outputSchemas?: Readonly<{ get: JsonSchemaType; receipt: JsonSchemaType }>;
}

export type TicketsMcpReadIntegration =
  | { status: "unavailable"; reasons: readonly string[] }
  | { status: "configured"; readTools: McpReadTools };

/** 只检查装配缺件。configured 不证明当前身份、发布、额度或 Core 可用。 */
export function createTicketsMcpReadTools(dependencies: TicketsMcpReadDependencies = {}): TicketsMcpReadIntegration {
  const { service, currentPrincipal, providers, outputSchemas } = dependencies;
  const reasons: string[] = [];
  if (typeof service?.get !== "function" || typeof service?.receipt !== "function") reasons.push("tickets_service_missing");
  if (typeof currentPrincipal !== "function") reasons.push("current_principal_missing");
  if (typeof providers?.publication?.allows !== "function") reasons.push("publication_missing");
  if (typeof providers?.authority?.withRead !== "function") reasons.push("authority_missing");
  if (typeof providers?.accounting?.withCall !== "function"
    || typeof providers?.accounting?.withInvocation !== "function") reasons.push("persistent_accounting_missing");
  if (typeof providers?.release?.project !== "function") reasons.push("field_release_missing");
  if (providers?.usage !== undefined && typeof providers.usage?.completed !== "function") reasons.push("usage_invalid");

  const outputs = new Map<"get" | "receipt", JsonSchemaType>();
  for (const kind of ["get", "receipt"] as const) {
    try {
      const schema = structuredClone(outputSchemas?.[kind]);
      if (!schema || schema.type !== "object" || schema.additionalProperties !== false) throw new Error();
      fromJsonSchema(schema);
      outputs.set(kind, schema);
    } catch {
      reasons.push(`${kind}_output_schema_unavailable`);
    }
  }
  if (reasons.length) return { status: "unavailable", reasons: Object.freeze(reasons) };

  // 捕获方法，不缓存当前身份、角色、Core 准入或发布结果。
  const get = service!.get.bind(service), receipt = service!.receipt.bind(service);
  const principal = currentPrincipal!;
  const unavailable = () => new Error("Tickets read unavailable");
  const current = (signal: AbortSignal): CorePrincipal => {
    if (signal.aborted) throw unavailable();
    const value = principal();
    if (!value || value.audience !== "operator" || !value.tenantId || !value.subjectId) throw unavailable();
    return Object.freeze({ tenantId: value.tenantId, subjectId: value.subjectId, audience: value.audience });
  };

  return {
    status: "configured",
    readTools: {
      ...providers!,
      tools: [
        {
          name: TICKETS_MCP_READ_NAMES.get,
          description: "读取当前获权成员可见的工单详情；不修改工单，也不授予后续动作权限。",
          inputSchema: coreOpenApiSchema(TICKETS_HTTP.get.params) as JsonSchemaType,
          outputSchema: outputs.get("get")!,
          async read(input, signal) {
            if (signal.aborted) throw unavailable();
            const command = TICKETS_HTTP.get.params.parse(snapshotJson(input, { stringCharacters: 36, arrayItems: 0 }));
            const actor = current(signal);
            const value = await get(actor, command.ticketId);
            if (signal.aborted) throw unavailable();
            // 直接复用原 Zod 合同；OpenAPI 3.0 的完整响应不是另一份 JSON Schema。
            const original = TICKETS_HTTP.get.response.parse(snapshotJson(value, { stringCharacters: 4000, arrayItems: 50 }));
            if (original.id !== command.ticketId || original.tenantId !== actor.tenantId) throw unavailable();
            return original;
          },
        },
        {
          name: TICKETS_MCP_READ_NAMES.receipt,
          description: "按本人原 operationId 读取原工单收据；unavailable 不表示未执行，禁止据此重发。",
          inputSchema: coreOpenApiSchema(TICKETS_HTTP.receipt.params) as JsonSchemaType,
          outputSchema: outputs.get("receipt")!,
          async read(input, signal) {
            if (signal.aborted) throw unavailable();
            const command = TICKETS_HTTP.receipt.params.parse(snapshotJson(input, { stringCharacters: 36, arrayItems: 0 }));
            const actor = current(signal);
            const value = await receipt(actor, command.operationId);
            if (signal.aborted) throw unavailable();
            const original = TICKETS_HTTP.receipt.response.parse(snapshotJson(value, { stringCharacters: 4000, arrayItems: 50 }));
            if (original.status === "recorded" && (original.receipt.operationId !== command.operationId
              || original.receipt.ticket.tenantId !== actor.tenantId)) throw unavailable();
            return original;
          },
        },
      ],
    },
  };
}
