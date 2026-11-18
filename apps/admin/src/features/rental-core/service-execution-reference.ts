/** 原引用签名与失败语义保留，同源解析与摘要由 Rental Core 提供。 */
import { createRentalServiceExecutionReferences } from "@rental-os/rental-core/admin/orders/logic";
import { readSettingsReference, retainSettingsReference, clearSettingsReference } from "@/features/ai-native/settings-operation-reference";
export type { ServiceExecutionReference } from "@rental-os/rental-core/admin/orders/logic";
export { serviceExecutionStorageKey } from "@rental-os/rental-core/admin/orders/logic";

export const { readServiceExecutionReference, retainServiceExecutionReference, clearServiceExecutionReference } = createRentalServiceExecutionReferences({
  read: readSettingsReference, retain: retainSettingsReference, clear: clearSettingsReference
});
