/** SaaS parameters use the authorized platform security endpoint; tenant rules and account APIs are separate domains. */
import { useNavigate } from "react-router-dom";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { PlatformSecuritySettings } from "./PlatformSecuritySettings";

export function PlatformSystemPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canReadAi = useAuthStore(state => state.hasPermission("system:ai-provider:view"));
  return <>
    <PageHeader title={t("平台参数")} summary={t("全平台的登录保护、密码策略与敏感信息设置")} extra={canReadAi && <Button onClick={() => navigate(APP_ROUTES.platformAi.path)}>{t("平台 AI 配置")}</Button>} />
    <PlatformSecuritySettings />
  </>;
}
