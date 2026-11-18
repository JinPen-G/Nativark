/** 原管理后台仅供给当前品牌和路由图标，标题、导航、工具及主动作由公共页头单源呈现。 */
import { useLocation } from "react-router-dom";
import { PageHeading, type PageHeadingProps } from "@rental-os/platform-admin/shell";
import { findRouteByPath } from "@/app/navigation";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { AnimatedIcon } from "./ui/AnimatedIcon";
import { routeIconName } from "@/app/navigation-icons";

export function PageHeader(props: Omit<PageHeadingProps, "brandName" | "icon">) {
  const { pathname } = useLocation();
  const tenant = useAuthStore(state => state.tenant), user = useAuthStore(state => state.user);
  const icon = findRouteByPath(pathname)?.icon;
  return <PageHeading {...props} brandName={resolveAdminBrandName(tenant, user)}
    icon={icon ? <AnimatedIcon name={routeIconName(pathname)} /> : undefined} />;
}
