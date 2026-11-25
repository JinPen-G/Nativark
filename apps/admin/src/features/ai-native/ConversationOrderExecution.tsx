/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationOrderExecution";
import { ConversationOrderExecution as OriginalConversationOrderExecution } from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationOrderExecution";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const ConversationOrderExecution = bindLegacyRentalAssistant(OriginalConversationOrderExecution);
