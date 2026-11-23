/** 已获权 Rental 的原经营空间入口在公共和其他 Core 页面持续保留。
 * 同一薄壳与通知 Provider 持续挂载，其他 Core 撤权时保留工单原操作状态。 */
import type { ComponentType } from "react";
import type { PlatformShellProps } from "@rental-os/platform-admin";
import { NativeContextSwitcher, useAdminBrandIcon } from "@rental-os/platform-admin/shell";
import { useCoreSession } from "@rental-os/platform-admin/core";
import { useLocale } from "@rental-os/platform-admin/locale";
import { RENTAL_CORE_ID } from "@rental-os/rental-core";
import type { RentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";

export function createMultiCoreShell(
  session: RentalBrowserAdminSession,
  RentalShell: ComponentType<PlatformShellProps>,
) {
  return function MultiCoreShell(props: PlatformShellProps) {
    const auth = session.useAuthStore();
    const cores = useCoreSession();
    const { locale } = useLocale();
    const brandIcon = useAdminBrandIcon();
    const en = locale === "en-US";
    const rentalContext = !auth.user?.isSaasAdmin && cores.canAccess(RENTAL_CORE_ID, []);
    const contextSwitcher = rentalContext ? undefined : <NativeContextSwitcher
      title={auth.user?.isSaasAdmin ? props.brandName : auth.tenant?.tenantName || props.brandName}
      fullTitle={auth.user?.isSaasAdmin ? props.brandName : auth.tenant?.tenantName || props.brandName}
      subtitle={auth.user?.isSaasAdmin ? en ? "Platform administration" : "平台管理面"
        : en ? "Admin console" : "管理后台"}
      brand={props.brand} brandUnframed={brandIcon.isPlatformMark} compact
      options={[]} value="" label={en ? "Business Core" : "业务 Core"}
      onChange={() => undefined} />;
    return <RentalShell {...props} contextSwitcher={contextSwitcher} />;
  };
}
