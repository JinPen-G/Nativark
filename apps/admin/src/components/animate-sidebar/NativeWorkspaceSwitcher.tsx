import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { AnimatedIcon, type AnimatedIconName } from "@/components/ui/AnimatedIcon";
import { useAdminBrandIcon } from "@/app/BrandIconProvider";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { useFeedback } from "@/components/ui";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from "./runtime/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from "./runtime/dropdown-menu";

const categoryIcons: Record<string, AnimatedIconName> = { camera: "camera", vehicle: "vehicle", camping: "camping", construction: "construction" };

/** Compact shell identity; workspace changes still use the authenticated store command. */
export function NativeWorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar(), { t } = useLocale(), icon = useAdminBrandIcon();
  const tenant = useAuthStore(s => s.tenant), user = useAuthStore(s => s.user), workspaces = useAuthStore(s => s.workspaces);
  const currentId = useAuthStore(s => s.currentWorkspaceId), switchWorkspace = useAuthStore(s => s.switchWorkspace);
  const [switching, setSwitching] = useState(false);
  const navigate = useNavigate(), { toast } = useFeedback();
  const title = user?.isSaasAdmin ? "Rental OS" : tenant?.tenantName ?? t("租户");
  const subtitle = workspaces.find(w => w.id === currentId)?.name ?? t(user?.isSaasAdmin ? "平台管理面" : "尚无经营空间");
  const fullName = `${title} · ${compact ? subtitle : t(subtitle)}`;
  const menuClassName = compact ? "rental-workspace-menu" : undefined;
  const triggerClassName = compact ? "rental-workspace-trigger" : undefined;
  const content = <><div data-sidebar="brand-mark" data-brand-inverted={icon.isPlatformMark || undefined} className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><img src={icon.src} onError={icon.onError} alt="" className="size-8 rounded-lg bg-sidebar object-contain" /></div>
    {compact ? <span className="rental-workspace-identity">
      <span className="rental-workspace-tenant-name" title={title}>{title}</span>
      <span className="rental-workspace-name" title={subtitle}>{subtitle}</span>
    </span> : <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{title}</span><span className="truncate text-xs">{t(subtitle)}</span></div>}</>;
  if (workspaces.length < 2) return <SidebarMenu className={menuClassName}><SidebarMenuItem>
    <SidebarMenuButton size="lg" className={triggerClassName}
      render={<div role="group" tabIndex={compact ? 0 : undefined} aria-label={fullName} title={fullName} />}>{content}</SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu>;
  const change = async (id: string) => {
    if (id === currentId || switching) return;
    setSwitching(true);
    try { await switchWorkspace(id); setOpenMobile(false); navigate("/workbench", { replace: true }); }
    catch { toast({ type: "error", title: t("切换经营空间失败") }); }
    finally { setSwitching(false); }
  };
  return <SidebarMenu className={menuClassName}><SidebarMenuItem><DropdownMenu>
    <DropdownMenuTrigger aria-label={fullName} title={fullName} disabled={switching} render={<SidebarMenuButton size="lg" className={`${triggerClassName ?? ""} data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground`} />}>
      {content}<HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className={compact ? "rental-workspace-chevron" : "ml-auto"} />
    </DropdownMenuTrigger>
    <DropdownMenuContent className={`w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg${compact ? " rental-workspace-popup" : ""}`} align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
      <DropdownMenuGroup><DropdownMenuLabel className="text-xs text-muted-foreground">{t("经营空间")}</DropdownMenuLabel>
        {workspaces.map(w => <DropdownMenuItem key={w.id} data-icon-hover="" className="gap-2 p-2" disabled={switching}
          aria-label={compact ? w.name : t(w.name)} aria-current={w.id === currentId ? "true" : undefined} onClick={() => void change(w.id)}>
          <span data-sidebar="workspace-icon" className="flex size-6 shrink-0 items-center justify-center">
            <AnimatedIcon name={categoryIcons[w.categoryCode] ?? "inventory"} style={{ fontSize: 20 }} />
          </span><span className={compact ? "rental-workspace-option-name" : "truncate"}>{compact ? w.name : t(w.name)}</span>
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
