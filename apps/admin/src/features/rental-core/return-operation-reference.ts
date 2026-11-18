/** 原引用签名与失败语义保留，同源解析与摘要由 Rental Core 提供。 */
import { createRentalReturnReferences } from "@rental-os/rental-core/admin/orders/logic";
import { readSettingsReference, retainSettingsReference, clearSettingsReference } from "@/features/ai-native/settings-operation-reference";
export type { ReturnOperationReference } from "@rental-os/rental-core/admin/orders/logic";

export const { readReturnOperation, retainReturnOperation, clearReturnOperation } = createRentalReturnReferences({
  read: readSettingsReference, retain: retainSettingsReference, clear: clearSettingsReference
});
