/** 当前 Rental 页面取得经营空间选择器，工单与公共页保留公共上下文。
 * 同一薄壳与通知 Provider 持续挂载，其他 Core 撤权时保留工单原操作状态。 */
import { matchRoutes, useLocation } from "react-router-dom";
import type { CoreRegisteredPage } from "@rental-os/core-contracts";
import type { PlatformShellProps } from "@rental-os/platform-admin";
import { NativeContextSwitcher } from "@rental-os/platform-admin/shell";
import { useCoreSession, type CoreRouteComponent } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { RENTAL_CORE_ID } from "@rental-os/rental-core";
import { createRentalShell, type createRentalNavigation } from "@rental-os/rental-core/admin";
import type { RentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";

export function createMultiCoreShell(
  session: RentalBrowserAdminSession,
  pages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>,
  navigation: ReturnType<typeof createRentalNavigation>,
) {
  const RentalShell = createRentalShell({
    session,
    resolveHref: navigation.resolveNoticeHref,
    hasPageAccess: navigation.canAccessPage,
    workspaceHref: navigation.resolvePageHref("/workbench"),
  });

  return function MultiCoreShell(props: PlatformShellProps) {
    const auth = session.useAuthStore();
    const cores = useCoreSession();
    const { pathname } = useLocation();
    const { locale } = useLocale();
    const en = locale === "en-US";
    const matched = matchRoutes(
      [...pages.values()].map(entry => ({ path: entry.path, handle: entry })),
      pathname,
    )?.at(-1);
    const page = matched?.route.handle;
    const rentalContext = page?.coreId === RENTAL_CORE_ID
      && cores.canAccess(RENTAL_CORE_ID, page.definition.permissions);
    const contextSwitcher = rentalContext ? undefined : <NativeContextSwitcher
      title={auth.tenant?.operatorShortName || auth.tenant?.tenantName || props.brandName}
      fullTitle={auth.tenant?.tenantName || props.brandName}
      subtitle={auth.user?.isSaasAdmin ? en ? "Platform administration" : "平台管理"
        : en ? "Admin console" : "管理后台"}
      brand={props.brand} brandUnframed compact={!auth.user?.isSaasAdmin}
      options={[]} value="" label={en ? "Business Core" : "业务 Core"}
      onChange={() => undefined} />;
    return <RentalShell {...props} contextSwitcher={contextSwitcher} />;
  };
}
