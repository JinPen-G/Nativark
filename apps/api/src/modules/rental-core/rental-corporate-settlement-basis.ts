import { ConflictException } from "@nestjs/common";
import type { RentalMembershipSnapshot } from "@rental-os/shared";

type CorporateOrderBasis = {
  membershipSnapshot?: unknown;
  payerSubjectCustomerId?: string | null;
  contractSubjectCustomerId?: string | null;
  currency?: string;
};

/** Original confirmed settlement only; never fills historical gaps from the current credit configuration. */
export function confirmedCorporateSettlement(order: CorporateOrderBasis): RentalMembershipSnapshot["settlement"] {
  const membership = order.membershipSnapshot as Record<string, unknown> | null | undefined;
  const value = membership?.settlement;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("订单结算依据无效，须核对原确认记录");
  const settlement = value as NonNullable<RentalMembershipSnapshot["settlement"]>;
  const customerId = membership?.enterpriseContractAndPayer === true && typeof membership.corporateCustomerId === "string"
    && membership.corporateCustomerId.trim() ? membership.corporateCustomerId : undefined;
  if (!customerId || settlement.payerCustomerId !== customerId || settlement.currency !== order.currency
    || (order.payerSubjectCustomerId && order.payerSubjectCustomerId !== customerId)
    || (order.contractSubjectCustomerId && order.contractSubjectCustomerId !== customerId)
    || !["per_order", "credit"].includes(settlement.mode)
    || !["per_order", "monthly", "semi_monthly"].includes(settlement.billingCycle)
    || (settlement.mode === "per_order") !== (settlement.billingCycle === "per_order")
    || !Number.isFinite(Date.parse(settlement.confirmedAt))
    || (settlement.mode === "credit" && (!settlement.creditId || !Number.isInteger(settlement.creditRevision) || settlement.creditRevision! < 1))) {
    throw new ConflictException("订单结算方式、付款主体或币种与原确认依据不匹配");
  }
  return settlement;
}
