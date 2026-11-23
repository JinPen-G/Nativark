/** 原 Rental 菜单的分组、顺序和图标。只重排公共壳已过滤的登记项，
 * 不添加未获权路由；品类称呼继续来自原档案，不在导航里推断品类。
 */
import type { CoreRegisteredPage } from "@rental-os/core-contracts";
import type { PlatformShellProps } from "@rental-os/platform-admin";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { AnimatedIcon, type AnimatedIconName } from "@rental-os/platform-admin/ui";
import { ApartmentOutlined, ApiOutlined, AppstoreOutlined, BoxPlotOutlined, ControlOutlined,
  DashboardOutlined, FileSearchOutlined, FileTextOutlined, FundOutlined, GiftOutlined,
  IdcardOutlined, MobileOutlined, SafetyCertificateOutlined, SettingOutlined, ShopOutlined, TagsOutlined,
  TeamOutlined, ToolOutlined } from "@rental-os/platform-admin/ui";
import { RENTAL_CORE_ID, type RentalCategoryTerminology } from "@rental-os/rental-core";
import { applyTenantNavigationLabels } from "./catalog/navigation-terminology";

type Section = PlatformShellProps["publicSections"][number];
const layout = [
  { key: "platform-rental-core", label: "租赁内核", icon: <AppstoreOutlined />, items: ["/platform/rental-categories", "/platform/rental-category-capabilities"] },
  { key: "overview", label: "概览", icon: <DashboardOutlined />, items: ["workbench", "operation-report", "notifications"] },
  { key: "transactions", label: "租赁交易", icon: <ApartmentOutlined />, items: ["orders"] },
  { key: "inventory", label: "商品与资产", icon: <AppstoreOutlined />, items: ["item-groups", "assets", "work-orders", "locations"] },
  { key: "commercial", label: "定价与营销", icon: <FundOutlined />, items: ["pricing-groups", "pricing", "discounts", "coupons", "services"] },
  { key: "customers", label: "会员与客户", icon: <TeamOutlined />, items: ["membership-reviews", "personal-members", "corporate-members", "membership-plans", "membership-rewards"] },
  { key: "operations-foundation", label: "经营基础", icon: <SettingOutlined />, items: ["tenant-readiness", "governance", "qualification-types", "capabilities", "/settings/subscription"] },
  { key: "account-access", label: "账号与权限", icon: <TeamOutlined />, items: ["/tenant/accounts", "/tenant/roles", "/settings/client-authorization"] },
  { key: "service-channels", label: "服务与渠道", icon: <ApiOutlined />, items: ["/tenant/integrations", "/tenant/dispatch", "/tenant/support", "ai-settings", "ai-tasks", "client-channel", "/settings/appearance"] },
  { key: "finance-reconciliation", label: "财务与对账", icon: <FileSearchOutlined />, items: ["payment-reconciliation"] },
  { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, items: [] },
] as const;

const originalRoutes = {
  workbench: { label: "运营概览", icon: <AnimatedIcon name="dashboard" /> },
  "operation-report": { label: "经营报表", icon: <AnimatedIcon name="report" /> },
  notifications: { label: "消息中心", icon: <FileTextOutlined /> },
  "ai-settings": { label: "AI 服务设置", icon: <SettingOutlined /> },
  "ai-tasks": { label: "AI 任务中心", icon: <FileTextOutlined /> },
  orders: { label: "订单管理", icon: <FileTextOutlined /> },
  "item-groups": { label: "商品目录", icon: <AppstoreOutlined /> },
  assets: { label: "资产与库存", icon: <BoxPlotOutlined /> },
  "work-orders": { label: "养护工单", icon: <ToolOutlined /> },
  locations: { label: "履约地点", icon: <ShopOutlined /> },
  "pricing-groups": { label: "定价分组", icon: <TagsOutlined /> },
  pricing: { label: "价格版本与调价", icon: <FundOutlined /> },
  discounts: { label: "优惠方案", icon: <TagsOutlined /> },
  coupons: { label: "优惠券", icon: <TagsOutlined /> },
  services: { label: "增值服务", icon: <SafetyCertificateOutlined /> },
  "membership-reviews": { label: "会员审核", icon: <SafetyCertificateOutlined /> },
  "personal-members": { label: "个人会员", icon: <IdcardOutlined /> },
  "corporate-members": { label: "企业会员", icon: <TeamOutlined /> },
  "membership-plans": { label: "会员方案", icon: <TagsOutlined /> },
  "membership-rewards": { label: "会员激励", icon: <GiftOutlined /> },
  "tenant-readiness": { label: "开业配置", icon: <DashboardOutlined /> },
  governance: { label: "品类与业务规则", icon: <SettingOutlined /> },
  "qualification-types": { label: "空间证件类型", icon: <SafetyCertificateOutlined /> },
  capabilities: { label: "经营空间能力", icon: <ControlOutlined /> },
  "client-channel": { label: "客户端渠道", icon: <MobileOutlined /> },
  "payment-reconciliation": { label: "支付对账", icon: <FileSearchOutlined /> },
} as const;

