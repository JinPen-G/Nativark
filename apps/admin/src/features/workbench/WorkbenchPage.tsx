import { ArrowRightOutlined, ReloadOutlined } from "@/components/ui/icons";
import { RentalCoreOrderStatus, formatRentalMoney, type RentalAssetStatus, type RentalWorkbenchTodo, type RentalWorkbenchTodoType, type RentalWorkspaceReportFilter } from "@rental-os/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { AnimatedNumber } from "@/components/ui";
import { App } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { ActionButton, Button, Segmented } from "@/components/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { CircleAlert } from "lucide-react";
import { DistributionChart, InsightPanel, MetricBand, RankedFacts, ViewChoice, insightStyles as viewStyles } from "@/components/insights/OperationalCharts";

const orderStatusLabels: Record<RentalCoreOrderStatus, string> = {
  [RentalCoreOrderStatus.Draft]: "草稿",
  [RentalCoreOrderStatus.Reserved]: "已预订",
  [RentalCoreOrderStatus.PickupOverdue]: "待确认爽约",
  [RentalCoreOrderStatus.ReadyForPickup]: "待领取",
  [RentalCoreOrderStatus.Renting]: "租赁中",
  [RentalCoreOrderStatus.ReturnInspection]: "待归还检查",
  [RentalCoreOrderStatus.Settling]: "待结算",
  [RentalCoreOrderStatus.Completed]: "已关闭",
  [RentalCoreOrderStatus.Cancelled]: "已取消",
  [RentalCoreOrderStatus.NoShow]: "已爽约"
};
const activeStatuses: RentalCoreOrderStatus[] = [RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.PickupOverdue, RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.ReturnInspection, RentalCoreOrderStatus.Settling];
const assetStatusLabels: Record<RentalAssetStatus, string> = { available: "可用", reserved: "已预占", rented: "租赁中", inspection: "检查中", maintenance: "维护中", disabled: "已停用" };
const todoTypeLabels: Record<RentalWorkbenchTodoType, string> = {
  pending_payment: "待支付超时",
  no_show_notice: "待通知爽约",
  no_show_confirmation: "待确认爽约",
  return_overdue: "逾时未归还",
  fee_review: "待裁定费用",
  refund: "待办理退款",
  work_order: "养护工单",
  notification_failure: "通知失败",
  cancelled_refund_due: "取消/爽约待退款",
  offline_payment_pending: "待线下收款确认"
};

