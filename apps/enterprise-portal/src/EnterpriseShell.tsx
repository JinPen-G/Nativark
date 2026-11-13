/** Enterprise menu and customer identity for the shared management UI frame. */
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { EnterprisePortalAction } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { BusinessShell } from "@/components/BusinessShell";
import { NativeContextSwitcher } from "@/components/animate-sidebar/NativeContextSwitcher";
import { NativeAccountMenuView } from "@/components/animate-sidebar/NativeAccountMenuView";
import { NativeNavigation } from "@/components/animate-sidebar/NativeNavigation";
import { WorkspaceClock } from "@/components/WorkspaceClock";
import { Building2 } from "lucide-react";
import { TeamOutlined, HistoryOutlined, FileTextOutlined, FormOutlined, IdcardOutlined, GiftOutlined, SafetyCertificateOutlined, ControlOutlined, FileSearchOutlined, InboxOutlined, CalculatorOutlined } from "@/components/ui/icons";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseShell({ children }: { children: ReactNode }) {
  const { locale } = useLocale(), context = useEnterprise();
  const [logoutError, setLogoutError] = useState("");
  const english = locale === "en-US";
  const corporate = context.loading ? undefined : context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
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
    { path: "finance", zh: "企业财务", en: "Finances", icon: <CalculatorOutlined />, action: "finance:read" },
    { path: "exchange-approvals", zh: "换货审批", en: "Exchange approvals", icon: <FileSearchOutlined /> },
    { path: "extension-approvals", zh: "续租审批", en: "Extension approvals", icon: <FileSearchOutlined /> }
  ];
  const visible = menus.filter(menu => !menu.action || corporate?.actions.includes(menu.action));
  const tenantName = context.tenantName || (english ? "Enterprise" : "企业服务");
  const corporateName = corporate?.corporateName || (english ? "Choose enterprise" : "选择企业");
  const sections = [{ key: "overview", label: "", routes: visible.map(menu => ({ path: context.basePath + "/" + menu.path,
    label: english ? menu.en : menu.zh, icon: menu.icon })) }];
  return <BusinessShell fullWidth identity={JSON.stringify([context.identity, context.loading])} selectedKey={context.basePath + "/" + activePage}
    brand={<NativeContextSwitcher title={tenantName} subtitle={corporateName} brand={<Building2 aria-hidden="true" />}
      label={english ? "Current enterprise" : "当前企业"} value={context.selectedCorporateId}
      options={(context.loading ? [] : context.entry?.corporates ?? []).map(row => ({ id: row.corporateCustomerId, name: row.corporateName, icon: <Building2 aria-hidden="true" /> }))}
      onChange={context.selectCorporate} />}
    account={<NativeAccountMenuView name={context.session?.customer.displayName || (english ? "Customer account" : "客户账号")}
      account={tenantName} onSignOut={context.session ? () => context.logout() : undefined}
      onError={error => setLogoutError(error instanceof Error ? error.message : (english ? "Sign out failed" : "退出失败"))} />}
    navigation={({ query, onNavigate }) => <NativeNavigation flat sections={sections} selectedKey={context.basePath + "/" + activePage} query={query} onNavigate={onNavigate} />}
    headerContext={<span className="enterprise-context">{tenantName}{corporate && <> · {corporate.corporateName}</>}</span>}
    headerActions={<WorkspaceClock />}>
    {logoutError && <p role="alert">{logoutError}</p>}{children}
  </BusinessShell>;
}
