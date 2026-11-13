import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { CreditCardIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { useLocale } from "@/app/locale";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { useAuthStore } from "@/features/auth/authStore";
import { NativeAccountMenuView } from "./NativeAccountMenuView";

/** Operator permissions and original commands feed the shared account view. */
export function NativeAccountMenu() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user), tenant = useAuthStore(s => s.tenant);
  const tenantConsole = Boolean(user && !user.isSaasAdmin);
  const logout = useAuthStore(s => s.logout);
  const permissions = useAuthStore(s => s.hasPermission), capability = useAuthStore(s => s.hasCapability), membership = useAuthStore(s => s.hasTenantMembershipPermission);
  const name = user?.displayName ?? t("运营用户"), account = user?.account ?? tenant?.tenantCode ?? "";
  const settings = user?.isSaasAdmin ? APP_ROUTES.platformSystem : APP_ROUTES.appearance;
  const billing = user?.isSaasAdmin ? APP_ROUTES.platformSubscriptions : APP_ROUTES.subscription;
  const allowed = (route: typeof settings | typeof billing) => canAccessRoute(route, permissions, capability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), membership);
  return <NativeAccountMenuView name={name} account={account} compact={tenantConsole}
    billingAction={allowed(billing) ? { label: t("版本订阅"), icon: <HugeiconsIcon icon={CreditCardIcon} strokeWidth={2} />, onSelect: () => navigate(billing.path) } : undefined}
    actions={allowed(settings) ? [{ label: t(user?.isSaasAdmin ? "平台参数" : "外观与音效"), icon: <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />, onSelect: () => navigate(settings.path) }] : []}
    onSignOut={() => { logout(); navigate("/login"); }} />;
}
