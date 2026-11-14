/** 工单自己的业务输入/输出；不复用Rental订单、经营空间、计价或状态机。 */
import { z } from "zod";

export const TICKETS_CORE_ID = "example-tickets";
export const TICKETS_CORE_VERSION = "0.1.0";
export const TICKETS_DATA_VERSION = "0.1.0";
export const TicketIdSchema = z.string().min(1).max(36).regex(/^[a-zA-Z0-9_-]+$(?![\s\S])/);
const id = TicketIdSchema;
const revision = z.number().int().safe().positive();
export const TicketStateSchema = z.enum(["open", "in_progress", "closed"]);
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
export type TicketPermission = "read" | "read.all" | "create" | "assign" | "start" | "close";
export interface TicketReceipt { operationId: string; ticket: Ticket }

export class TicketError extends Error {
  constructor(readonly code: "denied" | "not_found" | "revision_conflict" | "state_conflict" | "operation_conflict", message: string) {
    super(message); this.name = "TicketError";
  }
}
