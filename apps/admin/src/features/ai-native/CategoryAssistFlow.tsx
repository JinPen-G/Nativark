/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/CategoryAssistFlow";
import { CategoryAssistFlow as OriginalCategoryAssistFlow } from "@rental-os/rental-core/admin/assistant/source/ai-native/CategoryAssistFlow";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const CategoryAssistFlow = bindLegacyRentalAssistant(OriginalCategoryAssistFlow);
