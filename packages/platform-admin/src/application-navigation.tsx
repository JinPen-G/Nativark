/** 公共菜单沿原管理后台的分组、文案和图标；Core 只补入当前获权的业务页。
 * 注册与菜单可见性不授予接口权限，公共页面继续使用各自原服务端守卫。
 */
import type { AuthUser } from "@rental-os/platform-contracts";
import { matchRoutes, type RouteObject } from "react-router-dom";
import type { PlatformSaasPage } from "./application-context";
import { ApiOutlined, AppstoreOutlined, BgColorsOutlined, CalendarOutlined, ControlOutlined, CrownOutlined,
  CustomerServiceOutlined, DashboardOutlined, SafetyCertificateOutlined, SendOutlined,
  SettingOutlined, ShopOutlined, TeamOutlined } from "./components/ui/icons";
import type { ShellNavigationSection } from "./components/animate-sidebar/NativeNavigation";
import { AnimatedIcon, type AnimatedIconName } from "./components/ui/AnimatedIcon";
import { canManagePublicResource } from "./application-access";
import { hasSubscriptionPermission } from "./features/subscription";
import { hasTenantIntegrationPermission } from "./features/integrations";
import { hasTenantMessagingPermission } from "./features/messaging";
import { canReadSecurityBaseline } from "./features/platform-settings/platformSettingsAccess";

/** 兼容旧链接，页面实现和请求仍使用同一公共应用实例。 */
export const PUBLIC_ADMIN_ROUTE_ALIASES = {
  "/tenant/accounts": "/settings/users",
  "/tenant/roles": "/settings/roles",
  "/tenant/dispatch": "/settings/dispatch",
  "/tenant/support": "/settings/support",
} as const;

export const TENANT_AI_SETTINGS_PATH = "/settings/ai";
export const TENANT_AI_SETTINGS_PERMISSION = "system:params:manage";

/** 原深链接只定位同一已登记公共页面，不作为侧栏菜单的反向别名。 */
export const LEGACY_PUBLIC_ADMIN_ROUTE_ALIASES = {
  "/platform": "/",
  "/users": "/tenant/accounts",
  "/organizations": "/tenant/roles",
  "/permissions": "/tenant/roles",
  "/system-rules": "/platform/system",
  "/security-baseline": "/platform/operations",
  "/integrations": "/platform/operations",
  "/platform-governance": "/platform/tools",
  "/file-assets": "/platform/tools",
  "/async-jobs": "/platform/tools",
} as const;

const groupIcons: Record<string, AnimatedIconName> = {
  overview: "dashboard", "operations-foundation": "rules", "account-access": "access",
  "service-channels": "plugins", "platform-management": "rules",
};
const groupDisplayLabels: Record<string, string> = {
  "account-access": "账号权限", "service-channels": "服务渠道",
};
const routeDisplayLabels: Record<string, string> = {
  "/settings/subscription": "版本订阅", "/settings/appearance": "外观音效",
  "/platform/tools": "平台治理", "/platform/official-calendars": "公共日历",
  "/platform/subscription-catalog": "功能定价",
};

