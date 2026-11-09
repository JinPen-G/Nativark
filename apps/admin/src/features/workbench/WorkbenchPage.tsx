/** Tenant operations overview. Uses the existing report/todo APIs and their scope;
 * local exploration cannot settle money, alter inventory, or execute a todo. */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, RotateCw } from "lucide-react";
import { formatRentalMoney, type RentalWorkbenchTodo, type RentalWorkspaceReportFilter } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { APP_ROUTES } from "@/app/navigation";
import { useLocale } from "@/app/locale";
import { ADMIN_INSIGHT_METRICS } from "@/app/designTokens";
import { useAuthStore } from "@/features/auth/authStore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ActionButton, Alert, AnimatedNumber, App, Button, DonutChart, Segmented } from "@/components/ui";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { InventoryOverview } from "@/components/insights/InventoryOverview";
import { SplitBar } from "@/components/insights/split-bar/SplitBar";
import { retainedHiddenSegments } from "@/components/insights/chartVisibility";
import { InsightPanel, RankedFacts, ViewChoice } from "@/components/insights/OperationalCharts";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { orderStatusChartColor } from "@/features/rental-core/orderStatusSemantics";
import { WorkbenchMetrics } from "./WorkbenchMetrics";
import { WorkbenchTodoQueue } from "./WorkbenchTodoQueue";
import { overviewOrderFacts, overviewOrderLabels, overviewPeriodLabels, overviewPeriodStart, overviewTodoTarget, type OverviewPeriod } from "./workbenchPresentation";
import viewStyles from "@/components/insights/OperationalCharts.module.css";
import styles from "./WorkbenchOverview.module.css";

export function WorkbenchPage() {
  const scope = useListQueryIdentity();
  return <WorkbenchContent key={scope} scope={scope} />;
}

