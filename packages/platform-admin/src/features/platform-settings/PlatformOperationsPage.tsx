/** SaaS 运维页组合公共页头和安全概览，沿当前参数管理权限读取。 */
import { useLocale } from "../../app/locale";
import { canManagePublicResource } from "../../application-access";
import { Result } from "../../components/ui";
import { useAdminSession } from "../../runtime";
import { PageHeader } from "./PlatformPageHeader";
import { PlatformSecurityOverview } from "./PlatformSecuritySettings";

export function PlatformOperationsPage() {
  const { t } = useLocale();
  const { user, sessionVerified } = useAdminSession();
  if (!sessionVerified || !canManagePublicResource(user, "saas", "system:params:manage"))
    return <Result status="403" title="403" />;
  return <><PageHeader title={t("平台运维中心")} /><PlatformSecurityOverview /></>;
}
