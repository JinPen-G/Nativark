import { ArrowRightOutlined, ReloadOutlined } from "@/components/ui/icons";
import { RentalCoreOrderStatus, formatRentalMoney, type RentalAssetStatus, type RentalWorkbenchTodo, type RentalWorkbenchTodoType, type RentalWorkspaceReportFilter } from "@rental-os/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, Space, Statistic, Tag, Typography } from "antd";
import { ListSection, App } from "@/components/ui";
import { Alert, Progress, Table } from "@/components/ui";
import { ActionButton, Button, Segmented } from "@/components/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

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
const todoTypeColors: Record<RentalWorkbenchTodoType, string> = {
  pending_payment: "gold",
  no_show_notice: "orange",
  no_show_confirmation: "red",
  return_overdue: "orange",
  fee_review: "volcano",
  refund: "purple",
  work_order: "blue",
  notification_failure: "red",
  cancelled_refund_due: "magenta",
  offline_payment_pending: "cyan"
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
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile, enabled: canViewOrders || canViewAssets });
  // 区间按订单起租时间归入（报表口径）。查询键与报表页同构，命中同一份缓存。
  const filter: RentalWorkspaceReportFilter = { from: periodStart(period).toISOString() };
  const report = useQuery({ queryKey: ["rental-core", "operation-report", filter], queryFn: () => rentalCoreApi.operationReport(filter), enabled: showMetrics });
  const todos = useQuery({ queryKey: ["rental-core", "workbench-todos"], queryFn: rentalCoreApi.workbenchTodos });
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
    <PageHeader title="运营概览" view={<Segmented value={period} onChange={(value) => setPeriod(String(value))} options={["今日", "本周", "本月"].map((value) => ({ value, label: t(value) }))} />} extra={<Space><Button shape="circle" aria-label={t("刷新经营概览")} icon={<ReloadOutlined />} onClick={refresh} />{canReconcilePayments && <ActionButton label={t("核对支付与退款")} pending={reconcilePayments.isPending} onAction={async () => { const result = await reconcilePayments.mutateAsync(); if (result.failed > 0 || result.pending > 0) throw new Error("Reconciliation requires attention"); }} />}</Space>} />
    <QueryState loading={loading} error={error}>
      {showMetrics ? <div className="metric-grid">
        {canViewOrders && <>
          <Card className="metric-card"><Statistic title={t("期间订单")} value={orderCount} /><div className="metric-foot"><span>{t(period)}{t("起租")}</span><span>{t("非草稿")}</span></div></Card>
          <Card className="metric-card"><Statistic title={t("履约中")} value={activeCount} /><div className="metric-foot"><span>{t("已预订至待结算")}</span><span className="metric-trend">{t("实时")}</span></div></Card>
          <Card className="metric-card"><Statistic title={t("应收金额")} value={data?.receivableTotal ?? 0} formatter={(value) => money(Number(value))} /><div className="metric-foot"><span>{completedCount} {t("单已关闭")}</span><span>{t("调账后应收")}</span></div></Card>
          <Card className="metric-card"><Statistic title={t("租赁收入")} value={data?.rentalRevenue ?? 0} formatter={(value) => money(Number(value))} /><div className="metric-foot"><span>{t("只含租金")}</span><span>{t("不含服务与押金")}</span></div></Card>
        </>}
        {canViewAssets && <Card className="metric-card"><Statistic title={t("可租库存")} value={availableUnits} /><div className="metric-foot"><span>{t("独立资产 + 数量库存")}</span><span className="metric-trend">{t("当前快照")}</span></div></Card>}
      </div> : <Alert type="info" showIcon title={t("当前账号仅可查看工作台待办")} description={t("订单、库存和金额指标需要报表查看权限及相应的数据查看权限。")} style={{ marginBottom: 16 }} />}
      <ListSection title={<span className="panel-title">{t("运营待办")} <span className="panel-count">{todos.data?.items.length ?? 0}</span></span>} style={{ marginBottom: "var(--space-4)" }}>
        <Table<RentalWorkbenchTodo>
          size="small"
          rowKey="id"
          pagination={false}
          onRefresh={() => todos.refetch()} loading={todos.isFetching} dataSource={(todos.data?.items ?? []).slice(0, 8)}
          locale={{ emptyText: t("当前空间没有需要处理的待办") }}
          columns={[
            { title: t("事项"), render: (_, item) => <Space orientation="vertical" size={4} style={{ alignItems: "flex-start" }}><Tag color={todoTypeColors[item.type]}>{t(todoTypeLabels[item.type])}</Tag><Typography.Text strong>{item.title}</Typography.Text>{item.orderNo && <Typography.Text type="secondary">{item.orderNo}</Typography.Text>}</Space> },
            { title: t("说明"), dataIndex: "description", ellipsis: true },
            { title: t("金额"), dataIndex: "amount", align: "right", render: (value) => value === undefined ? "—" : money(Number(value)) },
            { title: t("操作"), align: "right", render: (_, item) => canOpenTodo(item) ? <Button type="link" onClick={() => navigate(item.href)}>{t("处理")}</Button> : <Typography.Text type="secondary">{t("无详情权限")}</Typography.Text> }
          ]}
        />
        {(todos.data?.items.length ?? 0) > 8 && <Typography.Text type="secondary">{t("还有")} {(todos.data?.items.length ?? 0) - 8}{t("项，请从订单或工单页面继续处理。")}</Typography.Text>}
      </ListSection>
      {showMetrics && <div className="workspace-grid">
        {canViewOrders && <ListSection title={<span className="panel-title">{t("订单状态")} <span className="panel-count">{orderCount}</span></span>} extra={<Button type="link" onClick={() => navigate("/rental/orders")}>{t("查看订单")} <ArrowRightOutlined /></Button>}>
          <Table pagination={false} rowKey="status" onRefresh={() => report.refetch()} loading={report.isFetching} dataSource={statusRows} locale={{ emptyText: `${t(period)}${t("暂无订单")}` }} columns={[
            { title: t("阶段"), dataIndex: "name", render: (value) => <Typography.Text strong>{value}</Typography.Text> },
            { title: t("订单数"), dataIndex: "count", align: "right" },
            { title: t("占比"), align: "right", render: (_: unknown, row: { count: number }) => <Progress percent={orderCount ? Math.round(row.count / orderCount * 100) : 0} size="small" style={{ minWidth: 112 }} /> }
          ]} />
        </ListSection>}
        {canViewAssets && <Card className="workspace-panel" title={t("库存状态（当前快照）")} extra={<Button type="link" onClick={() => navigate("/rental/assets")}>{t("资产与库存")} <ArrowRightOutlined /></Button>}>
          {/* Keep the decision boundary visible, without rendering database diagnostics as UI help. */}
          {(data?.historicalCaliberGaps.length ?? 0) > 0 && <Alert type="warning" showIcon title={t("这一节是读取瞬间的快照，不是区间利用率")} description={t("缺少历史可用时长，暂不计算区间利用率。")} style={{ marginBottom: "var(--space-3)" }} />}
          <Space orientation="vertical" size={0} style={{ width: "100%" }}>
            {(assets?.statusBreakdown ?? []).map((row) => <div className="status-row" key={row.status}><div><Typography.Text strong>{t(assetStatusLabels[row.status] ?? row.status)}</Typography.Text><Typography.Text type="secondary">{t("独立资产")}</Typography.Text></div><Tag color={row.status === "available" ? "green" : row.status === "maintenance" ? "orange" : "blue"}>{row.count} {t("项")}</Tag></div>)}
            {stock && stock.onHandTotal > 0 && <div className="status-row"><div><Typography.Text strong>{t("数量库存")}</Typography.Text><Typography.Text type="secondary">{t("可租 / 在库（已占用")} {stock.reservedTotal}，{t("维修")} {stock.maintenanceTotal}）</Typography.Text></div><Tag color={stock.availableTotal > 0 ? "green" : "orange"}>{stock.availableTotal} / {stock.onHandTotal}</Tag></div>}
            {!(assets?.statusBreakdown.length) && !(stock && stock.onHandTotal > 0) && <Typography.Text type="secondary">{t("尚未建立资产或数量库存。")}</Typography.Text>}
          </Space>
        </Card>}
      </div>}
    </QueryState>
  </>;
}
