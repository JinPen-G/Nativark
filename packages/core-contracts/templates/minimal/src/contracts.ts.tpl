/** 本 Core 的身份和最小对象合同；租户/主体来自宿主，不接受客户端自报权限。 */
import { z } from "zod";

export const CORE_ID = "{{CORE_ID}}";
export const CORE_VERSION = "0.1.0";
export const DATA_VERSION = "0.1.0";
export const DATA_READABLE = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
export const ItemSchema = z.object({
  id: z.string().min(1).max(80), tenantId: z.string().min(1).max(80), title: z.string().min(1).max(160)
}).strict();
export const ItemViewSchema = ItemSchema.omit({ tenantId: true });
export const ListQuerySchema = z.object({}).strict();
export const ListResponseSchema = z.array(ItemViewSchema).max(50);
export type Item = z.infer<typeof ItemSchema>;
