import { useAdminSession } from "../../runtime";
import { hasSubscriptionPermission } from "./subscription-access";
import { Alert } from "../../components/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "./SubscriptionPageHeader";
import { QueryState } from "../../components/QueryState";
import { useLocale } from "../../app/locale";
import { useSubscriptionApi } from "./client";
import { TenantSubscriptionBody } from "./TenantSubscriptionBody";
import { TableRefreshProvider } from "../../components/ui";

/**
 * SUB-02 租户后台「版本与订阅」页（需求 §5）。
 *
 * 数据走 SUB-01 只读聚合视图 TenantSubscriptionView（加载/错误/空态已接）；
 * 租户只提交申请；实际套餐与期限仍由平台办理，沿原权限和申请接口。
 */
export function TenantSubscriptionPage({ description = "所有业务 Core 共用同一订阅。" }: { description?: string } = {}) {
  const { tenant, user, sessionVerified } = useAdminSession();
  const subscriptionApi = useSubscriptionApi();
  const { t } = useLocale();
  const navigate = useNavigate();
  const canManage = hasSubscriptionPermission(user, "rental-os:subscription:manage");
  const tenantId = tenant?.tenantId;
  const userId = user?.id;
  const query = useQuery({ queryKey: ["subscription", "tenant-view", tenantId, userId], queryFn: subscriptionApi.tenantView, enabled: sessionVerified && Boolean(tenantId && userId) });

  return (
    <PageHeader
      title="版本与订阅"
      description={t(description)}
      note={{ title: "关于版本与订阅", description: "统一到期时间与权益由平台办理；金额与到期限制以平台确认为准，价格未发布显示「价格待公布」。" }}
      view={<QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch({ throwOnError: true })}>
        {query.data ? <TableRefreshProvider onRefresh={() => query.refetch()} busy={query.isFetching}><TenantSubscriptionBody data={query.data} canManage={canManage} navigate={navigate} /></TableRefreshProvider>
          : <Alert type="error" showIcon title={t("订阅信息加载失败")} />}
      </QueryState>}
    />
  );
}
