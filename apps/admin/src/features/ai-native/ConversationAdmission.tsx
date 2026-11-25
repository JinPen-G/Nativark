/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationAdmission";
import { ConversationAdmission as OriginalConversationAdmission } from "@rental-os/rental-core/admin/assistant/source/ai-native/ConversationAdmission";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const ConversationAdmission = bindLegacyRentalAssistant(OriginalConversationAdmission);
