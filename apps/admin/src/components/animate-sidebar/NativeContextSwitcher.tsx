/** Controlled shell context picker. The host supplies allowed options and its
 * original switch command, without exposing authentication to this UI. */
import { useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from "./runtime/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from "./runtime/dropdown-menu";

export interface ShellContextOption { id: string; name: string; icon?: ReactNode }
export function NativeContextSwitcher({ title, subtitle, brand, brandInverted, compact = true, options, value, label, onChange, onError }: {
  title: string; subtitle: string; brand: ReactNode; brandInverted?: boolean; compact?: boolean;
  options: ShellContextOption[]; value: string; label: string;
  onChange: (id: string) => void | Promise<void>; onError?: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [switching, setSwitching] = useState(false);
  const switchingNow = useRef(false);
  const fullName = `${title} · ${subtitle}`;
  const triggerClass = compact ? "rental-workspace-trigger" : "";
  const identity = <><div data-sidebar="brand-mark" data-brand-inverted={brandInverted || undefined}
    className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">{brand}</div>
    {compact ? <span className="rental-workspace-identity">
      <span className="rental-workspace-tenant-name" title={title}>{title}</span>
      <span className="rental-workspace-name" title={subtitle}>{subtitle}</span>
    </span> : <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{title}</span><span className="truncate text-xs">{subtitle}</span></div>}</>;
  const change = async (id: string) => {
    if (id === value || switchingNow.current || !options.some(option => option.id === id)) return;
    switchingNow.current = true;
    setSwitching(true);
    try { await onChange(id); setOpenMobile(false); }
    catch { onError?.(); }
    finally { switchingNow.current = false; setSwitching(false); }
  };
  if (options.length < 2) return <SidebarMenu className={compact ? "rental-workspace-menu" : undefined}><SidebarMenuItem>
    <SidebarMenuButton size="lg" className={triggerClass} render={<div role="group" tabIndex={compact ? 0 : undefined} aria-label={fullName} title={fullName} />}>{identity}</SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu>;
  return <SidebarMenu className={compact ? "rental-workspace-menu" : undefined}><SidebarMenuItem><DropdownMenu>
    <DropdownMenuTrigger aria-label={fullName} title={fullName} disabled={switching}
      render={<SidebarMenuButton size="lg" className={`${triggerClass} data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground`} />}>
      {identity}<HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className={compact ? "rental-workspace-chevron" : "ml-auto"} />
    </DropdownMenuTrigger>
    <DropdownMenuContent className={`w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg${compact ? " rental-workspace-popup" : ""}`} align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
      <DropdownMenuGroup><DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        {options.map(option => <DropdownMenuItem key={option.id} data-icon-hover="" className="gap-2 p-2" disabled={switching}
          aria-label={option.name} aria-current={option.id === value ? "true" : undefined} onClick={() => void change(option.id)}>
          {option.icon && <span data-sidebar="workspace-icon" className="flex size-6 shrink-0 items-center justify-center">{option.icon}</span>}
          <span className={compact ? "rental-workspace-option-name" : "truncate"}>{option.name}</span>
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}
