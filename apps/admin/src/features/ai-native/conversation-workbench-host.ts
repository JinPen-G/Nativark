/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/conversation-workbench-host";
import { createConversationWorkbenchHost as createOriginal } from "@rental-os/rental-core/admin/assistant/source/ai-native/conversation-workbench-host";
import { legacyRentalAssistant } from "../ai-operator/legacy-host";
export function createConversationWorkbenchHost(input: Omit<Parameters<typeof createOriginal>[0], "createAiWorkbenchDisplayPort">) {
  return createOriginal({ ...input, createAiWorkbenchDisplayPort: legacyRentalAssistant.createAiWorkbenchDisplayPort });
}
