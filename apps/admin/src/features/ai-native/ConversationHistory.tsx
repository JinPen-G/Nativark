/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationHistory";
import { ConversationHistory as OriginalConversationHistory } from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationHistory";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const ConversationHistory = bindLegacyRentalAssistant(OriginalConversationHistory);
