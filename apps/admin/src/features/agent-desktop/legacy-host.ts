/** 原后台将唯一会话和原登记菜单供给同一 Rental 桌面实现。 */
import { createRentalDesktopAdmin, type DesktopNavigationSource } from "@rental-os/rental-core/admin/agent-desktop";
import { rentalBrowserSession } from "@/api/http";
import { APP_ROUTES, buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "@/app/categoryGovernancePreview";

const navigation: DesktopNavigationSource = {
  routes: APP_ROUTES,
  sections: buildNavigationSections,
  allowed: (route, state) => {
    const registered = Object.values(APP_ROUTES).find(value => value.path === route.path);
    return Boolean(registered && canAccessRoute(registered, state.hasPermission, state.hasCapability,
      state.tenant?.categoryCode, Boolean(state.user?.isSaasAdmin), state.hasTenantMembershipPermission)
      && (CATEGORY_GOVERNANCE_PREVIEW_ENABLED
        || ![APP_ROUTES.platformCategories.path, APP_ROUTES.platformCategoryCapabilities.path].includes(registered.path)));
  },
};

export const legacyRentalDesktop = createRentalDesktopAdmin({ session: rentalBrowserSession, useNavigation: () => navigation });
