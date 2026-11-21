/** Rental 原工具边界，通用材料与摘要复用公共单源，原工具名继续严格核验。 */
import { z } from 'zod';
import { nativeToolCallSchema, resolvedNativeToolResultSchema as publicResolvedNativeToolResultSchema } from '@rental-os/platform-server/ai-gateway';
export { nativeToolResultReferenceSchema, nativeToolResultIntentFingerprint } from '@rental-os/platform-server/ai-gateway';
export type { NativeToolTaskScene, NativeToolCallBinding, NativeToolCallBindingReader, ResolvedNativeToolResult, NativeToolResultResolver } from '@rental-os/platform-server/ai-gateway';
export const nativeOrderToolCallSchema = nativeToolCallSchema.extend({
  function: nativeToolCallSchema.shape.function.extend({ name: z.literal('rental_order_explain') }).strict()
}).strict();
export const resolvedNativeToolResultSchema = publicResolvedNativeToolResultSchema.extend({ call: nativeOrderToolCallSchema }).strict();
