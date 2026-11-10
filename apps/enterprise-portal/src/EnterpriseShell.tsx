/** Shared native sidebar primitives with customer-owned slots only. */
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { EnterprisePortalAction } from "@rental-os/shared";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarInset, SidebarTrigger, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/animate-sidebar/runtime/sidebar";
import { TooltipProvider } from "@/components/animate-sidebar/runtime/tooltip";
import { useAppearance } from "@/app/theme";
import { useLocale } from "@/app/locale";
import { AppearanceSwitcher } from "@/components/AppearanceSwitcher";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Building2, LogOut } from "lucide-react";
import { TeamOutlined, HistoryOutlined, FileTextOutlined, FormOutlined, IdcardOutlined, GiftOutlined, SafetyCertificateOutlined, ControlOutlined, FileSearchOutlined, InboxOutlined } from "@/components/ui/icons";
import { useEnterprise } from "./enterprise-session";
import "@/components/animate-sidebar/animate-sidebar.css";
import "@/components/animate-sidebar/sidebar-adapter.css";
export function EnterpriseShell({ children }: { children: ReactNode }) {
  const { mode } = useAppearance(), { locale, setLocale } = useLocale();
  const context = useEnterprise(), [logoutError, setLogoutError] = useState("");
  const english = locale === "en-US";
  const memberLabel = english ? "Members" : "企业成员";
  const corporate = context.entry?.corporates.find(c => c.corporateCustomerId === context.selectedCorporateId);
  const location = useLocation(), activePage = location.pathname.slice(context.basePath.length).replace(/^\//, "") || "members";
  const menus: Array<{ path: string; zh: string; en: string; icon: ReactNode; action?: EnterprisePortalAction }> = [
    { path: "tasks", zh: "企业待办", en: "Tasks", icon: <InboxOutlined /> }, { path: "records", zh: "操作记录", en: "Records", icon: <HistoryOutlined /> },
    { path: "profile", zh: "资料与申请", en: "Profile and requests", icon: <FileTextOutlined /> },
    { path: "members", zh: "企业成员", en: "Members", icon: <TeamOutlined />, action: "members:read" },
    { path: "applications", zh: "企业申请", en: "Applications", icon: <FormOutlined /> }, { path: "join", zh: "加入与交接", en: "Join and transfer", icon: <IdcardOutlined /> },
    { path: "invites", zh: "邀请管理", en: "Invitations", icon: <GiftOutlined />, action: "invites:manage" }, { path: "join-requests", zh: "加入审核", en: "Join requests", icon: <SafetyCertificateOutlined />, action: "members:manage" },
    { path: "policy", zh: "使用政策", en: "Rental policy", icon: <ControlOutlined />, action: "policy:manage" },
    { path: "approvals", zh: "预约审批", en: "Approvals", icon: <FileSearchOutlined /> },
    { path: "orders", zh: "企业订单", en: "Orders", icon: <FileSearchOutlined />, action: "orders:read" },
    { path: "exchange-approvals", zh: "换货审批", en: "Exchange approvals", icon: <FileSearchOutlined /> },
    { path: "extension-approvals", zh: "续租审批", en: "Extension approvals", icon: <FileSearchOutlined /> }
  ];
  const visible = menus.filter(menu => !menu.action || corporate?.actions.includes(menu.action));
  return <TooltipProvider><div className="app-frame-stage"><div className="app-shell native-admin-shell">
    <SidebarProvider animateOnHover={false} style={{ "--sidebar-width": "var(--rental-sidebar-expanded-width)" } as CSSProperties} className={`rental-animate-scope relative h-full min-h-0${mode === "dark" ? " dark" : ""}`}>
      <Sidebar variant="inset" collapsible="icon" className="rental-sidebar-colors">
        <SidebarHeader><div className="enterprise-brand"><Building2 aria-hidden="true" /><span>{context.tenantName || (english ? "Enterprise" : "企业服务")}</span></div></SidebarHeader>
        <SidebarContent><Highlight mode="parent" controlledItems value={activePage} hover={false} click={false} containerClassName="rental-sidebar-navigation" className="rental-sidebar-route-highlight">
          <SidebarMenu>{visible.map(menu => <SidebarMenuItem key={menu.path}><HighlightItem value={menu.path} asChild><div className="rental-sidebar-route-target"><SidebarMenuButton render={<Link to={`${context.basePath}/${menu.path}`} />} isActive={activePage === menu.path} tooltip={english ? menu.en : menu.zh}>{menu.icon}<span>{english ? menu.en : menu.zh}</span></SidebarMenuButton></div></HighlightItem></SidebarMenuItem>)}</SidebarMenu>
        </Highlight></SidebarContent>
        <SidebarFooter>{context.session && <SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip={english ? "Sign out" : "退出登录"} onClick={() => void context.logout().catch(e => setLogoutError(e.message))}><LogOut aria-hidden="true" /><span>{context.session.customer.displayName}</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>}</SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-workspace min-h-0"><header className="workspace-context native-workspace-context">
        <div className="workspace-context-location"><SidebarTrigger aria-label={english ? "Toggle navigation" : "切换导航"} /><span className="enterprise-context">{context.tenantName || memberLabel}</span>{Boolean(context.entry?.corporates.length) && <Select aria-label={english ? "Current enterprise" : "当前企业"} value={context.selectedCorporateId || undefined} placeholder={english ? "Choose enterprise" : "选择企业"} options={context.entry!.corporates.map(row => ({ value: row.corporateCustomerId, label: row.corporateName }))} onChange={context.selectCorporate} />}</div>
        <div className="workspace-context-actions"><Button type="text" size="small" onClick={() => setLocale(english ? "zh-CN" : "en-US")} aria-label={english ? "切换中文" : "Switch to English"}>{english ? "中" : "EN"}</Button><AppearanceSwitcher iconOnly /></div>
      </header><main className="app-content" data-admin-content><div className="content-canvas">{logoutError && <p role="alert">{logoutError}</p>}{children}</div></main></SidebarInset>
    </SidebarProvider>
  </div></div></TooltipProvider>;
}
