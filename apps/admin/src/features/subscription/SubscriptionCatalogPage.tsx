import { DataTableText, ListFilters, useListFilter } from "@/components/ui";
import { PlusOutlined } from "@/components/ui/icons";
import { Space, Tag } from "antd";
import { ListSection, Alert, Table, Tabs } from "@/components/ui";
import { Button } from "@/components/ui";
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
import { PlanComparison } from "./plan-comparison/PlanComparison";
import { QueryState } from "@/components/QueryState";
import { useSubscriptionCategoryLabels } from "./useSubscriptionCategoryLabels";

function ownershipLabel(value: FeatureOwnership, t: (v: string) => string) {
  return t(value === FeatureOwnership.Standard ? "基础版" : "PRO");
}

export function SubscriptionCatalogPage() {
  const { t } = useLocale();
  const prices = useQuery({ queryKey: ["subscription", "standard-prices"], queryFn: subscriptionApi.standardPrices });
  const catalog = useQuery({ queryKey: ["subscription", "feature-catalog"], queryFn: subscriptionApi.featureCatalog });
  const featureFilter = useListFilter(catalog.data, { fields: row => [row.name, row.code, row.module] });
  const [priceModal, setPriceModal] = useState<{ open: boolean; plan: SubscriptionPlan | null; current: StandardPlanPricing | null }>({ open: false, plan: null, current: null });
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; entry: SubscriptionFeatureCatalogEntry | null }>({ open: false, entry: null });

  const priceOf = (plan: SubscriptionPlan) => prices.data?.find((row) => row.plan === plan) ?? null;
  const categoryLabels = useSubscriptionCategoryLabels();

  const columns: ColumnsType<SubscriptionFeatureCatalogEntry> = [
    { title: t("功能"), key: "name", render: (_, row) => <DataTableText primary={row.name} secondary={row.code} /> },
    { title: t("模块"), dataIndex: "module", key: "module" },
    { title: t("适用品类"), key: "categories", render: (_, row) => row.categories.map(code => categoryLabels.label(code)).join("、") || t("—") },
    { title: t("默认归属"), dataIndex: "defaultOwnership", key: "default", render: (value: FeatureOwnership) => ownershipLabel(value, t) },
    { title: t("当前归属"), dataIndex: "currentOwnership", key: "current", render: (value: FeatureOwnership, row) => <Tag color={value === FeatureOwnership.Standard ? "green" : "gold"}>{ownershipLabel(value, t)}{value === FeatureOwnership.Standard && row.defaultOwnership !== FeatureOwnership.Standard ? t("（已下放）") : ""}</Tag> },
    { title: t("上线状态"), dataIndex: "releaseStatus", key: "release", render: (value: keyof typeof RELEASE_STATUS_LABEL) => t(RELEASE_STATUS_LABEL[value]) },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => setCatalogModal({ open: true, entry: row })}>{t("编辑")}</Button> }
  ];

  return (
    <PageHeader
      title="功能目录与定价"
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Tabs aria-label={t("功能目录与定价")} destroyOnHidden={false} items={[
            { key: "comparison", label: t("版本对比"), children: <QueryState loading={prices.isLoading || catalog.isLoading} error={prices.error || catalog.error} onRetry={() => Promise.all([prices.refetch(), catalog.refetch()])}>
              {prices.data && catalog.data && <PlanComparison features={catalog.data} prices={prices.data} actionLabel={() => t("设置标准年费")} onAction={plan => setPriceModal({ open: true, plan, current: priceOf(plan) })} />}
            </QueryState> },
            { key: "prices", label: t("标准年费"), children: <ListSection>
            {prices.isLoading ? <LoadingState />
              : prices.error ? <Alert type="error" showIcon message={t("标准价加载失败")} description={<Button size="small" onClick={() => prices.refetch()}>{t("重试")}</Button>} />
              : <Table rowKey="plan" pagination={false} onRefresh={() => prices.refetch()} dataSource={[SubscriptionPlan.Standard, SubscriptionPlan.Pro].map(plan => ({ plan, price: priceOf(plan) }))} columns={[
                { title: t("版本"), render: (_, row) => t(PLAN_LABEL[row.plan]) },
                { title: t("标准年费"), render: (_, row) => row.price?.published ? t(formatMoney(row.price.annualFee, "价格待公布")) : t("价格待公布") },
                { title: t("价格版本"), render: (_, row) => row.price?.priceVersion || "—" },
                { title: t("状态"), render: (_, row) => <Tag color={row.price?.published ? "success" : "default"}>{t(row.price?.published ? "已发布" : "未发布")}</Tag> },
                { title: t("操作"), render: (_, row) => <Button type="text" size="small" onClick={() => setPriceModal({ open: true, plan: row.plan, current: row.price })}>{t("编辑")}</Button> },
              ]} />}
          </ListSection> },
          { key: "catalog", label: t("功能目录"), children: <>

          <ListSection title={t("功能目录")} controls={<ListFilters filter={featureFilter} placeholder="功能、模块或编码" />} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCatalogModal({ open: true, entry: null })}>{t("新增功能")}</Button>}>
            {catalog.isLoading ? <LoadingState />
              : catalog.error ? <Alert type="error" showIcon message={t("功能目录加载失败")} description={<Button size="small" onClick={() => catalog.refetch()}>{t("重试")}</Button>} />
              : <Table<SubscriptionFeatureCatalogEntry> rowKey="code" size="small" columns={columns} onRefresh={() => catalog.refetch()} loading={catalog.isLoading} refreshing={catalog.isFetching} dataSource={featureFilter.rows} pagination={featureFilter.pagination} />}
          </ListSection>

          </> }
          ]} />

          {priceModal.open && <StandardPriceModal open plan={priceModal.plan} current={priceModal.current} onClose={() => setPriceModal({ open: false, plan: null, current: null })} />}
          {catalogModal.open && <FeatureCatalogModal open entry={catalogModal.entry} onClose={() => setCatalogModal({ open: false, entry: null })} />}
        </Space>
      }
    />
  );
}
