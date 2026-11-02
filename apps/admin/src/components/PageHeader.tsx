import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { findRouteByPath } from "@/app/navigation";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { AnimatedIcon } from "./ui/AnimatedIcon";
import { routeIconName } from "@/app/navigation-icons";
import { PageHeading } from "./PageHeading";

/** Operator route/brand adapter. Shared heading owns the 8px content gap;
 * necessary risks stay visible, ordinary detailed notes may use the popover. */
export function PageHeader(props: { title: string; description?: string; view?: ReactNode; extra?: ReactNode; note?: { title: string; description: ReactNode } }) {
  const { pathname } = useLocation();
  const tenant = useAuthStore(state => state.tenant), user = useAuthStore(state => state.user);
  return <PageHeading {...props} brandName={resolveAdminBrandName(tenant, user)}
    icon={findRouteByPath(pathname)?.icon ? <AnimatedIcon name={routeIconName(pathname)} /> : undefined} />;
}
