/** 跨模块对象定位；引用不是权限凭证，也不替换原业务的幂等键和历史指纹。 */
import { z } from "zod";
import { CoreIdSchema } from "./manifest";

const id = z.string().min(1).max(200);
export const CoreObjectReferenceSchema = z.object({
  coreId: CoreIdSchema,
  tenantId: id,
  container: z.object({ type: id, id }).strict().optional(),
  objectType: id,
  objectId: id,
  revision: id.optional()
}).strict();
export type CoreObjectReference = z.infer<typeof CoreObjectReferenceSchema>;

/** 元组编码保留字段边界，避免租户/Core/容器含分隔符时发生键碰撞。 */
export function coreObjectKey(input: CoreObjectReference): string {
  const ref = CoreObjectReferenceSchema.parse(input);
  return JSON.stringify([ref.coreId, ref.tenantId, ref.container?.type ?? null,
    ref.container?.id ?? null, ref.objectType, ref.objectId]);
}
