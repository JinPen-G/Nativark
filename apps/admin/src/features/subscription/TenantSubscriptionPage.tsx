import { Alert, Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { subscriptionApi } from "@/api/subscription";
import { TenantSubscriptionBody } from "./TenantSubscriptionBody";

/**
 * SUB-02 租户后台「版本与订阅」页（需求 §5）。
 *
 * 数据走 SUB-01 只读聚合视图 TenantSubscriptionView（加载/错误/空态已接）；
 * 写动作（升级/续费/降级/申请）待 SUB-03 写契约，当前按 :manage 门禁禁用。
 */
const DESC = "当前租户全部适用经营空间共用同一版本、有效期与套餐；切换经营空间不影响本页。";

export function TenantSubscriptionPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  const userId = useAuthStore((state) => state.user?.id);
  const query = useQuery({ queryKey: ["subscription", "tenant-view", tenantId, userId], queryFn: subscriptionApi.tenantView, enabled: Boolean(tenantId && userId) });

  if (query.isLoading) return <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>;
  if (query.error || !query.data) {
    return (
      <PageHeader
        title="版本与订阅"
        description={DESC}
        extra={<Button onClick={() => query.refetch()}>{t("重试")}</Button>}
        view={<Alert type="error" showIcon message={t("订阅信息加载失败")} description={t("请稍后重试；订阅数据服务未就绪时也会出现此提示。")} />}
      />
    );
  }
  return (
    <PageHeader
      title="版本与订阅"
      description={DESC}
      note={{ title: "关于版本与订阅", description: "统一到期时间与权益由平台办理；金额与到期限制以平台确认为准，价格未发布显示「价格待公布」。" }}
      view={<TenantSubscriptionBody data={query.data} canManage={canManage} navigate={navigate} />}
    />
  );
}
