/** SaaS parameters use the authorized platform security endpoint; tenant rules and account APIs are separate domains. */
import { useNavigate } from "react-router-dom";
import { useLocale } from "../../app/locale";

import { PageHeader } from "./PlatformPageHeader";
import { Button } from "../../components/ui";
import { useAdminSession } from "../../runtime";
import { canManagePublicResource } from "../../application-access";
import { PlatformSecuritySettings } from "./PlatformSecuritySettings";

export function PlatformSystemPage({ platformAiAvailable = true }: { platformAiAvailable?: boolean }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { user, sessionVerified } = useAdminSession();
  const canReadAi = platformAiAvailable && sessionVerified && canManagePublicResource(user, "saas", "system:ai-provider:view");
  return <>
    <PageHeader title={t("平台参数")} summary={t("全平台的登录保护、密码策略与敏感信息设置")} tools={canReadAi && <Button onClick={() => navigate("/platform/ai")}>{t("平台 AI 配置")}</Button>} />
    <PlatformSecuritySettings />
  </>;
}
