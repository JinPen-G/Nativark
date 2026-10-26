import type { AnimatedIconName } from "@/components/ui/AnimatedIcon";

/** Display aliases only: full route titles, category terms and permissions stay authoritative. */
const routeLabels: Record<string, string> = {
  "/rental/pricing-groups": "定价分组", "/rental/pricing": "价格调价",
  "/rental/settings": "业务规则", "/rental/capabilities": "经营能力",
  "/rental/qualification-types": "证件类型", "/settings/subscription": "版本订阅",
  "/settings/appearance": "外观音效", "/tenant/client-channel": "客户渠道",
  "/platform/rental-category-capabilities": "能力目录", "/platform/tools": "平台治理",
  "/platform/official-calendars": "公共日历", "/platform/subscription-catalog": "功能定价",
};
export function menuRouteLabel(path: string, label: string) {
  if (path === "/rental/assets") return label === "资产与库存" ? "资产库存" : label.replace("资产与", "");
  // Shorten only a redundant conjunction; never truncate a category noun.
  return routeLabels[path] ?? label;
}
export const MENU_GROUP_LABELS: Record<string, string> = {
  commercial: "定价营销", customers: "会员客户", "account-access": "账号权限",
  "service-channels": "服务渠道", "finance-reconciliation": "财务对账",
};
export const MENU_GROUP_COMPACT_EN: Record<string, string> = {
  overview: "Overview", transactions: "Rentals", inventory: "Inventory", "operations-foundation": "Setup",
  "platform-rental-core": "Core", "platform-management": "Platform",
};
export const MENU_GROUP_ICONS: Record<string, AnimatedIconName> = {
  "platform-rental-core": "layers", overview: "chart", transactions: "file", inventory: "blocks",
  commercial: "tag", customers: "users", "operations-foundation": "settings",
  "account-access": "shield", "service-channels": "blocks", "finance-reconciliation": "wallet",
  "platform-management": "settings",
};
export const MENU_ROUTE_ICONS: Record<string, AnimatedIconName> = {
  "/workbench": "chart", "/reports/operations": "chart", "/rental/orders": "file",
  "/rental/item-groups": "blocks", "/rental/assets": "layers", "/rental/work-orders": "settings",
  "/rental/locations": "house", "/rental/pricing-groups": "tag", "/rental/pricing": "chart",
  "/rental/discounts": "tag", "/rental/coupons": "tag", "/rental/services": "shield",
  "/membership/personal": "users", "/membership/corporate": "users", "/membership/reviews": "shield",
  "/membership/plans": "tag", "/membership/rewards": "wallet", "/tenant/readiness": "chart",
  "/rental/settings": "settings", "/rental/qualification-types": "shield", "/rental/capabilities": "layers",
  "/settings/subscription": "layers", "/tenant/accounts": "users", "/tenant/roles": "shield",
  "/tenant/integrations": "blocks", "/tenant/client-channel": "blocks", "/settings/appearance": "settings",
  "/rental/payment-reconciliation": "wallet",
};
