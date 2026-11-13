/** Shared NavUser presentation and preferences. Account identity and permitted
 * commands are provided by each host's existing session. */
import { useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon, UnfoldMoreIcon, SunMoonIcon, LanguageSkillIcon } from "@hugeicons/core-free-icons";
import { useLocale, type AdminLocale } from "@/app/locale";
import { useAppearance } from "@/app/theme";
import { ADMIN_DEFAULT_USER_AVATAR } from "@/app/userAvatar";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from "./runtime/sidebar";
import { Avatar, AvatarImage, AvatarFallback } from "./runtime/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "./runtime/dropdown-menu";

export interface ShellAccountAction { label: string; icon: ReactNode; onSelect: () => void }
export function NativeAccountMenuView({ name, account, billingAction, actions = [], onSignOut, onError }: {
  name: string; account: string; billingAction?: ShellAccountAction; actions?: ShellAccountAction[];
  onSignOut?: () => void | Promise<void>; onError?: (error: unknown) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { t, locale, setLocale } = useLocale(), { preference, setMode } = useAppearance();
  const [signingOut, setSigningOut] = useState(false);
  const signingOutNow = useRef(false);
  const identity = <><Avatar className="h-8 w-8 rounded-lg"><AvatarImage src={ADMIN_DEFAULT_USER_AVATAR} alt="" /><AvatarFallback className="rounded-lg">{name.slice(0, 1)}</AvatarFallback></Avatar>
    <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{name}</span><span className="truncate text-xs">{account}</span></div></>;
  const signOut = async () => {
    if (!onSignOut || signingOutNow.current) return;
    signingOutNow.current = true;
    setSigningOut(true);
    try { await onSignOut(); setOpenMobile(false); }
    catch (error) { onError?.(error); }
    finally { signingOutNow.current = false; setSigningOut(false); }
  };
  return <SidebarMenu><SidebarMenuItem><DropdownMenu>
    <DropdownMenuTrigger aria-label={`${t("账号菜单")}, ${name}`} render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}>
      {identity}<HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="ml-auto size-4" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
      <DropdownMenuGroup><DropdownMenuLabel className="p-0 font-normal"><div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">{identity}</div></DropdownMenuLabel></DropdownMenuGroup>
      <DropdownMenuSeparator />
      {billingAction && <><DropdownMenuGroup><DropdownMenuItem onClick={() => { billingAction.onSelect(); setOpenMobile(false); }}>{billingAction.icon}{billingAction.label}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /></>}
      <DropdownMenuGroup>
        {actions.map(action => <DropdownMenuItem key={action.label} onClick={() => { action.onSelect(); setOpenMobile(false); }}>{action.icon}{action.label}</DropdownMenuItem>)}
        <DropdownMenuSub><DropdownMenuSubTrigger><HugeiconsIcon icon={SunMoonIcon} strokeWidth={2} />{t("主题")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuRadioGroup value={preference} onValueChange={value => setMode(value === "dark" ? "dark" : value === "system" ? "system" : "default")}>
            <DropdownMenuRadioItem value="default">{t("浅色")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark">{t("深色")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="system">{t("跟随系统")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
        <DropdownMenuSub><DropdownMenuSubTrigger><HugeiconsIcon icon={LanguageSkillIcon} strokeWidth={2} />{t("语言")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent><DropdownMenuRadioGroup value={locale} onValueChange={value => setLocale(value as AdminLocale)}>
            <DropdownMenuRadioItem value="zh-CN">中文</DropdownMenuRadioItem><DropdownMenuRadioItem value="en-US">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
      </DropdownMenuGroup>
      {onSignOut && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem disabled={signingOut} onClick={() => void signOut()}>
        <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />{t("退出登录")}
      </DropdownMenuItem></DropdownMenuGroup></>}
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
