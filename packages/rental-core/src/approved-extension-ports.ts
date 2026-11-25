/** Internal approval binding. HTTP inputs cannot grant this port; the enterprise
 * service supplies persisted request/preview fingerprints inside the original transaction. */
import type { RentalOrderExtensionPreview, RentalPricingRate, RentalRuleConfig } from "./contracts";

export type EnterpriseExtensionPrice = RentalOrderExtensionPreview & { rateSnapshot: RentalPricingRate[]; ruleSnapshot: RentalRuleConfig };
export interface ApprovedExtensionBinding {
  approvalId: string;
  requestFingerprint: string;
  previewFingerprint: string;
  expectedOrderUpdatedAt: string;
  idempotencyKey: string;
}
