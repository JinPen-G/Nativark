/** 原客户本人订单谓词。企业付款、签约或当前同事关系均不扩大本人访问范围。 */
import type { ClientRequestContext } from "./client-context";

export function clientOwnsRentalOrder(context: Pick<ClientRequestContext, "tenantId" | "customerId">,
  order: { tenantId: string; customerId?: string | null; membershipSnapshot?: unknown }): boolean {
  const snapshot = order.membershipSnapshot;
  const personalCustomerId = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "personalCustomerId" in snapshot
    ? snapshot.personalCustomerId : undefined;
  return order.tenantId === context.tenantId && (order.customerId === context.customerId || personalCustomerId === context.customerId);
}
