/** 工单自己的业务输入/输出；不复用Rental订单、经营空间、计价或状态机。 */
import { z } from "zod";

export const TICKETS_CORE_ID = "example-tickets";
export const TICKETS_CORE_VERSION = "0.1.5";
export const TICKETS_DATA_VERSION = "0.1.0";
/** 当前工单实现可读取的原绑定版本范围；物理数据版本和迁移账由宿主另行核验。 */
export const TICKETS_DATA_READABLE = Object.freeze({ minInclusive: "0.1.0", maxExclusive: "0.2.0" });
export const TicketIdSchema = z.string().min(1).max(36).regex(/^[a-zA-Z0-9_-]+$(?![\s\S])/);
const id = TicketIdSchema;
const revision = z.number().int().safe().positive();
export const TicketStateSchema = z.enum(["open", "in_progress", "closed"]);
export const TicketAssignmentFilterSchema = z.enum(["assigned", "unassigned"]);
export type TicketAssignmentFilter = z.infer<typeof TicketAssignmentFilterSchema>;
export const TicketSchema = z.object({
  id, tenantId: id, subject: z.string().trim().min(1).max(160), description: z.string().max(4000),
  createdBy: id, assigneeId: id.nullable(), state: TicketStateSchema, revision,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict();
export type Ticket = z.infer<typeof TicketSchema>;
const operation = { operationId: id };
const update = { ...operation, ticketId: id, expectedRevision: revision };
export const CreateTicketSchema = z.object({ ...operation, subject: TicketSchema.shape.subject, description: TicketSchema.shape.description.default("") }).strict();
export const AssignTicketSchema = z.object({ ...update, assigneeId: id }).strict();
export const ChangeTicketStateSchema = z.object(update).strict();
export const ListTicketsSchema = z.object({
  state: TicketStateSchema.optional(), offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(20)
}).strict();
export type ListTickets = z.infer<typeof ListTicketsSchema>;
/** 分页按标题、状态和原受派成员是否为空筛选，正文与总数共用当前可读范围。 */
export const TicketPageQuerySchema = ListTicketsSchema.extend({
  subject: z.string().trim().max(160).optional().describe("按标题字面包含搜索，区分大小写；首尾空白去除，空值不筛选"),
  assignment: TicketAssignmentFilterSchema.optional().describe("assigned为已有受派成员，unassigned为尚未分派；不改变当前成员可读范围"),
  offset: z.number().int().safe().nonnegative().default(0)
});
export type TicketPageQuery = z.infer<typeof TicketPageQuerySchema>;
/** 当前页和总数使用同一可读范围；旧数组列表合同保持。 */
export const TicketPageSchema = z.object({ rows: z.array(TicketSchema).max(100), total: z.number().int().safe().nonnegative() }).strict();
export type TicketPage = z.infer<typeof TicketPageSchema>;
/** 汇总读取当前可见的全部工单，不接受分页、筛选或客户端范围。 */
export const TicketStatusCountsQuerySchema = z.object({}).strict();
export const TicketStatusCountsSchema = z.object({
  total: z.number().int().safe().nonnegative(),
  open: z.number().int().safe().nonnegative(),
  in_progress: z.number().int().safe().nonnegative(),
  closed: z.number().int().safe().nonnegative()
}).strict();
export type TicketStatusCounts = z.infer<typeof TicketStatusCountsSchema>;
export type TicketPermission = "read" | "read.all" | "create" | "assign" | "start" | "close";
export interface TicketReceipt { operationId: string; ticket: Ticket }

export class TicketError extends Error {
  constructor(readonly code: "denied" | "not_found" | "revision_conflict" | "state_conflict" | "operation_conflict", message: string) {
    super(message); this.name = "TicketError";
  }
}
