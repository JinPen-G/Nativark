import { Alert, Button, Card, Descriptions, Empty, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { FeatureEntitlementSource, SubscriptionPlan, type SubscriptionFeatureEntitlement, type TenantSubscriptionView } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { ENTITLEMENT_SOURCE_LABEL, PLAN_LABEL, RELEASE_STATUS_LABEL, SERVICE_STATUS_LABEL, formatMoney } from "./subscriptionLabels";
import { PlatformSubscriptionActionForm } from "./PlatformSubscriptionActionForm";
import { TenantFeatureGrantModal } from "./TenantFeatureGrantModal";

/**
 * SUB-03 平台端「租户订阅 · 详情/办理」（§8）。概览走只读视图；直接办理表单派发写请求。
 * 额外功能授权：仍需升级的功能可「额外授权」（tenant_specific，不要求整体升级）；
 * 已额外授权的可「撤销」（须填原因）。公共下放与 PRO 自带权益随套餐/目录变化，不在此逐租户维护。
 */
const SOURCE_TONE: Partial<Record<FeatureEntitlementSource, string>> = {
  [FeatureEntitlementSource.StandardPublic]: "green",
  [FeatureEntitlementSource.TenantGrant]: "blue",
  [FeatureEntitlementSource.Pro]: "gold"
};

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
  const [grantModal, setGrantModal] = useState<{ open: boolean; mode: "grant" | "revoke"; feature: SubscriptionFeatureEntitlement | null }>({ open: false, mode: "grant", feature: null });

  const entitlementColumns: ColumnsType<SubscriptionFeatureEntitlement> = [
    { title: t("功能"), key: "name", render: (_, row) => <Space orientation="vertical" size={0}><span>{row.name}</span><span className="text-meta">{row.code}</span></Space> },
    { title: t("模块"), dataIndex: "module", key: "module" },
    { title: t("上线状态"), dataIndex: "releaseStatus", key: "release", render: (value: SubscriptionFeatureEntitlement["releaseStatus"]) => t(RELEASE_STATUS_LABEL[value]) },
    { title: t("权益来源"), dataIndex: "source", key: "source", render: (value: FeatureEntitlementSource) => <Tag color={SOURCE_TONE[value]}>{t(ENTITLEMENT_SOURCE_LABEL[value])}</Tag> },
    { title: t("可用状态"), key: "available", render: (_, row) => row.available ? <span style={{ color: "var(--rental-color-success, #389e0d)" }}>{t("已可用")}</span> : row.needsConfig ? t("需先配置") : t("未启用") },
    {
      title: t("操作"), key: "action", render: (_, row) => {
        if (row.source === FeatureEntitlementSource.TenantGrant) {
          return <Button danger type="link" style={{ paddingInline: 0 }} onClick={() => setGrantModal({ open: true, mode: "revoke", feature: row })}>{t("撤销授权")}</Button>;
        }
        if (row.source === FeatureEntitlementSource.NeedsUpgrade) {
          return <Button type="link" style={{ paddingInline: 0 }} onClick={() => setGrantModal({ open: true, mode: "grant", feature: row })}>{t("额外授权")}</Button>;
        }
        return <span className="text-meta">{t("随套餐 / 目录维护")}</span>;
      }
    }
  ];

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
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("对「仍需升级」的功能可仅为该租户额外授权，不要求整体升级；对「额外授权」来源的可撤销（须填原因）。要对所有基础版开放请在功能目录页改为公共下放。")} />
        {entitlements.length === 0
          ? <Empty description={t("功能目录接入后在此选择授权")} />
          : <Table<SubscriptionFeatureEntitlement> rowKey="code" size="small" columns={entitlementColumns} dataSource={entitlements} pagination={{ pageSize: 20, hideOnSinglePage: true }} />}
      </Card>

      <Card size="small" title={t("申请与线下收款记录")}>
        {requests.length === 0 ? <Empty description={t("暂无记录")} /> : <Descriptions column={1} size="small" colon={false} items={requests.map((row) => ({ key: row.id, label: row.id, children: t(formatMoney(row.handledAmount)) }))} />}
      </Card>

      <TenantFeatureGrantModal open={grantModal.open} mode={grantModal.mode} tenantId={tenantId} feature={grantModal.feature} onClose={() => setGrantModal({ open: false, mode: "grant", feature: null })} />
    </Space>
  );
}
