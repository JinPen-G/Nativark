import type { CustomerProfileOverview, RentalCoreOrderStatus } from "@rental-os/shared";
import { formatRentalMoney } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { useState } from "react";
import { ActionButton, AnimatedNumber, Empty, Segmented, Table } from "@/components/ui";
import { BusinessTimeline, BusinessTrend, InsightColumns, InsightMetrics, InsightSection } from "@/components/BusinessInsights";
import { detailStatusLabels } from "@/features/rental-core/orderDetailPresentation";
import { useQuery } from "@tanstack/react-query";
import { customerApi } from "@/api/customer";
import { QueryState } from "@/components/QueryState";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";

export function CustomerAnalysisReader({ customerId }: { customerId: string }) {
  const scope = useListQueryIdentity();
  const overview = useQuery({ queryKey: ["customer-profile-overview", customerId, scope, "analysis"], queryFn: () => customerApi.profileOverview(customerId, { pageSize: 1 }), meta: { liveRefresh: false } });
  return <QueryState transitionKey={`${customerId}:${scope}`} loading={overview.isLoading} error={overview.error} onRetry={() => overview.refetch({ throwOnError: true })}>{overview.data && <CustomerAnalysis key={customerId} overview={overview.data} onRefresh={() => overview.refetch({ throwOnError: true })} />}</QueryState>;
}

export function CustomerAnalysis({ overview, onRefresh }: { overview: CustomerProfileOverview; onRefresh?: () => Promise<unknown> }) {
  const { t } = useLocale();
  const [period, setPeriod] = useState("6");
  const data = overview.insights;
  if (!data) return <Empty compact description={t("客户分析暂不可用，请刷新后重试。")}>{onRefresh && <ActionButton variant="secondary" label={t("刷新")} onAction={onRefresh} />}</Empty>;
  const current = data.months.at(-1)?.orders ?? 0;
  const prior = data.months.at(-2)?.orders ?? 0;
  const rows = data.months.slice(-Number(period));
  const events = overview.statusHistory.slice(0, 6);
  return <>
    <InsightMetrics items={[{ label: t("关联订单"), value: data.totalOrders }, { label: t("履约中"), value: data.activeOrders }, { label: t("已关闭"), value: data.completedOrders }, { label: t("本月新增订单"), value: current }]} />
    <InsightColumns><InsightSection title={t("租赁活跃趋势")} description={t("当前经营空间的非草稿关联订单，按创建时间统计；当月尚未结束。") }>
      <Segmented value={period} onChange={value => setPeriod(String(value))} options={[{ value: "6", label: t("近 6 个月") }, { value: "12", label: t("近 12 个月") }]} />
      <BusinessTrend data={rows.map(row => ({ month: row.month, value: row.orders }))} label={t("新增订单")} unit={t("单")} />
      <p>{t("上月")} <AnimatedNumber value={prior} /> {t("单")} · {prior > 0 ? <><AnimatedNumber value={(current - prior) / prior * 100} decimals={1} suffix="%" /> {t("较上月变化（当月累计）")}</> : t("上月无订单，不计算增长率")}</p>
    </InsightSection><InsightSection title={t("客户动态")} description={t("会员状态的真实变更记录")}>
      <BusinessTimeline items={events.map(row => ({ id: row.id, at: row.at, title: t(({ activate: "激活", suspend: "暂停", restrict: "风险限制", close: "注销", exit: "退出", reopen: "重新激活", resume: "恢复" } as Record<string, string>)[row.action] ?? row.action), detail: row.reason }))} empty={t("暂无状态变更记录")} />
    </InsightSection></InsightColumns>
    <InsightColumns><InsightSection title={t("订单状态分布")}>
      <Table rowKey="status" onRefresh={null} pagination={false} dataSource={data.statusBreakdown} columns={[{ title: t("状态"), dataIndex: "status", render: (value: string) => t(detailStatusLabels[value as RentalCoreOrderStatus] ?? value) }, { title: t("订单数"), dataIndex: "count", render: value => <AnimatedNumber value={value} /> }]} />
    </InsightSection><InsightSection title={t("订单应付汇总")} description={t("按订单应付事实及币种分别汇总，不含草稿、取消与爽约订单；不代表实收收入。") }>
      <Table rowKey="currency" onRefresh={null} pagination={false} dataSource={data.amounts} columns={[{ title: t("币种"), dataIndex: "currency" }, { title: t("订单数"), dataIndex: "orders", render: value => <AnimatedNumber value={value} /> }, { title: t("应付金额"), dataIndex: "payableAmount", render: (value, row) => formatRentalMoney(value, row.currency) }]} />
    </InsightSection></InsightColumns>
  </>;
}