function WorkbenchContent({ scope }: { scope: string }) {
  const [period, setPeriod] = useState<OverviewPeriod>("month");
  const [statusView, setStatusView] = useState("chart");
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<readonly string[]>([]);
  const [locationId, setLocationId] = useState<string>();
  const resolvedPeriod = useRef(period);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const hasPermission = useAuthStore(state => state.hasPermission);
  const canViewOrders = hasPermission("rental-os:order:view");
  const canViewAssets = hasPermission("rental-core:asset:view");
  const canViewWorkOrders = hasPermission("rental-core:maintenance:view");
  const canReconcilePayments = hasPermission("rental-os:finance:reconcile");
  const showMetrics = hasPermission("rental-os:report:view") && (canViewOrders || canViewAssets);
  const filter: RentalWorkspaceReportFilter = { from: overviewPeriodStart(period) };
  const report = useQuery({ queryKey: ["rental-core", "operation-report", scope, filter], queryFn: () => rentalCoreApi.operationReport(filter), enabled: showMetrics,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === scope ? previous : undefined });
  const todos = useQuery({ queryKey: ["rental-core", "workbench-todos", scope], queryFn: rentalCoreApi.workbenchTodos });
  const reconcilePayments = useMutation({
    mutationFn: () => rentalCoreApi.reconcilePayments(),
    onSuccess: result => {
      if (result.failed > 0 || result.pending > 0) message.warning(t("已核对 {processed} 笔，{pending} 笔仍待核对，{failed} 笔需要人工处理", { processed: result.processed, pending: result.pending, failed: result.failed }));
      else message.success(t("支付对账完成，共处理 {processed} 笔", { processed: result.processed }));
    },
    onError: (error: Error) => message.error(error.message || t("支付对账失败")),
  });
  // Never display stale report money as a successful read after an error.
  const data = report.isError ? undefined : report.data;
  const money = (value: number) => data?.currency ? formatRentalMoney(value, data.currency)
    : t("{amount}（币种未提供）", { amount: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) });
  if (data && !report.isPlaceholderData) resolvedPeriod.current = period;
  const periodLabel = t(overviewPeriodLabels[report.isPlaceholderData ? resolvedPeriod.current : period]);
  const statusRows = (data?.statusBreakdown ?? []).filter(row => row.count > 0).map(row => ({ ...row, name: t(overviewOrderLabels[row.status] ?? row.status) }));
  const statusSegments = statusRows.map(row => ({ id: row.status, label: row.name, value: row.count, color: orderStatusChartColor(row.status) }));
  const visibleSelection = retainedHiddenSegments(statusSegments, hiddenStatuses);
  const status = statusRows.find(row => row.status === activeStatus);
  const facts = data ? overviewOrderFacts(data) : undefined;
  const locations = [...(data?.locationBreakdown ?? [])].sort((a, b) => b.receivableTotal - a.receivableTotal);
  const selectedLocation = locations.find(row => row.locationId === locationId) ?? locations[0];
  const access = { orders: canViewOrders, workOrders: canViewWorkOrders };
  const openTodo = (item: RentalWorkbenchTodo) => {
    if (todos.isFetching || todos.isError) return;
    const target = overviewTodoTarget(item, access);
    if (target) navigate(target.route === "workOrderDetail"
      ? APP_ROUTES.workOrderDetail.path.replace(":workOrderId", encodeURIComponent(target.id))
      : APP_ROUTES.orderDetail.path.replace(":id", encodeURIComponent(target.id)));
  };
  const refresh = () => Promise.all([showMetrics ? report.refetch() : Promise.resolve(), todos.refetch()]);

  return <>
    <PageHeader title="运营概览" description={data ? t("更新于 {time}", { time: new Date(data.generatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) }) : undefined}
      extra={<div className={styles.toolbar}><Button shape="circle" aria-label={t("刷新经营概览")} icon={<RotateCw size={16} />} loading={report.isFetching || todos.isFetching} onClick={() => void refresh()} />
        {canReconcilePayments && <ActionButton label={t("核对支付与退款")} pending={reconcilePayments.isPending} onAction={async () => {
          const result = await reconcilePayments.mutateAsync();
          if (result.failed > 0 || result.pending > 0) throw new Error("Reconciliation requires attention");
        }} />}</div>}
      view={showMetrics ? <div className={styles.periodRow}><Segmented aria-label={t("统计期间")} value={period} onChange={value => setPeriod(value as OverviewPeriod)} options={Object.entries(overviewPeriodLabels).map(([value, label]) => ({ value, label: t(label) }))} />
        <span className={styles.periodCaption} role="status">{report.isPlaceholderData ? t("正在更新所选期间") : t("订单按起租时间统计，待办与库存为当前状态")}</span></div> : undefined} />
    <div className={styles.page}>
      {showMetrics ? <QueryState loading={report.isLoading} error={report.error} onRetry={() => report.refetch({ throwOnError: true })}>
        {data && <WorkbenchMetrics data={data} periodLabel={periodLabel} orders={canViewOrders} assets={canViewAssets} busy={report.isFetching}
          onOpen={target => navigate(target === "orders" ? APP_ROUTES.orders.path : target === "assets" ? APP_ROUTES.assets.path : APP_ROUTES.operationReport.path)} />}
      </QueryState> : <Alert type="info" title={t("当前账号仅可查看工作台待办")} description={t("订单、库存和金额指标需要报表查看权限及相应的数据查看权限。")} />}
      <QueryState loading={todos.isLoading} error={todos.error} onRetry={() => todos.refetch({ throwOnError: true })}>
        <WorkbenchTodoQueue items={todos.data?.items ?? []} busy={todos.isFetching || todos.isError} formatAmount={money} canOpen={item => Boolean(overviewTodoTarget(item, access))}
          onOpen={openTodo} onRefresh={() => todos.refetch({ throwOnError: true })} />
      </QueryState>
      {showMetrics && data && <>
        <div className={styles.analysisGrid} aria-busy={report.isFetching}>
          {canViewOrders && <InsightPanel title={t("订单状态")} description={`${periodLabel} · ${t("非草稿")}`}
            actions={<ViewChoice value={statusView} onChange={setStatusView} options={[{ value: "chart", label: t("环图") }, { value: "split", label: t("分段") }, { value: "list", label: t("明细") }]} />}>
            <ContentTransition value={statusView}>{statusView === "chart" && statusRows.length ? <div className={styles.orderChart}>
              <DonutChart data={statusRows.map(row => ({ key: row.status, label: row.name, value: row.count, color: orderStatusChartColor(row.status) }))}
                label={t("订单状态")} unit={t("单")} totalLabel={t("期间订单")} size={ADMIN_INSIGHT_METRICS.donutSize} thickness={ADMIN_INSIGHT_METRICS.donutThickness}
                activeKey={status?.status ?? null} onActiveChange={setActiveStatus} legendAction="select" groupBelow={0} maxSegments={statusRows.length + 1}
                otherLabel={t("其他")} emptyLabel={t("暂无订单")} formatValue={value => new Intl.NumberFormat(locale).format(value)} />
            </div> : statusView === "split" && statusRows.length ? <SplitBar segments={statusSegments} label={t("订单状态")} unit={t("单")} locale={locale} totalLabel={t("图中合计")} hidden={visibleSelection} onHiddenChange={setHiddenStatuses} />
              : <RankedFacts rows={statusRows.map(row => ({ id: row.status, label: row.name, value: row.count }))} empty={t("暂无订单")} />}</ContentTransition>
            <div className={styles.orderSelection}><span>{statusView === "chart" && statusRows.length > 0 ? status ? t("已固定查看：{status}", { status: status.name }) : t("悬停查看占比，点击保留选择") : statusView === "split" && visibleSelection.length ? t("图例筛选仅影响图中占比") : ""}</span>
              {statusView === "chart" && status && <Button size="small" type="text" onClick={() => setActiveStatus(null)}>{t("清除选择")}</Button>}
              {statusView === "split" && visibleSelection.length > 0 && <Button size="small" type="text" onClick={() => setHiddenStatuses([])}>{t("显示全部分类")}</Button>}
              <Button size="small" type="text" onClick={() => navigate(APP_ROUTES.orders.path)}>{t("订单管理")}<ArrowRight size={14} /></Button>
            </div>
            <dl className={viewStyles.snapshotFacts}>
              <div><dt>{t("履约中")}</dt><dd><AnimatedNumber value={facts!.active} /></dd></div>
              <div><dt>{t("已关闭")}</dt><dd><AnimatedNumber value={facts!.completed} /></dd></div>
              <div><dt>{t("异常订单")}</dt><dd><AnimatedNumber value={data.exceptionOrderCount} /></dd></div>
              <div><dt>{t("平均租期")}</dt><dd>{data.utilization.orderOccupancy.averageHours} <small>{t("小时")}</small></dd></div>
            </dl>
          </InsightPanel>}
          {canViewAssets && <InsightPanel title={t("库存状态（当前快照）")} description={t("库存快照不随报表日期变化")} actions={<Button type="text" size="small" onClick={() => navigate(APP_ROUTES.assets.path)}>{t("资产与库存")}<ArrowRight size={14} /></Button>}>
            <InventoryOverview utilization={data.utilization} />
          </InsightPanel>}
        </div>
        {canViewOrders && <div className={styles.customerGrid}>
          <InsightPanel title={t("客户贡献")} description={t("按当前筛选应收金额排序")} actions={<Button type="text" size="small" onClick={() => navigate(APP_ROUTES.operationReport.path)}>{t("经营报表")}<ArrowRight size={14} /></Button>}>
            <RankedFacts rows={[...data.customerBreakdown].sort((a, b) => b.receivableTotal - a.receivableTotal).slice(0, 5).map((row, index) => ({
              id: `${row.customerType}:${row.customerId ?? index}`, label: <CustomerPreview customerId={row.customerId} name={row.customerName} type={row.customerType === "corporate" ? "corporate" : "personal"} snapshot presentation="list" secondary={t(row.orderCount === 1 ? "1 单" : "{count} 单", { count: row.orderCount })} />,
              value: row.receivableTotal,
            }))} format={money} empty={t("暂无订单")} />
            {data.customerBreakdown.length > 0 && <div className={styles.customerFooter}><span>{t("当前期间 {count} 位客户", { count: data.customerBreakdown.length })}</span><span>{t("应收金额不代表实际到账")}</span></div>}
          </InsightPanel>
          <InsightPanel title={t("履约地点贡献")} description={t("按当前筛选应收金额排序")}>
            <RankedFacts rows={locations.slice(0, 5).map(row => ({ id: row.locationId, label: row.locationName, value: row.receivableTotal,
              note: t(row.orderCount === 1 ? "1 单" : "{count} 单", { count: row.orderCount }),
              onOpen: locations.length > 1 ? () => setLocationId(row.locationId) : undefined,
            }))} format={money} empty={t("暂无订单")} />
            {selectedLocation && <ContentTransition value={selectedLocation.locationId}>
              <div className={styles.locationDetail} role="region" aria-label={t("地点经营明细")}>
                {locations.length > 1 && <p>{selectedLocation.locationName}</p>}
                <dl className={styles.locationFacts}>
                  <div><dt>{t("订单量")}</dt><dd>{selectedLocation.orderCount}</dd></div>
                  <div><dt>{t("租赁收入")}</dt><dd>{money(selectedLocation.rentalRevenue)}</dd></div>
                  <div><dt>{t("优惠金额")}</dt><dd>{money(selectedLocation.discountTotal)}</dd></div>
                  <div><dt>{t("异常费用")}</dt><dd>{money(selectedLocation.exceptionFeeTotal)}</dd></div>
                </dl>
              </div>
            </ContentTransition>}
            <p className={styles.scopeNote}>{t("地点与客户名称沿用下单时资料")}</p>
          </InsightPanel>
        </div>}
      </>}
    </div>
  </>;
}
