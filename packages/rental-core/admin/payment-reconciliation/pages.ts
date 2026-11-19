/** 对账列表与批次详情共用标题、父级和原财务准入声明。 */
import type { CorePageDescriptor, CorePageLocation } from "@rental-os/core-contracts";
import type { RentalOrderSession } from "../orders/page-context";

export const RENTAL_PAYMENT_RECONCILIATION_CORE_ID = "rental";
export const RENTAL_PAYMENT_RECONCILIATION_LEGACY_PERMISSION = "rental-os:finance:reconcile";

export const RENTAL_PAYMENT_RECONCILIATION_PAGES = {
  batches: {
    id: "payment-reconciliation",
    path: "/payment-reconciliation",
    title: { default: "支付对账", translations: { "en-US": "Reconciliation" } },
    permissions: [{ resource: "finance", action: "reconcile" }],
    menu: {
      group: { default: "财务与对账", translations: { "en-US": "Finance & reconciliation" } },
      order: 10,
    },
  },
  detail: {
    id: "payment-reconciliation-detail",
    path: "/payment-reconciliation/:batchId",
    title: { default: "对账批次详情", translations: { "en-US": "Batch details" } },
    parent: "payment-reconciliation",
    permissions: [{ resource: "finance", action: "reconcile" }],
  },
} satisfies Record<string, CorePageDescriptor>;

export function rentalPaymentReconciliationLegacyPageAllowed(session: RentalOrderSession): boolean {
  return Boolean(session.sessionVerified && session.authenticated && session.currentWorkspaceId
    && !session.user?.isSaasAdmin
    && session.hasPermission(RENTAL_PAYMENT_RECONCILIATION_LEGACY_PERMISSION));
}

export function rentalPaymentReconciliationLocation(batchId?: string): CorePageLocation {
  return batchId
    ? {
        coreId: RENTAL_PAYMENT_RECONCILIATION_CORE_ID,
        pageId: RENTAL_PAYMENT_RECONCILIATION_PAGES.detail.id,
        params: { batchId },
      }
    : {
        coreId: RENTAL_PAYMENT_RECONCILIATION_CORE_ID,
        pageId: RENTAL_PAYMENT_RECONCILIATION_PAGES.batches.id,
      };
}
