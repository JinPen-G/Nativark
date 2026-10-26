import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { CreditCardIcon, Logout01Icon, Settings01Icon, UnfoldMoreIcon, SunMoonIcon, LanguageSkillIcon } from "@hugeicons/core-free-icons";
import { useLocale, type AdminLocale } from "@/app/locale";
import { useAppearance } from "@/app/theme";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { ADMIN_DEFAULT_USER_AVATAR } from "@/app/userAvatar";
import { useAuthStore } from "@/features/auth/authStore";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from "./runtime/sidebar";
import { Avatar, AvatarImage, AvatarFallback } from "./runtime/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./runtime/dropdown-menu";

/** Reference NavUser geometry and grouping; only real account actions replace the demo. */
export function NativeAccountMenu() {
  const { isMobile, setOpenMobile } = useSidebar();
  const { t, locale, setLocale } = useLocale();
  const { preference, setMode } = useAppearance();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user), tenant = useAuthStore(s => s.tenant);
  const logout = useAuthStore(s => s.logout);
  const permissions = useAuthStore(s => s.hasPermission), capability = useAuthStore(s => s.hasCapability), membership = useAuthStore(s => s.hasTenantMembershipPermission);
  const name = user?.displayName ?? t("运营用户"), account = user?.account ?? tenant?.tenantCode ?? "";
  const settings = user?.isSaasAdmin ? APP_ROUTES.platformSystem : APP_ROUTES.appearance;
  const billing = user?.isSaasAdmin ? APP_ROUTES.platformSubscriptions : APP_ROUTES.subscription;
  const allowed = (route: typeof settings | typeof billing) => canAccessRoute(route, permissions, capability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), membership);
  const visit = (path: string) => { setOpenMobile(false); navigate(path); };
  const identity = <><Avatar className="h-8 w-8 rounded-lg"><AvatarImage src={ADMIN_DEFAULT_USER_AVATAR} alt="" /><AvatarFallback className="rounded-lg">{name.slice(0, 1)}</AvatarFallback></Avatar>
    <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{name}</span><span className="truncate text-xs">{account}</span></div></>;
  return <SidebarMenu><SidebarMenuItem><DropdownMenu>
    <DropdownMenuTrigger aria-label={`${t("账号菜单")}, ${name}`} render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
      {identity}<HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="ml-auto size-4" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
      <DropdownMenuGroup><DropdownMenuLabel className="p-0 font-normal"><div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">{identity}</div></DropdownMenuLabel></DropdownMenuGroup>
      <DropdownMenuSeparator />
      {allowed(billing) && <><DropdownMenuGroup><DropdownMenuItem onClick={() => visit(billing.path)}><HugeiconsIcon icon={CreditCardIcon} strokeWidth={2} />{t("版本订阅")}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /></>}
      <DropdownMenuGroup>
        {allowed(settings) && <DropdownMenuItem onClick={() => visit(settings.path)}><HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />{t(user?.isSaasAdmin ? "平台参数" : "外观与音效")}</DropdownMenuItem>}
        <DropdownMenuSub><DropdownMenuSubTrigger><HugeiconsIcon icon={SunMoonIcon} strokeWidth={2} />{t("主题")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuRadioGroup value={preference} onValueChange={value => setMode(value === "dark" ? "dark" : value === "system" ? "system" : "default")}>
            <DropdownMenuRadioItem value="default">{t("浅色")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark">{t("深色")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="system">{t("跟随系统")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
        <DropdownMenuSub><DropdownMenuSubTrigger><HugeiconsIcon icon={LanguageSkillIcon} strokeWidth={2} />{t("语言")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuRadioGroup value={locale} onValueChange={value => setLocale(value as AdminLocale)}>
            <DropdownMenuRadioItem value="zh-CN">中文</DropdownMenuRadioItem><DropdownMenuRadioItem value="en-US">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
      </DropdownMenuGroup><DropdownMenuSeparator />
      <DropdownMenuGroup><DropdownMenuItem onClick={() => { logout(); visit("/login"); }}><HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />{t("退出登录")}</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
