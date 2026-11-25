/** 原委托面板绑定当前商户接点，复用同一原来源与执行实现。 */
import type { ComponentProps } from "react";
import { EnterpriseMerchantOrderDelegationPanel as CoreEnterpriseMerchantOrderDelegationPanel } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function EnterpriseMerchantOrderDelegationPanel(props: ComponentProps<typeof CoreEnterpriseMerchantOrderDelegationPanel>) {
  return <LegacyRentalOrderPageHost page="orderCreate"><CoreEnterpriseMerchantOrderDelegationPanel {...props} /></LegacyRentalOrderPageHost>;
}
