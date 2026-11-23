/** Rental 宿主向同一公共壳供给原空间选择、消息状态及内联工单详情。
 * 宿主可提供当前 Core 的选择器，迟到导航沿外层路由生命周期核对。 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { PlatformShell, type PlatformShellProps } from "@rental-os/platform-admin";
import { NativeContextSwitcher, useAdminBrandIcon } from "@rental-os/platform-admin/shell";
import { AnimatedIcon, useFeedback, type AnimatedIconName } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { useCoreSession } from "@rental-os/platform-admin/core";
import { RENTAL_CORE_ID } from "@rental-os/rental-core";
import { createRentalOrderApi } from "./orders/client";
import { createRentalNavigationPresentation } from "./browser-navigation-presentation";
import {
  createRentalBrowserNotifications,
  type RentalBrowserNotificationsOptions,
} from "./browser-notifications";

const categoryIcons: Record<string, AnimatedIconName> = {
  camera: "camera", vehicle: "vehicle", camping: "camping", construction: "construction",
};

export interface RentalShellOptions extends RentalBrowserNotificationsOptions {
  workspaceHref: string | null;
  /** 消息页和铃铛使用同一工厂/Provider；省略时维持原独立壳的创建方式。 */
  notifications?: ReturnType<typeof createRentalBrowserNotifications>;
}

export function createRentalShell(options: RentalShellOptions) {
  const profileApi = createRentalOrderApi(options.session.request);
  const notifications = options.notifications ?? createRentalBrowserNotifications({
    ...options,
    soundScopeKey: auth => JSON.stringify([auth.tenant?.tenantId, auth.user?.id]),
  });

  function RentalShellContents({ isLocationCurrent, ...props }: PlatformShellProps & {
    isLocationCurrent: () => boolean;
  }) {
    const auth = options.session.useAuthStore();
    const cores = useCoreSession();
    const { locale } = useLocale();
    const brandIcon = useAdminBrandIcon();
    const { toast } = useFeedback();
    const navigate = useNavigate();
    const inbox = notifications.useNotifications();
    const en = locale === "en-US";
    const workspace = auth.workspaces.find(entry => entry.id === auth.currentWorkspaceId);
    const workspaces = auth.sessionVerified && !auth.user?.isSaasAdmin ? auth.workspaces : [];
    const profile = useQuery({
      queryKey: ["rental-core", "profile"],
      queryFn: ({ signal }) => profileApi.profile({ signal }),
      enabled: Boolean(auth.sessionVerified && auth.user && !auth.user.isSaasAdmin && auth.currentWorkspaceId
        && cores.canAccess(RENTAL_CORE_ID, []) && (auth.hasPermission("rental-os:order:view")
          || auth.hasPermission("rental-core:catalog:view") || auth.hasPermission("rental-core:asset:view"))),
    });
    const mapNavigation = useMemo(() => createRentalNavigationPresentation(props.pages ?? new Map(), profile.data?.terminology),
      [props.pages, profile.data?.terminology]);
    return <PlatformShell {...props}
      mapNavigation={mapNavigation}
      contextSwitcher={props.contextSwitcher === undefined ? <NativeContextSwitcher
        title={auth.user?.isSaasAdmin ? props.brandName : auth.tenant?.tenantName || (en ? "Tenant" : "租户")}
        fullTitle={auth.user?.isSaasAdmin ? props.brandName : auth.tenant?.tenantName || (en ? "Tenant" : "租户")}
        subtitle={auth.user?.isSaasAdmin ? en ? "Platform administration" : "平台管理面"
          : workspace?.name || (en ? "No operating workspace" : "尚无经营空间")}
        brand={props.brand} brandUnframed={brandIcon.isPlatformMark} compact
        options={workspaces.map(entry => ({ id: entry.id, name: entry.name,
          icon: <AnimatedIcon name={categoryIcons[entry.categoryCode] ?? "inventory"} style={{ fontSize: 20 }} /> }))}
        value={auth.currentWorkspaceId ?? ""} label={en ? "Operating workspace" : "经营空间"}
        onChange={async id => {
          if (!isLocationCurrent()) throw new DOMException("经营空间选择页面已变化", "AbortError");
          await options.session.useAuthStore.getState().switchWorkspace(id);
          if (options.workspaceHref && isLocationCurrent()) navigate(options.workspaceHref, { replace: true });
        }}
        onError={() => {
          if (isLocationCurrent()) toast({ type: "error", title: en ? "Workspace switch failed" : "切换经营空间失败" });
        }} /> : props.contextSwitcher}
      notifications={inbox} notificationDetails={id => <notifications.NoticeActions id={id} />} />;
  }

  return function RentalShell(props: PlatformShellProps) {
    // 目录更新须同时重渲染 Provider，撤权后停止业务读取及旧消息动作。
    useCoreSession();
    const location = useLocation();
    const locationKey = useRef(location.key);
    const mounted = useRef(true);
    locationKey.current = location.key;
    // 通知树会在经营空间切换后重建，原路由的有效性须保存在其外层。
    useLayoutEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; };
    }, []);
    const isLocationCurrent = () => mounted.current && locationKey.current === location.key;
    return <notifications.NotificationProvider><RentalShellContents {...props}
      isLocationCurrent={isLocationCurrent} /></notifications.NotificationProvider>;
  };
}
