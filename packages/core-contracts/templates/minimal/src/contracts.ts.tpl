/** 本 Core 的条目合同；租户与所有者来自原身份，客户端只提供业务输入和原操作键。 */
import { z } from "zod";

export const CORE_ID = "{{CORE_ID}}";
export const CORE_VERSION = "0.1.0";
export const DATA_VERSION = "0.1.0";
export const DATA_READABLE = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
export const IdSchema = z.string().min(1).max(36).regex(/^[a-zA-Z0-9_-]+$(?![\s\S])/);
export const StateSchema = z.enum(["active", "archived"]);
const revision = z.number().int().safe().positive();
export const ItemSchema = z.object({ id: IdSchema, tenantId: IdSchema, createdBy: IdSchema,
  title: z.string().trim().min(1).max(160), description: z.string().max(4000), state: StateSchema, revision,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export const ItemViewSchema = ItemSchema.omit({ tenantId: true });
export const ListQuerySchema = z.object({ title: z.string().trim().max(160).optional(), state: StateSchema.optional(),
  offset: z.number().int().safe().nonnegative().max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(20) }).strict();
export const ListResponseSchema = z.object({ rows: z.array(ItemViewSchema).max(100), total: z.number().int().safe().nonnegative() }).strict();
export const CreateItemSchema = z.object({ operationId: IdSchema, title: ItemSchema.shape.title,
  description: ItemSchema.shape.description.default("") }).strict();
export const ArchiveItemSchema = z.object({ operationId: IdSchema, itemId: IdSchema, expectedRevision: revision }).strict();
export const UpdateItemSchema = ArchiveItemSchema.extend({ title: ItemSchema.shape.title, description: ItemSchema.shape.description });
export const ReceiptSchema = z.object({ operationId: IdSchema, item: ItemViewSchema }).strict();
export const ReceiptLookupSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), receipt: ReceiptSchema }).strict(), z.object({ status: z.literal("unavailable") }).strict()
]);
export type Item = z.infer<typeof ItemSchema>;
export type ItemView = z.infer<typeof ItemViewSchema>;
export type ListQuery = z.infer<typeof ListQuerySchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Permission = "read" | "create" | "update" | "archive";
export class ItemError extends Error {
  constructor(readonly code: "denied" | "not_found" | "revision_conflict" | "state_conflict" | "operation_conflict", message: string) {
    super(message); this.name = "ItemError";
  }
}
