/** 工单HTTP方法/路径与schema的单源映射，Nest入口和OpenAPI都从这里取合同。 */
import { z } from "zod";
import { CoreHttpContributionSchema, type CoreHttpContribution } from "@rental-os/core-contracts";
import { AssignTicketSchema, ChangeTicketStateSchema, CreateTicketSchema, ListTicketsSchema, TicketIdSchema, TicketSchema,
  TICKETS_CORE_ID, TICKETS_CORE_VERSION } from "./contracts";

export const TICKETS_HTTP_BASE = "cores/example-tickets";
export const TicketParamsSchema = z.object({ ticketId: TicketIdSchema }).strict();
export const TicketReceiptSchema = z.object({ operationId: TicketIdSchema, ticket: TicketSchema }).strict();
export const TicketErrorBodySchema = z.object({ code: z.string(), message: z.string() }).strict();
export const TicketReceiptLookupSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), receipt: TicketReceiptSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);
export const TICKETS_HTTP = {
  list: { method: "GET", path: "tickets", permission: "read", purpose: "business", startsNewBusiness: false, summary: "读取当前成员可见工单", query: ListTicketsSchema, response: z.array(TicketSchema) },
  get: { method: "GET", path: "tickets/:ticketId", permission: "read", purpose: "business", startsNewBusiness: false, summary: "读取当前可见工单详情", params: TicketParamsSchema, response: TicketSchema },
  receipt: { method: "GET", path: "operations/:operationId", permission: "read", purpose: "original_receipt", startsNewBusiness: false, summary: "只读核对本人的原工单操作收据", params: z.object({ operationId: TicketIdSchema }).strict(), response: TicketReceiptLookupSchema },
  create: { method: "POST", path: "tickets", permission: "create", purpose: "business", startsNewBusiness: true, summary: "创建工单", body: CreateTicketSchema, response: TicketReceiptSchema },
  assign: { method: "POST", path: "tickets/:ticketId/assign", permission: "assign", purpose: "business", startsNewBusiness: false, summary: "分派待处理工单", params: TicketParamsSchema, body: AssignTicketSchema.omit({ ticketId: true }), response: TicketReceiptSchema },
  start: { method: "POST", path: "tickets/:ticketId/start", permission: "start", purpose: "business", startsNewBusiness: false, summary: "开始处理已分派工单", params: TicketParamsSchema, body: ChangeTicketStateSchema.omit({ ticketId: true }), response: TicketReceiptSchema },
  close: { method: "POST", path: "tickets/:ticketId/close", permission: "close", purpose: "business", startsNewBusiness: false, summary: "关闭处理中的工单", params: TicketParamsSchema, body: ChangeTicketStateSchema.omit({ ticketId: true }), response: TicketReceiptSchema }
} as const;

/** 宿主Guard政策与Nest/OpenAPI来自同一HTTP声明，Core业务服务继续核当前范围/原结果。 */
export function createTicketsHttpContribution(): CoreHttpContribution {
  return CoreHttpContributionSchema.parse({ coreId: TICKETS_CORE_ID, implementationVersion: TICKETS_CORE_VERSION,
    routes: Object.entries(TICKETS_HTTP).map(([id, route]) => ({ id, method: route.method, path: `/${route.path}`,
      audiences: ["operator"], permissions: [{ resource: "ticket", action: route.permission }],
      purpose: route.purpose, startsNewBusiness: route.startsNewBusiness })) });
}
