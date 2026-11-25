/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-operator/NativeOperatorWorkspace";
import { NativeOperatorWorkspace as OriginalNativeOperatorWorkspace } from "@rental-os/rental-core/admin/assistant/source/ai-operator/NativeOperatorWorkspace";
import { bindLegacyRentalAssistant } from "./legacy-host";
export const NativeOperatorWorkspace = bindLegacyRentalAssistant(OriginalNativeOperatorWorkspace);
