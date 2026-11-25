/** 原 Rental 页头图标按登记页面映射，详情页沿原路由符号。
 * 只提供呈现，页面登记、Core 授权和导航仍由宿主核验。
 */
import type { ReactNode } from "react";
import { AnimatedIcon, type AnimatedIconName } from "@rental-os/platform-admin/ui";
import { RENTAL_CORE_ID } from "@rental-os/rental-core";

// 与原 APP_ROUTES 路径经 routeIconName 后的页头图标保持一致。
const pageIcons: ReadonlyMap<string, AnimatedIconName> = new Map([
  ["workbench", "dashboard"],
  ["operation-report", "report"],
  ["notifications", "messages"],
  ["ai-operator", "ai"],
  ["ai-settings", "rules"],
  ["ai-tasks", "rules"],
  ["orders", "orders"],
  ["order-create", "orders"],
  ["order-detail", "orders"],
  ["item-groups", "inventory"],
  ["assets", "inventory"],
  ["work-orders", "orders"],
  ["work-order-detail", "orders"],
  ["locations", "inventory"],
  ["pricing-groups", "pricing"],
  ["pricing", "pricing"],
  ["pricing-versions", "pricing"],
  ["pricing-version-detail", "pricing"],
  ["discounts", "pricing"],
  ["coupons", "pricing"],
  ["services", "pricing"],
  ["governance", "rules"],
  ["capabilities", "rules"],
  ["qualification-types", "access"],
  ["membership-reviews", "customers"],
  ["personal-members", "customers"],
  ["personal-member-detail", "customers"],
  ["corporate-members", "customers"],
  ["corporate-member-detail", "customers"],
  ["membership-plans", "pricing"],
  ["membership-rewards", "customers"],
  ["tenant-readiness", "rules"],
  ["client-channel", "plugins"],
  ["payment-reconciliation", "finance"],
  ["payment-reconciliation-detail", "finance"],
]);

export function rentalCorePageIcon(coreId: string, pageId: string): ReactNode {
  if (coreId !== RENTAL_CORE_ID) return undefined;
  const name = pageIcons.get(pageId);
  return name ? <AnimatedIcon name={name} /> : undefined;
}
