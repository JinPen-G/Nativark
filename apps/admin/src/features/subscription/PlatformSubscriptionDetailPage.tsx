import { Alert, Button, Card, Descriptions, Empty, Space, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { SubscriptionPlan, type TenantSubscriptionView } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL, SERVICE_STATUS_LABEL, formatMoney } from "./subscriptionLabels";
import { PlatformSubscriptionActionForm } from "./PlatformSubscriptionActionForm";

/**
 * SUB-03 平台端「租户订阅 · 详情/办理」（§8）。概览走只读视图；直接办理表单派发写请求。
 * 额外功能授权（grant/revoke）与目录/标准价维护接口已在 api 层就绪，逐项授权 UI 为后续切片。
 */
export function PlatformSubscriptionDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["subscription", "platform-detail", id], queryFn: () => subscriptionApi.platformDetail(id), enabled: Boolean(id) });

  const back = <Button onClick={() => navigate(APP_ROUTES.platformSubscriptions.path)}>{t("返回列表")}</Button>;
  if (query.isLoading) return <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>;
  if (query.error || !query.data) {
    return <PageHeader title="租户订阅详情" description="查看并直接办理该租户的订阅。" extra={back}
      view={<Alert type="error" showIcon message={t("租户订阅详情加载失败")} description={<Button size="small" onClick={() => query.refetch()}>{t("重试")}</Button>} />} />;
  }
  return <PageHeader title="租户订阅详情" description="查看并直接办理该租户的订阅：开通 / 升级 / 续期 / 临时延长 / 下期降级，以及公共下放与单租户额外授权。" extra={back}
    view={<DetailBody data={query.data} tenantId={id} />} />;
}

function DetailBody({ data, tenantId }: { data: TenantSubscriptionView; tenantId: string }) {
  const { t } = useLocale();
  const { overview, entitlements, requests } = data;
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small" title={`${t("当前套餐与期限")}（${overview.tenantName}）`}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[
          { key: "plan", label: t("当前套餐"), children: <Tag color={overview.plan === SubscriptionPlan.Pro ? "gold" : "default"}>{t(PLAN_LABEL[overview.plan])}</Tag> },
          { key: "status", label: t("服务状态"), children: t(SERVICE_STATUS_LABEL[overview.serviceStatus]) },
          { key: "period", label: t("统一起止"), children: overview.endAt ? `${overview.startAt ?? ""} ~ ${overview.endAt}${overview.timeZone ? `（${overview.timeZone}）` : ""}` : t("待平台确认") },
          { key: "amount", label: t("本期确认金额"), children: t(formatMoney(overview.currentAmount)) },
          { key: "next", label: t("待生效套餐"), children: overview.next ? `${t(PLAN_LABEL[overview.next.plan])}${overview.next.effectiveAt ? `（${overview.next.effectiveAt}）` : ""}` : t("无") }
        ]} />
      </Card>

      <Card size="small" title={t("直接办理")}>
        <PlatformSubscriptionActionForm tenantId={tenantId} />
      </Card>

      <Card size="small" title={t("额外功能授权")}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("可在功能目录「公共下放基础版」，或在此仅为该租户额外授权；保存前显示影响范围，不要求整体升级。逐项授权按钮为后续切片。")} />
        {entitlements.length === 0 ? <Empty description={t("功能目录接入后在此选择授权")} /> : (
          <Descriptions column={1} size="small" colon={false} items={entitlements.map((feature) => ({ key: feature.code, label: feature.name, children: feature.available ? t("已授权") : t("未授权") }))} />
        )}
      </Card>

      <Card size="small" title={t("申请与线下收款记录")}>
        {requests.length === 0 ? <Empty description={t("暂无记录")} /> : <Descriptions column={1} size="small" colon={false} items={requests.map((row) => ({ key: row.id, label: row.id, children: t(formatMoney(row.handledAmount)) }))} />}
      </Card>
    </Space>
  );
}
