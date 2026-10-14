import { CreditCard, Languages, Monitor, Moon, Settings, Sun, SunMoon, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLocale, type AdminLocale } from "@/app/locale";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { UserMenu, useFeedback } from "@/components/ui";

/** UIArc account menu; both preferences use its original sliding-thumb rows. */
export function AccountMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const { preference, setMode } = useAppearance();
  const user = useAuthStore(state => state.user);
  const tenant = useAuthStore(state => state.tenant);
  const logout = useAuthStore(state => state.logout);
  const hasPermission = useAuthStore(state => state.hasPermission);
  const hasCapability = useAuthStore(state => state.hasCapability);
  const hasTenantMembershipPermission = useAuthStore(state => state.hasTenantMembershipPermission);
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const settingRoute = user?.isSaasAdmin ? APP_ROUTES.platformSystem : APP_ROUTES.appearance;
  const billingRoute = user?.isSaasAdmin ? APP_ROUTES.platformSubscriptions : APP_ROUTES.subscription;
  const visit = (route: typeof settingRoute, unavailable: string) => {
    if (canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission)) navigate(route.path);
    else toast({ type: "info", title: t(unavailable) });
  };
  return <UserMenu align="start" showName={!collapsed} className="rental-account-trigger"
    user={{ name: user?.displayName ?? t("运营用户"), email: user?.account ?? tenant?.tenantCode ?? "" }}
    labels={{ account: t("账号菜单"), signOut: t("退出登录"), signingOut: t("正在退出") }}
    items={[
      { label: t("个人资料"), icon: <UserRound size={16} strokeWidth={1.75} />, onSelect: () => toast({ type: "info", title: t("个人资料尚未接入") }) },
      { label: t("设置"), icon: <Settings size={16} strokeWidth={1.75} />, onSelect: () => visit(settingRoute, "此账号暂不可访问设置") },
      { label: t("账单"), icon: <CreditCard size={16} strokeWidth={1.75} />, onSelect: () => visit(billingRoute, "此账号暂不可访问账单") },
    ]}
    showTheme={false}
    preferenceGroups={[
      { label: t("主题"), icon: <SunMoon size={16} strokeWidth={1.75} />, value: preference === "dark" ? "dark" : preference === "system" ? "system" : "light",
        options: [
          { value: "light", label: t("浅色"), icon: <Sun size={15} strokeWidth={1.75} /> },
          { value: "dark", label: t("深色"), icon: <Moon size={15} strokeWidth={1.75} /> },
          { value: "system", label: t("跟随系统"), icon: <Monitor size={15} strokeWidth={1.75} /> },
        ], onChange: next => setMode(next === "system" ? "system" : next === "dark" ? "dark" : "default") },
      { label: t("语言"), icon: <Languages size={16} strokeWidth={1.75} />, value: locale,
        options: [
          { value: "zh-CN", label: "中文", icon: <span>中</span> },
          { value: "en-US", label: "English", icon: <span>EN</span> },
        ], onChange: next => setLocale(next as AdminLocale) },
    ]}
    onSignOut={() => { logout(); navigate("/login"); }} />;
}
