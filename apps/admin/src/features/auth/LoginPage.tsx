/** 原后台只供给既有登录、公开品牌与导航；所有呈现复用公共原页。 */
import { useNavigate, useParams } from "react-router-dom";
import { AdminLoginPage } from "@rental-os/platform-admin/session-pages";
import { ADMIN_BRAND_NAME } from "@/app/branding";
import { apiAssetOrigin } from "@/api/http";
import { clientChannelApi } from "@/api/clientChannel";
import { api } from "@/api/platform";
import { useAuthStore } from "./authStore";

const showShortcuts = import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === undefined
  ? import.meta.env.DEV : import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === "true";
const accounts = [
  { label: "演示香港租户管理员", tenantCode: "demo", account: "admin" },
  { label: "演示深圳租户管理员", tenantCode: "demo2", account: "admin" },
  { label: "SaaS 平台管理员", tenantCode: "platform", account: "admin" },
];
export function LoginPage() {
  const login = useAuthStore(state => state.login);
  const { tenantCode } = useParams();
  const navigate = useNavigate();
  return <AdminLoginPage brandName={ADMIN_BRAND_NAME} tenantCode={tenantCode} apiAssetOrigin={apiAssetOrigin}
    loadTenantBrand={clientChannelApi.getPublicBootstrap}
    development={showShortcuts ? { accounts, resetPassword: api.resetLocalDemoPassword } : undefined}
    onLogin={input => login(input.tenantCode, input.account, input.password)}
    onLoginSuccess={result => navigate(result.needsTenantOnboarding ? "/tenant/readiness" : result.user.isSaasAdmin ? "/platform/tenants" : "/workbench", { replace: true })} />;
}