export function publicAdminNavigation(user: AuthUser, showOverview: boolean, platformAiAvailable = false,
  saasPages: readonly PlatformSaasPage[] = [], tenantAiAvailable = false): ShellNavigationSection[] {
  const tenant = (permission: string) => canManagePublicResource(user, "tenant", permission);
  const saas = (permission: string) => canManagePublicResource(user, "saas", permission);
  const sections: ShellNavigationSection[] = [
    { key: "overview", label: "概览", icon: <DashboardOutlined />, routes: showOverview
      ? [{ path: "/", label: "工作台", icon: <DashboardOutlined /> }] : [] },
    { key: "operations-foundation", label: "经营基础", icon: <SettingOutlined />, routes:
      hasSubscriptionPermission(user, "rental-os:subscription:view")
        ? [{ path: "/settings/subscription", label: "版本与订阅", icon: <CrownOutlined /> }] : [] },
    { key: "account-access", label: "账号与权限", icon: <TeamOutlined />, routes: [
      ...(tenant("system:user:manage") ? [{ path: "/tenant/accounts", label: "运营账号", icon: <TeamOutlined /> }] : []),
      ...(tenant("system:role:manage") ? [{ path: "/tenant/roles", label: "角色权限", icon: <SafetyCertificateOutlined /> }] : []),
    ] },
    { key: "service-channels", label: "服务与渠道", icon: <ApiOutlined />, routes: [
      ...(hasTenantIntegrationPermission(user)
        ? [{ path: "/tenant/integrations", label: "第三方服务", icon: <ApiOutlined /> }] : []),
      ...(hasTenantMessagingPermission(user, "system:integration:manage") ? [
        { path: "/tenant/dispatch", label: "寄件中心", icon: <SendOutlined /> },
        { path: "/tenant/support", label: "客服中心", icon: <CustomerServiceOutlined /> },
      ] : []),
      ...(tenantAiAvailable && tenant(TENANT_AI_SETTINGS_PERMISSION)
        ? [{ path: TENANT_AI_SETTINGS_PATH, label: "AI 服务设置", icon: <SettingOutlined /> }] : []),
      ...(tenant("system:integration:manage")
        ? [{ path: "/settings/appearance", label: "外观与音效", icon: <BgColorsOutlined /> }] : []),
    ] },
    { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, routes: [
      ...(saas("system:tenant:manage") ? [{ path: "/platform/tenants", label: "SaaS 租户", icon: <ShopOutlined /> }] : []),
      ...(saas("system:demo-request:view") ? [{ path: "/platform/demo-requests", label: "演示预约", icon: <CalendarOutlined /> }] : []),
      ...(hasSubscriptionPermission(user, "system:tenant:subscription:manage") ? [
        { path: "/platform/subscriptions", label: "租户订阅", icon: <CrownOutlined /> },
        { path: "/platform/subscription-catalog", label: "功能目录与定价", icon: <AppstoreOutlined /> },
      ] : []),
      ...(saas("system:calendar-source:manage") ? [{ path: "/platform/official-calendars", label: "公共官方日历", icon: <CalendarOutlined /> }] : []),
      ...(saas("system:user:manage") ? [{ path: "/platform/users", label: "组织与权限", icon: <TeamOutlined /> }] : []),
      ...(platformAiAvailable && saas("system:ai-provider:view")
        ? [{ path: "/platform/ai", label: "平台 AI 配置", icon: <ApiOutlined /> }] : []),
      ...(user.isSaasAdmin && canReadSecurityBaseline(user)
        ? [{ path: "/platform/system", label: "平台参数", icon: <SettingOutlined /> }] : []),
      ...(saas("system:params:manage")
        ? [{ path: "/platform/operations", label: "平台运维", icon: <SafetyCertificateOutlined /> }] : []),
      ...(saas("system:params:manage")
        ? [{ path: "/platform/tools", label: "平台工具与治理", icon: <ControlOutlined /> }] : []),
      ...(saas("system:tenant:manage") ? [
        { path: "/platform/core-packages", label: "Core 包管理", icon: <AppstoreOutlined /> },
        { path: "/platform/core-access", label: "租户 Core 授权", icon: <ControlOutlined /> },
      ] : []),
    ] },
  ];
  const extensionSections = new Map<string, ShellNavigationSection>();
  for (const page of saasPages) if (saas(page.permission)) {
    const section = extensionSections.get(page.section.key) ?? { ...page.section, routes: [] };
    section.routes.push({ path: page.path, label: page.label, icon: page.icon });
    extensionSections.set(section.key, section);
  }
  sections.unshift(...extensionSections.values());
  return sections.filter(section => section.routes.length).map(section => ({
    ...section,
    displayLabel: groupDisplayLabels[section.key],
    icon: groupIcons[section.key] ? <AnimatedIcon name={groupIcons[section.key]} /> : section.icon,
    routes: section.routes.map(route => ({ ...route,
      displayLabel: routeDisplayLabels[route.path] ?? route.label,
      icon: section.key === "overview" ? <AnimatedIcon name="dashboard" /> : route.icon,
    })),
  }));
}

export function publicAdminMenuPath(pathname: string): string {
  const alias = Object.entries(PUBLIC_ADMIN_ROUTE_ALIASES).find(([, target]) =>
    pathname === target || pathname.startsWith(`${target}/`));
  return alias ? alias[0] + pathname.slice(alias[1].length) : pathname;
}

/** 基于同一 Router 的真实登记和当前菜单权限供给助手导航，不接收调用者权限声明。 */
export function createPublicAdminLocationAccess(options: {
  routes: RouteObject[];
  getSession(): { sessionVerified: boolean; user?: AuthUser | null };
  platformAiAvailable: boolean;
  tenantAiAvailable?: boolean;
  saasPages?: readonly PlatformSaasPage[];
}) {
  function locate(href: string) {
    if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/.test(href)) return;
    const state = options.getSession();
    if (!state.sessionVerified || !state.user) return;
    let url: URL;
    try { url = new URL(href, "https://platform.invalid"); decodeURIComponent(url.pathname); } catch { return; }
    const matched = matchRoutes(options.routes, url.pathname)?.at(-1)?.route;
    if (!matched?.path || matched.path === "*" || matched.id?.startsWith("core:" ) || matched.id?.startsWith("core-alias:")) return;
    const original = publicAdminMenuPath(url.pathname);
    const permitted = publicAdminNavigation(state.user, false, options.platformAiAvailable, options.saasPages, options.tenantAiAvailable)
      .flatMap(section => section.routes).some(route => original === route.path || original.startsWith(`${route.path}/`));
    return permitted ? { href: `${url.pathname}${url.search}${url.hash}`, original } : undefined;
  }
  return {
    canAccess: (route: { path: string }) => Boolean(locate(route.path)),
    resolve: (href: string) => locate(href)?.href ?? null,
    originalPath: (pathname: string) => locate(pathname)?.original ?? null,
  };
}
