import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConfigProvider, App as AntApp } from "antd";
import { Provider as AntMotionProvider } from "@rc-component/motion";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";
import { EnterpriseApplicationPage, EnterpriseJoinPage, EnterpriseInvitesPage, EnterpriseJoinReviewPage } from "./WorkflowPages";
import { EnterprisePolicyPage } from "./PolicyPage";
import { EnterpriseManagementRequestsPage } from "./ManagementRequestsPage";
import { EnterpriseApprovalsPage } from "./ApprovalsPage";
import { EnterpriseOrdersPage } from "./OrdersPage";
import { EnterpriseFinancePage } from "./FinancePage";
import { EnterpriseExchangeApprovalsPage } from "./ExchangeApprovalsPage";
import { EnterpriseExtensionApprovalsPage } from "./ExtensionApprovalsPage";
import { EnterpriseMemberLifecycle } from "./MemberLifecycle";
import { EnterpriseAdministratorEditor } from "./AdministratorEditor";
import { EnterpriseOwnRecordsPage, EnterpriseTasksPage } from "./TasksPage";
import { LocaleProvider, useLocale } from "@/app/locale";
import { AppearanceProvider, createThemeConfig, useAppearance } from "@/app/theme";
import { applyAdminRadiusTokens } from "@/app/designTokens";
import { applyArcThemeTokens } from "@/app/arcTokens";
import { MotionPreferenceProvider } from "@/app/MotionPreferenceProvider";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { BusinessUiScopeProvider } from "@/components/ui/BusinessUiScope";
import { Button, Form, Input, Alert, EmptyScene, SaveButton, Select, Table, DataTableStatus, FeedbackProvider } from "@/components/ui/customer-entry";
import { LoadingState } from "@/components/LoadingState";
import { PageHeading } from "@/components/PageHeading";
import { TeamOutlined, HistoryOutlined, FileTextOutlined, FormOutlined, IdcardOutlined, GiftOutlined, SafetyCertificateOutlined, ControlOutlined, FileSearchOutlined, InboxOutlined, CalculatorOutlined } from "@/components/ui/icons";
import type { EnterpriseMembersResponse } from "@rental-os/shared";
import { customerLogin, parseEnterpriseRoute } from "@rental-os/web-client";
import { CLIENT_BASE, EnterpriseSessionProvider, useEnterprise } from "./enterprise-session";
import { EnterpriseShell } from "./EnterpriseShell";
const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
function EnterprisePage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US", location = useLocation();
  const pagePath = location.pathname.slice(context.basePath.length).replace(/^\//, "");
  const workflow = pagePath === "profile" ? <EnterpriseManagementRequestsPage /> : pagePath === "tasks" ? <EnterpriseTasksPage /> : pagePath === "records" ? <EnterpriseOwnRecordsPage /> : pagePath === "applications" ? <EnterpriseApplicationPage /> : pagePath === "join" ? <EnterpriseJoinPage /> : pagePath === "invites" ? <EnterpriseInvitesPage /> : pagePath === "join-requests" ? <EnterpriseJoinReviewPage /> : pagePath === "policy" ? <EnterprisePolicyPage /> : pagePath === "approvals" ? <EnterpriseApprovalsPage /> : pagePath === "orders" ? <EnterpriseOrdersPage key={context.identity} /> : pagePath === "finance" ? <EnterpriseFinancePage key={context.identity} /> : pagePath === "exchange-approvals" ? <EnterpriseExchangeApprovalsPage /> : pagePath === "extension-approvals" ? <EnterpriseExtensionApprovalsPage /> : null;
  const pageTitle = pagePath === "profile" ? english ? "Enterprise profile and requests" : "企业资料与申请" : pagePath === "tasks" ? english ? "Enterprise tasks" : "企业待办" : pagePath === "applications" ? "企业申请" : pagePath === "join" ? "加入企业" : pagePath === "invites" ? "邀请管理" : pagePath === "join-requests" ? "加入审核" : pagePath === "policy" ? "使用政策" : pagePath === "approvals" ? "预约审批" : pagePath === "exchange-approvals" ? english ? "Exchange approvals" : "换货审批" : pagePath === "extension-approvals" ? english ? "Extension approvals" : "续租审批" : pagePath === "orders" ? english ? "Enterprise orders" : "企业订单" : pagePath === "finance" ? english ? "Enterprise finances" : "企业财务" : pagePath === "records" ? english ? "Enterprise records" : "企业记录" : english ? "Enterprise members" : "企业成员";
  const pageIcons: Record<string, React.ReactNode> = { profile: <FileTextOutlined />, tasks: <InboxOutlined />, records: <HistoryOutlined />, applications: <FormOutlined />, join: <IdcardOutlined />, invites: <GiftOutlined />, "join-requests": <SafetyCertificateOutlined />, policy: <ControlOutlined />, approvals: <FileSearchOutlined />, "exchange-approvals": <FileSearchOutlined />, "extension-approvals": <FileSearchOutlined />, orders: <FileSearchOutlined />, finance: <CalculatorOutlined /> };
  const selected = context.selectedCorporateId, [page, setPage] = useState(1);
  const corporate = context.entry?.corporates.find(c => c.corporateCustomerId === selected);
  useEffect(() => { setPage(1); }, [context.identity]);
  const members = useQuery({ queryKey: ["enterprise-members", context.identity, selected, page], enabled: Boolean(corporate?.actions.includes("members:read")),
    queryFn: ({ signal }) => context.read<EnterpriseMembersResponse>(`/enterprise/corporates/${encodeURIComponent(selected)}/members?tenantCode=${encodeURIComponent(context.tenantCode)}&page=${page}`, AbortSignal.any([signal, context.signal])) });
  return <><PageHeading title={pageTitle} brandName={context.tenantName || (english ? "Enterprise" : "企业服务")} icon={pageIcons[pagePath] ?? <TeamOutlined />} />
    {context.loading ? <LoadingState /> : context.error ? <Alert type="error" showIcon title={context.error === "enterprise_offline" ? english ? "Enterprise service is not connected. This view verifies the interface only; sign-in and business data are unavailable." : "未连接企业服务；当前仅检查界面，不提供登录或企业数据" : context.error} action={<Button onClick={context.reload}>{english ? "Retry" : "重新读取"}</Button>} />
      : !context.session ? <CustomerLogin /> : workflow ? workflow : context.entry?.state !== "ready" ? <section><EmptyScene scene="empty" title={english ? "No enterprise management access" : "尚无企业管理资格"} description={english ? "Contact this merchant to verify and activate your enterprise access. Personal rentals stay separate." : "请联系当前商户核验并开通企业管理资格；个人租赁不受此入口影响。"} />
        {Boolean(context.entry?.ownRelations.length) && <><h2>{english ? "Your enterprise relationships" : "本人企业关系"}</h2><ul>{context.entry!.ownRelations.map(relation => <li key={relation.corporateCustomerId}>{relation.corporateName} — {relation.role === "admin" ? english ? "Administrator relationship; portal access checked separately" : "管理员关系；门户授权另行核验" : english ? "Employee" : "员工"}</li>)}</ul></>}
        <p><a href={`${context.basePath}/applications`}>{english ? "Apply for enterprise membership" : "申请企业会员"}</a> · <a href={`${context.basePath}/join`}>{english ? "Use an invitation" : "通过邀请加入"}</a></p></section>
      : <>
        {corporate ? !corporate.actions.includes("members:read") ? <Alert type="warning" title={english ? "Member viewing is not granted" : "尚未授予成员查看权限"} />
          : members.error ? <Alert type="error" title={members.error instanceof Error ? members.error.message : "读取失败"} action={<Button onClick={() => void members.refetch()}>{english ? "Retry" : "重试"}</Button>} />
          : <Table rowKey="membershipId" caption={corporate.corporateName} dataSource={members.data?.items ?? []} loading={members.isFetching} sorting={false} onRefresh={() => members.refetch()}
            pagination={{ current: page, pageSize: members.data?.pageSize ?? 20, total: members.data?.total ?? 0, showSizeChanger: false, onChange: next => setPage(next) }}
            columns={[{ title: english ? "Name" : "姓名", dataIndex: "displayName" }, { title: english ? "Role" : "角色", dataIndex: "role", render: (role: string) => role === "admin" ? english ? "Administrator" : "管理员" : english ? "Employee" : "员工" },
              { title: english ? "Department" : "部门", dataIndex: "department" }, { title: english ? "Employee number" : "工号", dataIndex: "employeeNo" },
              { title: english ? "Status" : "关系状态", dataIndex: "status", render: (status: string) => <DataTableStatus tone={status === "active" ? "success" : "neutral"} >{status === "active" ? english ? "Active" : "有效" : status}</DataTableStatus> },
              { title: english ? "Actions" : "操作", key: "actions", render: (_, member) => <><EnterpriseMemberLifecycle member={member} english={english} refresh={async () => { await members.refetch({ throwOnError: true }); }} /><EnterpriseAdministratorEditor member={member} english={english} refresh={async () => { await members.refetch({ throwOnError: true }); }} /></> }]} />
          : <p>{english ? "Choose the enterprise you manage." : "请选择当前管理的企业。"}</p>}
      </>}
  </>;
}
function CustomerLogin() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [form] = Form.useForm<{ loginIdentifier: string; password: string }>(), [error, setError] = useState("");
  const target = parseEnterpriseRoute(window.location.pathname)?.basePath === context.basePath ? window.location.pathname : context.basePath;
  const register = `/login?${new URLSearchParams({ ...(context.domainBound ? {} : { tenantCode: context.tenantCode }), redirect: target })}`;
  const invitation = target === `${context.basePath}/join`;
  return <section className="enterprise-login"><h2>{english ? "Sign in with your customer account" : "使用个人客户账号登录"}</h2>
    <p>{english ? "Enterprise access is checked after sign-in." : "登录当前商户后，单独核验企业管理资格。"}</p>
    {invitation && <Alert type="info" title={english ? "This invitation only permits a request to join" : "本邀请仅提供加入申请资格"}
      description={english ? "Sign in or register with this merchant, then read the enterprise and notice details. Joining requires your confirmation and administrator review; this link is not login, management or payment authority." : "先登录或注册当前商户，再核对企业与正式告知。须本人确认并经管理员审核；链接不是登录、管理或企业付款授权。"} />}
    <Form form={form} layout="vertical">
      <Form.Item name="loginIdentifier" label={english ? "Phone" : "手机号"} rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item name="password" label={english ? "Password" : "密码"} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
      {error && <Alert type="error" title={error} />}
      <SaveButton<{ loginIdentifier: string; password: string }> form={form} label={english ? "Sign in" : "登录"} intent="forward" onSave={async values => { setError(""); try { await customerLogin(context.tenantCode, CLIENT_BASE, "/auth/login", { tenantCode: context.tenantCode, ...values }); } catch (e) { setError(e instanceof Error ? e.message : "登录失败"); throw e; } }} />
      <p><a href={register}>{english ? "Register or use a verification code" : "注册或使用验证码登录"}</a></p>
    </Form>
  </section>;
}
function View() {
  const { mode } = useAppearance(), reduced = usePrefersReducedMotion();
  const context = useEnterprise(); const identity = useRef(context.identity); identity.current = context.identity;
  useLayoutEffect(() => { applyAdminRadiusTokens(document.documentElement, {}); applyArcThemeTokens(document.documentElement, mode === "dark"); }, [mode]);
  useEffect(() => { void queries.cancelQueries(); queries.clear(); }, [context.identity]);
  return <ConfigProvider theme={createThemeConfig(mode)}><AntMotionProvider motion={!reduced}><AntApp><FeedbackProvider><BusinessUiScopeProvider value={{ identity: context.identity, currentIdentity: () => identity.current }}>
    <EnterpriseShell><EnterprisePage /></EnterpriseShell>
  </BusinessUiScopeProvider></FeedbackProvider></AntApp></AntMotionProvider></ConfigProvider>;
}
const router = createBrowserRouter([{ path: "*", element: <View />, errorElement: <p role="alert">企业页面无法打开，请重新进入当前商户企业服务。</p> }]);
export function App() {
  return <MotionPreferenceProvider><LocaleProvider><AppearanceProvider><QueryClientProvider client={queries}><EnterpriseSessionProvider><RouterProvider router={router} /></EnterpriseSessionProvider></QueryClientProvider></AppearanceProvider></LocaleProvider></MotionPreferenceProvider>;
}