const groupIcons: Record<string, AnimatedIconName> = {
  "platform-rental-core": "rules",
  overview: "dashboard", transactions: "orders", inventory: "inventory", commercial: "pricing",
  customers: "customers", "operations-foundation": "rules", "account-access": "access",
  "service-channels": "plugins", "finance-reconciliation": "finance", "platform-management": "rules",
};
const groupDisplayLabels: Record<string, string> = {
  commercial: "定价营销", customers: "会员客户", "account-access": "账号权限",
  "service-channels": "服务渠道", "finance-reconciliation": "财务对账",
};
const routeDisplayLabels: Record<string, string> = {
  "pricing-groups": "定价分组", pricing: "价格调价", governance: "业务规则",
  capabilities: "经营能力", "qualification-types": "证件类型", "client-channel": "客户渠道",
};

export function createRentalNavigationPresentation(
  pages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>,
  terminology: RentalCategoryTerminology | undefined,
): (sections: Section[]) => Section[] {
  const byPath = new Map([...pages.values()].filter(page => page.coreId === RENTAL_CORE_ID)
    .map(page => [page.path, page]));
  return sections => {
    const rentalRows = new Map<string, Section["routes"][number]>();
    const publicGroups = new Map<string, Section>();
    for (const section of sections) {
      const routes = section.routes.filter(route => {
        const page = byPath.get(route.path);
        if (!page) return true;
        const presentation = originalRoutes[page.definition.id as keyof typeof originalRoutes];
        rentalRows.set(page.definition.id, presentation ? { ...route, ...presentation } : route);
        return false;
      });
      if (routes.length) publicGroups.set(section.key, { ...section, routes });
    }
    const arranged: Section[] = [];
    for (const group of layout) {
      const existing = publicGroups.get(group.key);
      publicGroups.delete(group.key);
      const publicRows = new Map((existing?.routes ?? []).map(route => [route.path, route]));
      const routes: Section["routes"] = [];
      for (const key of group.items) {
        const route = key.startsWith("/") ? publicRows.get(key) : rentalRows.get(key);
        if (route) routes.push(route);
        publicRows.delete(key);
        rentalRows.delete(key);
      }
      routes.push(...publicRows.values());
      if (routes.length) arranged.push({ key: group.key, label: group.label, icon: group.icon, routes });
    }
    // 其他获权 Core 保留自己的分组，不被 Rental 的旧菜单布局吞掉。
    const platform = arranged.findIndex(section => section.key === "platform-management");
    arranged.splice(platform < 0 ? arranged.length : platform, 0, ...publicGroups.values());
    for (const route of rentalRows.values()) arranged.push({ key: byPath.get(route.path)!.key, label: route.label, routes: [route] });
    const path = (id: string) => [...byPath.values()].find(page => page.definition.id === id)?.path ?? "";
    return applyTenantNavigationLabels(arranged, terminology, {
      itemGroups: path("item-groups"), pricingGroups: path("pricing-groups"),
      assets: path("assets"), locations: path("locations"),
    }).map(section => ({
      ...section,
      displayLabel: groupDisplayLabels[section.key] ?? section.displayLabel,
      icon: groupIcons[section.key] ? <AnimatedIcon name={groupIcons[section.key]} /> : section.icon,
      routes: section.routes.map(route => {
        const pageId = byPath.get(route.path)?.definition.id;
        return { ...route, displayLabel: pageId === "assets"
          ? route.label === "资产与库存" ? "资产库存" : route.label.replace("资产与", "")
          : pageId ? routeDisplayLabels[pageId] ?? route.label : route.displayLabel };
      }),
    }));
  };
}
