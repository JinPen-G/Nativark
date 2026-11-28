/** 可选AI的只读展示合同；不装配Runtime、不授予执行权、不推测最后一次任务。
 * 宿主的每条路线须读取其当前原权威。普通工单访问与返回前复权始终保留。
 */
import { z } from "zod";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { TicketError, TicketIdSchema } from "./contracts";
import type { TicketsService } from "./service";

const TaskIdSchema = z.string().uuid();
export const TicketAiStatusQuerySchema = z.object({ taskId: TaskIdSchema.optional() }).strict();
export const TicketAiRouteStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unconfigured"), reason: z.enum(["host_not_selected", "identity_adapter_missing", "task_adapter_missing"]) }).strict(),
  z.object({ state: z.literal("denied"), reason: z.enum(["permission_denied", "entitlement_denied", "policy_denied", "core_unavailable", "limit_reached"]) }).strict(),
  z.object({ state: z.literal("unpublished"), reason: z.enum(["tool_not_published", "publication_expired"]) }).strict(),
  z.object({ state: z.literal("available"), reason: z.literal("current_authorities_verified") }).strict(),
  z.object({ state: z.literal("pending_approval"), reason: z.literal("original_proposal_pending"), taskId: TaskIdSchema,
    proposalId: TaskIdSchema, proposalRevision: z.number().int().positive() }).strict(),
  z.object({ state: z.literal("reconciliation_required"), reason: z.literal("original_result_unknown"), taskId: TaskIdSchema,
    operationId: TicketIdSchema, retryable: z.literal(false) }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["authority_unavailable", "basis_changed", "original_evidence_unavailable"]) }).strict()
]);
export type TicketAiRouteState = z.infer<typeof TicketAiRouteStateSchema>;
// 这两条已登记路线均不委托服务端模型；未来Gateway路线须独立登记适用前置，不能冒用本状态。
export const TicketAiStatusSchema = z.object({ ticketId: TicketIdSchema, ticketRevision: z.number().int().positive(),
  observedAt: z.string().datetime({ offset: true }), executionGranted: z.literal(false),
  builtin: z.object({ route: z.literal("builtin_task"), model: z.literal("not_used"), status: TicketAiRouteStateSchema }).strict(),
  mcp: z.object({ route: z.literal("mcp_read"), model: z.literal("client_paid"), status: TicketAiRouteStateSchema }).strict()
}).strict();
export type TicketAiStatus = z.infer<typeof TicketAiStatusSchema>;
export interface TicketsAiStatusReader {
  /** 当前请求内的真实读取；不得复用页面缓存、假身份或恒真adapter。外发只有闭合状态码。 */
  read(input: Readonly<{ principal: CorePrincipal; ticketId: string; taskId?: string }>): Promise<TicketAiRouteState>;
}

export function createTicketsAiStatus(input: { service: Pick<TicketsService, "get">;
  builtin?: TicketsAiStatusReader; mcp?: TicketsAiStatusReader; clock?: () => Date }) {
  const clock = input.clock ?? (() => new Date());
  return Object.freeze({ async read(principal: CorePrincipal, ticketId: string, value: unknown = {}): Promise<TicketAiStatus> {
    const query = TicketAiStatusQuerySchema.parse(value), original = await input.service.get(principal, ticketId);
    const observe = async (reader?: TicketsAiStatusReader, taskId?: string): Promise<TicketAiRouteState> => {
      if (!reader) return { state: "unconfigured", reason: "host_not_selected" };
      try {
        const status = TicketAiRouteStateSchema.parse(await reader.read({ principal: { ...principal }, ticketId, ...(taskId ? { taskId } : {}) }));
        if ("taskId" in status && status.taskId !== taskId) throw new Error("AI状态不属于选定的原任务");
        return status;
      } catch { return { state: "unavailable", reason: "authority_unavailable" }; }
    };
    // 顺序读取避免共享ALS/Native参加者并发使用；失败不会回传驱动错误或连接材料。
    const builtin = await observe(input.builtin, query.taskId), mcp = await observe(input.mcp);
    if (mcp.state === "pending_approval" || mcp.state === "reconciliation_required")
      throw new TicketError("state_conflict", "MCP只读目录不能声明业务批准或执行状态");
    const current = await input.service.get(principal, ticketId);
    if (current.revision !== original.revision) throw new TicketError("revision_conflict", "工单已变化，请重新读取AI状态");
    return TicketAiStatusSchema.parse({ ticketId, ticketRevision: current.revision, observedAt: clock().toISOString(), executionGranted: false,
      builtin: { route: "builtin_task", model: "not_used", status: builtin }, mcp: { route: "mcp_read", model: "client_paid", status: mcp } });
  } });
}
export type TicketsAiStatusService = ReturnType<typeof createTicketsAiStatus>;
