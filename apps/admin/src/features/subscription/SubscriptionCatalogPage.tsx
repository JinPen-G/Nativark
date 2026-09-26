import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FeatureOwnership, SubscriptionPlan, type StandardPlanPricing, type SubscriptionFeatureCatalogEntry } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL, RELEASE_STATUS_LABEL, formatMoney } from "./subscriptionLabels";
import { FeatureCatalogModal } from "./FeatureCatalogModal";
import { StandardPriceModal } from "./StandardPriceModal";

/**
 * SUB-03 §3.3/§5.2/§8 平台功能目录与标准价维护页（audience saas，system:tenant:subscription:manage）。
 * 读端点待后端补齐（api 层已标 TODO）；上线状态与归属分开维护，公共下放 = 当前归属选基础版。
 */
function ownershipLabel(value: FeatureOwnership, t: (v: string) => string) {
  return t(value === FeatureOwnership.Standard ? "基础版" : "PRO");
}

export function SubscriptionCatalogPage() {
  const { t } = useLocale();
  const prices = useQuery({ queryKey: ["subscription", "standard-prices"], queryFn: subscriptionApi.standardPrices });
  const catalog = useQuery({ queryKey: ["subscription", "feature-catalog"], queryFn: subscriptionApi.featureCatalog });
  const [priceModal, setPriceModal] = useState<{ open: boolean; plan: SubscriptionPlan | null; current: StandardPlanPricing | null }>({ open: false, plan: null, current: null });
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; entry: SubscriptionFeatureCatalogEntry | null }>({ open: false, entry: null });

  const priceOf = (plan: SubscriptionPlan) => prices.data?.find((row) => row.plan === plan) ?? null;

  const columns: ColumnsType<SubscriptionFeatureCatalogEntry> = [
    { title: t("功能"), key: "name", render: (_, row) => <Space orientation="vertical" size={0}><span>{row.name}</span><span className="text-meta">{row.code}</span></Space> },
    { title: t("模块"), dataIndex: "module", key: "module" },
    { title: t("适用品类"), key: "categories", render: (_, row) => row.categories.join("、") || t("—") },
    { title: t("默认归属"), dataIndex: "defaultOwnership", key: "default", render: (value: FeatureOwnership) => ownershipLabel(value, t) },
    { title: t("当前归属"), dataIndex: "currentOwnership", key: "current", render: (value: FeatureOwnership) => <Tag color={value === FeatureOwnership.Standard ? "green" : "gold"}>{ownershipLabel(value, t)}{value === FeatureOwnership.Standard ? t("（已下放）") : ""}</Tag> },
    { title: t("上线状态"), dataIndex: "releaseStatus", key: "release", render: (value: keyof typeof RELEASE_STATUS_LABEL) => t(RELEASE_STATUS_LABEL[value]) },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => setCatalogModal({ open: true, entry: row })}>{t("编辑")}</Button> }
  ];

  return (
    <PageHeader
      title="功能目录与定价"
      description="维护可销售功能目录与上线状态、公共下放归属，以及基础版 / PRO 标准年费；价格未发布显示「价格待公布」。"
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" title={t("标准套餐价")}>
            {prices.isLoading ? <LoadingState />
              : prices.error ? <Alert type="error" showIcon message={t("标准价加载失败")} description={<Button size="small" onClick={() => prices.refetch()}>{t("重试")}</Button>} />
              : <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[SubscriptionPlan.Standard, SubscriptionPlan.Pro].map((plan) => {
                  const price = priceOf(plan);
                  return {
                    key: plan,
                    label: t(PLAN_LABEL[plan]),
                    children: <Space>{price?.published ? t(formatMoney(price.annualFee, "价格待公布")) : t("价格待公布")}<Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => setPriceModal({ open: true, plan, current: price })}>{t("编辑")}</Button></Space>
                  };
                })} />}
          </Card>

          <Card size="small" title={t("功能目录")} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCatalogModal({ open: true, entry: null })}>{t("新增功能")}</Button>}>
            {catalog.isLoading ? <LoadingState />
              : catalog.error ? <Alert type="error" showIcon message={t("功能目录加载失败")} description={<Button size="small" onClick={() => catalog.refetch()}>{t("重试")}</Button>} />
              : <Table<SubscriptionFeatureCatalogEntry> rowKey="code" size="small" columns={columns} dataSource={catalog.data ?? []} pagination={{ pageSize: 20, hideOnSinglePage: true }} />}
          </Card>

          <StandardPriceModal open={priceModal.open} plan={priceModal.plan} current={priceModal.current} onClose={() => setPriceModal({ open: false, plan: null, current: null })} />
          <FeatureCatalogModal open={catalogModal.open} entry={catalogModal.entry} onClose={() => setCatalogModal({ open: false, entry: null })} />
        </Space>
      }
    />
  );
}
