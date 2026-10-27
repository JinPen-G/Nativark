import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { House } from "./animated-icons/house";
import { MessageSquare } from "./animated-icons/message-square";
import { Blocks } from "./animated-icons/blocks";
import { ChartColumn } from "./animated-icons/chart-column";
import { FileText } from "./animated-icons/file-text";
import { Tag } from "./animated-icons/tag";
import { Users } from "./animated-icons/users";
import { Settings } from "./animated-icons/settings";
import { ShieldCheck } from "./animated-icons/shield-check";
import { Wallet } from "./animated-icons/wallet";
import { Layers } from "./animated-icons/layers";
import { RefreshCw } from "./animated-icons/refresh-cw";
import { Download } from "./animated-icons/download";
import { Upload } from "./animated-icons/upload";
import { LayoutDashboard } from "./animated-icons/hugeicons/layout-dashboard";
import { ChartColumn as HugeChart } from "./animated-icons/hugeicons/chart-column";
import { ClipboardList } from "./animated-icons/hugeicons/clipboard-list";
import { CreditCard } from "./animated-icons/hugeicons/credit-card";
import { Layers01 } from "./animated-icons/hugeicons/layers-01";
import { Users as HugeUsers } from "./animated-icons/hugeicons/users";
import { Settings02 } from "./animated-icons/hugeicons/settings-02";
import { ShieldCheck as HugeShield } from "./animated-icons/hugeicons/shield-check";
import { PlugZap } from "./animated-icons/hugeicons/plug-zap";
import { Wallet as HugeWallet } from "./animated-icons/hugeicons/wallet";
import { FolderOpen } from "./animated-icons/hugeicons/folder-open";
import { Clock01 } from "./animated-icons/hugeicons/clock-01";
import { Sparkles } from "./animated-icons/hugeicons/sparkles";
import { WorkspaceCamera, WorkspaceVehicle, WorkspaceCamping, WorkspaceConstruction } from "./animated-icons/workspace-categories";

const icons = { house: House, messages: MessageSquare, blocks: Blocks, chart: ChartColumn,
  file: FileText, tag: Tag, users: Users, settings: Settings,
  shield: ShieldCheck, wallet: Wallet, layers: Layers, refresh: RefreshCw,
  download: Download, upload: Upload, dashboard: LayoutDashboard, report: HugeChart,
  orders: ClipboardList, pricing: CreditCard, inventory: Layers01, customers: HugeUsers,
  rules: Settings02, access: HugeShield, plugins: PlugZap, finance: HugeWallet,
  folder: FolderOpen, schedule: Clock01, ai: Sparkles,
  camera: WorkspaceCamera, vehicle: WorkspaceVehicle, camping: WorkspaceCamping, construction: WorkspaceConstruction };
export type AnimatedIconName = keyof typeof icons;

/** Animate UI icons and original library artwork adapters; the host owns interaction and accessibility.
 * Subscribe to the actual menu item/button, so its entire hit area triggers once.
 * No document scans, mutation observers, idle loops or extra focus stops. */
export function AnimatedIcon({ name, busy = false, className, style, ...props }: HTMLAttributes<HTMLSpanElement> & { name: AnimatedIconName; busy?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const target = ref.current?.closest<HTMLElement>("button, a, .ant-menu-submenu-title, .ant-menu-item, [role=button], [data-icon-hover]");
    if (!target) return;
    const enter = () => { if (!target.matches(":disabled, [aria-disabled=true]")) setHovered(true); };
    const leave = () => setHovered(false);
    const focus = () => { if (!target.matches(":disabled, [aria-disabled=true]")) setFocused(true); };
    const blur = (event: FocusEvent) => { if (!target.contains(event.relatedTarget as Node | null)) setFocused(false); };
    target.addEventListener("mouseenter", enter); target.addEventListener("mouseleave", leave);
    target.addEventListener("focusin", focus); target.addEventListener("focusout", blur);
    return () => { target.removeEventListener("mouseenter", enter); target.removeEventListener("mouseleave", leave);
      target.removeEventListener("focusin", focus); target.removeEventListener("focusout", blur); };
  }, []);
  const Icon = icons[name];
  return <span {...props} ref={ref} aria-hidden="true" className={["rental-animated-icon", className].filter(Boolean).join(" ")}
    style={{ display: "inline-flex", width: "1em", height: "1em", flex: "none", alignItems: "center", justifyContent: "center", ...style }}>
    <Icon size={16} style={{ width: "100%", height: "100%" }} strokeWidth={1.75}
      animate={!reduced && (busy || hovered || focused)} loop={!reduced && busy} />
  </span>;
}