function periodStart(period: string) {
  const start = new Date();
  if (period === "今日") start.setHours(0, 0, 0, 0);
  else if (period === "本周") { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return start;
}

/**
 * 运营概览。
 *
 * 指标不再由页面拉整张订单/资产/库存表自己累加，而是读服务端经营报表
 * （`GET /rental/v1/reports/operations`）：同一口径只算一次，报表页、导出与这里
 * 显示的是同一个数。页面自己只保留待办列表（有专用接口）。
 * 报表的资产与库存口径是**读取瞬间的快照**，服务端随出参带回说明，本页必须显示。
 */
export function WorkbenchPage() {
  const [period, setPeriod] = useState("本月");
  const [todoView, setTodoView] = useState("focus");
  const [statusView, setStatusView] = useState("chart");
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { t } = useLocale();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canViewOrders = hasPermission("rental-os:order:view");
  const canViewAssets = hasPermission("rental-core:asset:view");
  const canViewWorkOrders = hasPermission("rental-core:maintenance:view");
  const canReconcilePayments = hasPermission("rental-os:finance:reconcile");
  // 指标来自经营报表接口，它要求报表查看权限；订单/资产权限只决定是否展示各自的板块与入口。
  const canViewReport = hasPermission("rental-os:report:view");
  const showMetrics = canViewReport && (canViewOrders || canViewAssets);
  const scope = useListQueryIdentity();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile, enabled: canViewOrders || canViewAssets });
  // 区间按订单起租时间归入（报表口径）。查询键与报表页同构，命中同一份缓存。
  const filter: RentalWorkspaceReportFilter = { from: periodStart(period).toISOString() };
  const report = useQuery({ queryKey: ["rental-core", "operation-report", scope, filter], queryFn: () => rentalCoreApi.operationReport(filter), enabled: showMetrics, placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === scope ? previous : undefined });
  const todos = useQuery({ queryKey: ["rental-core", "workbench-todos", scope], queryFn: rentalCoreApi.workbenchTodos });
  const reconcilePayments = useMutation({
    mutationFn: () => rentalCoreApi.reconcilePayments(),
    onSuccess: (result) => {
      if (result.failed > 0 || result.pending > 0) {
        message.warning(`已核对 ${result.processed} 笔，${result.pending} 笔仍待核对，${result.failed} 笔需要人工处理`);
      } else {
        message.success(`支付对账完成，共处理 ${result.processed} 笔`);
      }
    },
    onError: (error: Error) => message.error(error.message || "支付对账失败")
  });
  const loading = profile.isLoading || report.isLoading || todos.isLoading;
  const error = profile.error || report.error || todos.error;
  const data = report.data;
  // 币种取报表自带的快照：金额是按这个币种算出来的，不再另读一次业务设置。
  const money = (value: number) => formatRentalMoney(Number(value), data?.currency);
  const orderCount = data?.orderCount ?? 0;
  const statusRows = (data?.statusBreakdown ?? []).filter((row) => row.count > 0).map((row) => ({ ...row, name: t(orderStatusLabels[row.status] ?? row.status) }));
  const activeCount = statusRows.filter((row) => activeStatuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);
  const completedCount = statusRows.find((row) => row.status === RentalCoreOrderStatus.Completed)?.count ?? 0;
  const assets = data?.utilization.serializedAssets;
  const stock = data?.utilization.quantityStock;
  const availableAssets = assets?.statusBreakdown.find((row) => row.status === "available")?.count ?? 0;
  const availableUnits = availableAssets + (stock?.availableTotal ?? 0);
  const canOpenTodo = (item: RentalWorkbenchTodo) => canViewOrders || (item.type === "work_order" && canViewWorkOrders);

  function refresh() {
    void Promise.all([
      (canViewOrders || canViewAssets) ? profile.refetch() : Promise.resolve(),
      showMetrics ? report.refetch() : Promise.resolve(),
      todos.refetch()
    ]);
  }

  return <>
    <PageHeader title="运营概览" description={data ? t("当前经营空间") + " · " + new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined}
      view={<Segmented value={period} onChange={(value) => setPeriod(String(value))} options={["今日", "本周", "本月"].map((value) => ({ value, label: t(value) }))} />}
      extra={<Space><Button shape="circle" aria-label={t("刷新经营概览")} icon={<ReloadOutlined />} onClick={refresh} />{canReconcilePayments && <ActionButton label={t("核对支付与退款")} pending={reconcilePayments.isPending} onAction={async () => { const result = await reconcilePayments.mutateAsync(); if (result.failed > 0 || result.pending > 0) throw new Error("Reconciliation requires attention"); }} />}</Space>} />
    <QueryState loading={loading} error={error}>
      <div className={viewStyles.page}>
        {showMetrics && data ? <MetricBand items={[
          ...(canViewOrders ? [
            { label: t("期间订单"), value: orderCount, detail: t(period) + " · " + t("非草稿") },
            { label: t("应收金额"), value: money(data.receivableTotal), detail: t("调账后应收") },
            { label: t("租赁收入"), value: money(data.rentalRevenue), detail: t("只含租金") },
          ] : []),
          ...(canViewAssets ? [{ label: t("可租库存"), value: availableUnits, detail: t("独立资产 + 数量库存") + " · " + t("当前快照") }] : []),
        ]} /> : <Alert type="info" title={t("当前账号仅可查看工作台待办")} description={t("订单、库存和金额指标需要报表查看权限及相应的数据查看权限。")} />}
        <div className={viewStyles.grid}>
          <InsightPanel title={t("运营待办")} description={<><AnimatedNumber value={todos.data?.items.length ?? 0} /> {t("项待处理")}</>}
            actions={<ViewChoice value={todoView} onChange={setTodoView} options={[{ value: "focus", label: t("重点事项") }, { value: "table", label: t("明细") }]} />}>
            {todoView === "table" ? <Table<RentalWorkbenchTodo> rowKey="id" toolbarNote={false} pagination={{ pageSize: 8 }} onRefresh={() => todos.refetch()} dataSource={todos.data?.items ?? []} columns={[
              { title: t("事项"), dataIndex: "title" }, { title: t("说明"), dataIndex: "description" },
              { title: t("金额"), dataIndex: "amount", render: value => value === undefined ? "—" : money(value) },
              { title: t("操作"), render: (_, item) => canOpenTodo(item) ? <Button type="link" onClick={() => navigate(item.href)}>{t("处理")}</Button> : t("无详情权限") },
            ]} /> : <div className={viewStyles.feed}>
              {(todos.data?.items ?? []).slice(0, 5).map(item => <article className={viewStyles.feedItem} key={item.id}>
                <span className={viewStyles.feedIcon}><CircleAlert size={16} /></span><div><h3>{item.title}</h3><p>{item.description}</p><small>{t(todoTypeLabels[item.type])}{item.orderNo ? " · " + item.orderNo : ""}{item.amount === undefined ? "" : " · " + money(item.amount)}</small></div>
                {canOpenTodo(item) && <Button size="small" type="text" onClick={() => navigate(item.href)}>{t("处理")} <ArrowRightOutlined /></Button>}
              </article>)}
              {!todos.data?.items.length && <p className={viewStyles.note}>{t("当前空间没有需要处理的待办")}</p>}
              {(todos.data?.items.length ?? 0) > 5 && <Button type="text" onClick={() => setTodoView("table")}>{t("查看全部")} <AnimatedNumber value={todos.data!.items.length} /></Button>}
            </div>}
          </InsightPanel>
          {showMetrics && canViewOrders && <InsightPanel title={t("订单状态")} description={t(period) + " · " + t("非草稿")}
            actions={<ViewChoice value={statusView} onChange={setStatusView} options={[{ value: "chart", label: t("分布") }, { value: "list", label: t("明细") }]} />}>
            {statusView === "chart" ? <DistributionChart title={t("订单状态")} unit={t("单")} rows={statusRows.map(row => ({ key: row.status, label: row.name, value: row.count }))} />
              : <RankedFacts rows={statusRows.map(row => ({ id: row.status, label: row.name, value: row.count }))} empty={t("暂无订单")} />}
            <dl className={viewStyles.facts}><div><dt>{t("履约中")}</dt><dd><AnimatedNumber value={activeCount} /></dd></div><div><dt>{t("已关闭")}</dt><dd><AnimatedNumber value={completedCount} /></dd></div></dl>
          </InsightPanel>}
        </div>
        {showMetrics && data && <div className={viewStyles.equal}>
          {canViewOrders && <InsightPanel title={t("客户贡献")} description={t("按当前筛选应收金额排序")} actions={<Button type="text" size="small" onClick={() => navigate("/reports/operations")}>{t("经营报表")} <ArrowRightOutlined /></Button>}>
            <RankedFacts rows={[...data.customerBreakdown].sort((a,b) => b.receivableTotal-a.receivableTotal).slice(0,5).map((row,index) => ({ id: row.customerId ?? String(index), label: row.customerName, value: row.receivableTotal, note: row.orderCount + " " + t("单") }))} format={money} empty={t("暂无订单")} />
          </InsightPanel>}
          {canViewAssets && <InsightPanel title={t("库存状态（当前快照）")} description={t("这一节是读取瞬间的快照，不是区间利用率")} actions={<Button type="text" size="small" onClick={() => navigate("/rental/assets")}>{t("资产与库存")} <ArrowRightOutlined /></Button>}>
            <RankedFacts rows={(assets?.statusBreakdown ?? []).map(row => ({ id: row.status, label: t(assetStatusLabels[row.status] ?? row.status), value: row.count }))} empty={t("尚未建立资产或数量库存。")} />
            {stock && <dl className={viewStyles.facts}><div><dt>{t("数量库存")}</dt><dd><AnimatedNumber value={stock.onHandTotal} /></dd></div><div><dt>{t("可租余量")}</dt><dd><AnimatedNumber value={stock.availableTotal} /></dd></div><div><dt>{t("已占用")}</dt><dd><AnimatedNumber value={stock.reservedTotal} /></dd></div><div><dt>{t("维修占用")}</dt><dd><AnimatedNumber value={stock.maintenanceTotal} /></dd></div></dl>}
          </InsightPanel>}
        </div>}
      </div>
    </QueryState>
  </>;
}
