/** 原 Rental 深链接映射到同一注册表，消息跳转复核当前服务端 Core 使用目录。
 * 经营空间只从已验证会话取得，地址与通知内容仅用于定位登记目标。 */
import { matchRoutes } from "react-router-dom";
import {
  canUseCorePage,
  corePageKey,
  resolveCorePageLocation,
  type CoreRegisteredPage,
  type CoreScopeReference,
  type CoreSessionContext,
} from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "@rental-os/rental-core";
import type { RentalBrowserAdminSession } from "./browser";
import type { Notice, RentalNotificationAuth } from "./browser-notifications";
import { RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS } from "./membership";
import { rentalWorkOrderLocation } from "./work-orders";

export function createRentalNavigation(
  pages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>,
  session: RentalBrowserAdminSession,
) {
  const unprefixedPages = new Set([
    "workbench",
    "operation-report",
    ...Object.keys(RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS).filter(id => id !== "qualification-types"),
  ]);
  const tenantPages = new Set(["tenant-readiness", "client-channel"]);
  const routes = [...pages.values()].filter(page => page.coreId === RENTAL_CORE_ID).flatMap(page => {
    const prefix = tenantPages.has(page.definition.id) ? "/tenant"
      : unprefixedPages.has(page.definition.id) ? "" : "/rental";
    return [
      { path: page.path, handle: page },
      { path: `${prefix}${page.definition.path}`, handle: page },
    ];
  });

  function resolvePage(href: string) {
    if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")
      || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
    try {
      const url = new URL(href, "https://rental.invalid");
      if (url.origin !== "https://rental.invalid") return undefined;
      // matchRoutes 沿原 Router 解码参数，先拒绝损坏的 URI 编码。
      decodeURIComponent(url.pathname);
      const matched = matchRoutes(routes, url.pathname)?.at(-1);
      if (!matched) return undefined;
      const page = matched.route.handle;
      const params = Object.fromEntries(Object.entries(matched.params)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      const path = resolveCorePageLocation(pages, { coreId: page.coreId, pageId: page.definition.id, params });
      return { page, href: `${path}${url.search}${url.hash}`, search: url.search, hash: url.hash };
    } catch {
      return undefined;
    }
  }

  function tenantScoped(pageId: string) {
    return pageId === "client-channel"
      || RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS[pageId]?.scope === "tenant-membership";
  }

  function getCoreContainer(coreId: string, pageId: string): CoreScopeReference["container"] {
    const auth = session.useAuthStore.getState();
    if (coreId !== RENTAL_CORE_ID || !pages.has(corePageKey(coreId, pageId))
      || !auth.sessionVerified || !auth.token || !auth.tenant?.tenantId
      || !auth.user?.id || auth.user.isSaasAdmin || tenantScoped(pageId)) return undefined;
    return auth.currentWorkspaceId
      ? { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: auth.currentWorkspaceId } : undefined;
  }

  function canAccessPage(pageId: string, auth: RentalNotificationAuth): boolean {
    if (!auth.sessionVerified || !auth.token || !auth.tenant?.tenantId
      || !auth.user?.id || auth.user.isSaasAdmin) return false;
    const page = pages.get(corePageKey(RENTAL_CORE_ID, pageId));
    if (!page || (!tenantScoped(pageId) && !auth.currentWorkspaceId)) return false;
    const query = session.queryClient.getQueryState<CoreSessionContext>([
      "platform-core-session", session.currentSessionEpoch(), auth.tenant.tenantId, auth.user.id,
    ]);
    const context = query?.status === "success" && !query.error ? query.data : undefined;
    return Boolean(context && context.tenantId === auth.tenant.tenantId && context.subjectId === auth.user.id
      && canUseCorePage(context, page.coreId, page.definition.permissions));
  }

  function resolveNoticeHref(item: Notice, auth: RentalNotificationAuth): string | null {
    let target = resolvePage(item.href);
    if (item.workOrderId) {
      try {
        const path = resolveCorePageLocation(pages, rentalWorkOrderLocation(item.workOrderId));
        target = resolvePage(`${path}${target?.search ?? ""}${target?.hash ?? ""}`);
      } catch {
        return null;
      }
    }
    if (!target || !canAccessPage(target.page.definition.id, auth)) return null;
    return target.href;
  }

  return {
    resolvePageHref: (href: string) => resolvePage(href)?.href ?? null,
    resolveNoticeHref,
    canAccessPage,
    getCoreContainer,
  };
}
