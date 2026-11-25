/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/category-assist-session";
import { createCategoryAssistSession as createSession } from "@rental-os/rental-core/admin/assistant/source/ai-native/category-assist-session";
import { aiCategoryDraftApi } from "@/api/aiCategoryDraft";
type OriginalInput = Parameters<typeof createSession>[0];
export function createCategoryAssistSession(input: Omit<OriginalInput, "api"> & { api?: OriginalInput["api"] }) {
  return createSession({ ...input, api: input.api ?? aiCategoryDraftApi });
}
