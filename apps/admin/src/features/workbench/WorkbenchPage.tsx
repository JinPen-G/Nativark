import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, type RentalAssetStatus, type RentalOrder } from "@store-rental/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Progress, Segmented, Space, Statistic, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const orderStatusLabels: Record<RentalCoreOrderStatus, string> = {
  [RentalCoreOrderStatus.Draft]: "草稿",
  [RentalCoreOrderStatus.Reserved]: "已预订",
  [RentalCoreOrderStatus.ReadyForPickup]: "待领取",
  [RentalCoreOrderStatus.Renting]: "租赁中",
  [RentalCoreOrderStatus.ReturnInspection]: "待归还检查",
  [RentalCoreOrderStatus.Completed]: "已完成",
  [RentalCoreOrderStatus.Cancelled]: "已取消"
};
const assetStatusLabels: Record<RentalAssetStatus, string> = { available: "可用", reserved: "已预占", rented: "租赁中", inspection: "检查中", maintenance: "维护中", disabled: "已停用" };
const money = (value: number) => `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function periodStart(period: string) {
  const start = new Date();
  if (period === "今日") start.setHours(0, 0, 0, 0);
  else if (period === "本周") { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return start.getTime();
}

export function WorkbenchPage() {
  const [period, setPeriod] = useState("本月");
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const orders = useQuery({ queryKey: ["rental-core", "orders"], queryFn: rentalCoreApi.orders });
  const assets = useQuery({ queryKey: ["rental-core", "assets"], queryFn: rentalCoreApi.assets });
  const stocks = useQuery({ queryKey: ["rental-core", "stock-balances"], queryFn: rentalCoreApi.stockBalances });
  const loading = profile.isLoading || orders.isLoading || assets.isLoading || stocks.isLoading;
  const error = profile.error || orders.error || assets.error || stocks.error;
  const filteredOrders = useMemo(() => (orders.data ?? []).filter((order) => new Date(order.createdAt).getTime() >= periodStart(period)), [orders.data, period]);
  const activeOrders = filteredOrders.filter((order) => [RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.ReturnInspection].includes(order.status));
  const completedOrders = filteredOrders.filter((order) => order.status === RentalCoreOrderStatus.Completed);
  const periodRevenue = completedOrders.reduce((total, order) => total + order.finalPayableAmount, 0);
  const availableUnits = (assets.data ?? []).filter((asset) => asset.status === "available").length + (stocks.data ?? []).reduce((total, stock) => total + stock.availableQuantity, 0);
  const funnel = Object.values(RentalCoreOrderStatus).map((status) => {
    const rows = filteredOrders.filter((order) => order.status === status);
    return { status, name: orderStatusLabels[status], value: rows.length, amount: rows.reduce((total, order) => total + order.finalPayableAmount, 0) };
  }).filter((row) => row.value > 0);
  const assetDistribution = Object.entries((assets.data ?? []).reduce<Record<string, number>>((result, asset) => ({ ...result, [asset.status]: (result[asset.status] ?? 0) + 1 }), {}));

  function refresh() { void Promise.all([profile.refetch(), orders.refetch(), assets.refetch(), stocks.refetch()]); }

  return <>
    <PageHeader title="运营概览" description={`${profile.data?.terminology.itemLabel ?? "租赁标的"}、订单与库存均来自当前 SaaS 租户的 Rental Core 数据。`} view={<Segmented value={period} onChange={(value) => setPeriod(String(value))} options={["今日", "本周", "本月"]} />} extra={<Button shape="circle" aria-label="刷新经营概览" icon={<ReloadOutlined />} onClick={refresh} />} />
    <QueryState loading={loading} error={error}>
      <div className="metric-grid">
        <Card className="metric-card"><Statistic title="期间订单" value={filteredOrders.length} /><div className="metric-foot"><span>{period}</span><span>全部状态</span></div></Card>
        <Card className="metric-card"><Statistic title="履约中" value={activeOrders.length} /><div className="metric-foot"><span>已预订至待归还</span><span className="metric-trend">实时</span></div></Card>
        <Card className="metric-card"><Statistic title="可租库存" value={availableUnits} /><div className="metric-foot"><span>独立资产 + 数量库存</span><span className="metric-trend">可用</span></div></Card>
        <Card className="metric-card"><Statistic title="已完成订单金额" value={periodRevenue} formatter={(value) => money(Number(value))} /><div className="metric-foot"><span>{completedOrders.length} 单</span><span>最终应付</span></div></Card>
      </div>
      <div className="workspace-grid">
        <Card className="workspace-panel" title={<span className="panel-title">订单状态 <span className="panel-count">{filteredOrders.length}</span></span>} extra={<Button type="link" onClick={() => navigate("/rental/orders")}>查看订单 <ArrowRightOutlined /></Button>}>
          <Table pagination={false} rowKey="status" dataSource={funnel} locale={{ emptyText: `${period}暂无订单` }} columns={[
            { title: "阶段", dataIndex: "name", render: (value) => <Typography.Text strong>{value}</Typography.Text> },
            { title: "订单数", dataIndex: "value", align: "right" },
            { title: "金额", dataIndex: "amount", align: "right", render: money },
            { title: "占比", align: "right", render: (_: unknown, row: { value: number }) => <Progress percent={filteredOrders.length ? Math.round(row.value / filteredOrders.length * 100) : 0} size="small" style={{ minWidth: 112 }} /> }
          ]} />
        </Card>
        <Card className="workspace-panel" title="库存状态" extra={<Button type="link" onClick={() => navigate("/rental/assets")}>资产与库存 <ArrowRightOutlined /></Button>}>
          <Space direction="vertical" size={0} style={{ width: "100%" }}>
            {assetDistribution.map(([status, value]) => <div className="status-row" key={status}><div><Typography.Text strong>{assetStatusLabels[status as RentalAssetStatus] ?? status}</Typography.Text><Typography.Text type="secondary">独立资产</Typography.Text></div><Tag color={status === "available" ? "green" : status === "maintenance" ? "orange" : "blue"}>{value} 项</Tag></div>)}
            {(stocks.data ?? []).map((stock) => <div className="status-row" key={stock.id}><div><Typography.Text strong>{stock.itemGroupName}</Typography.Text><Typography.Text type="secondary">{stock.locationName} · 数量库存</Typography.Text></div><Tag color={stock.availableQuantity > 0 ? "green" : "orange"}>{stock.availableQuantity} / {stock.onHandQuantity}</Tag></div>)}
            {!assetDistribution.length && !(stocks.data ?? []).length && <Typography.Text type="secondary">尚未建立资产或数量库存。</Typography.Text>}
          </Space>
        </Card>
      </div>
    </QueryState>
  </>;
}
