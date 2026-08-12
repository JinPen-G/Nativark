import { FileAddOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Card, Input, Segmented, Space, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const orderStatus: Record<string, { label: string; color: string }> = { pending_payment: { label: "待支付", color: "gold" }, reserved: { label: "已预订", color: "blue" }, inspecting: { label: "交接检查", color: "cyan" }, renting: { label: "履约中", color: "processing" }, renewing: { label: "续租中", color: "purple" }, overdue: { label: "逾期", color: "error" }, settlement_pending: { label: "待结算", color: "orange" }, completed: { label: "已完成", color: "success" }, cancelled: { label: "已取消", color: "default" } };

export function OrdersPage() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>("all");
  const query = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  const navigate = useNavigate();
  const rows = useMemo(() => (query.data ?? []).filter((order) => (status === "all" || order.mainStatus === status) && (!keyword || `${order.orderNo}${order.customerName}${order.vehicleGroupName}`.toLowerCase().includes(keyword.toLowerCase()))), [query.data, keyword, status]);

  return <>
    <PageHeader title="租赁订单" description="跟踪预约、领取、履约、归还和结算状态。" extra={<Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate("/rental/orders/new")}>新建订单</Button>} />
    <Card
      className="workspace-panel"
      title={<span className="panel-title">全部订单 <span className="panel-count">{rows.length}</span></span>}
      extra={<Input allowClear prefix={<SearchOutlined />} placeholder="订单号、客户或标的" value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 280 }} />}
      styles={{ body: { paddingBottom: 0 } }}
    >
      <div className="panel-toolbar">
        <div className="panel-toolbar-start"><Segmented value={status} onChange={(value) => setStatus(String(value))} options={[{ label: "全部", value: "all" }, { label: "已预订", value: "reserved" }, { label: "履约中", value: "renting" }, { label: "待结算", value: "settlement_pending" }]} /></div>
        <div className="panel-toolbar-end"><Typography.Text type="secondary">当前为车辆单标的订单兼容投影</Typography.Text><Button shape="circle" aria-label="刷新订单" icon={<ReloadOutlined />} onClick={() => void query.refetch()} /></div>
      </div>
      <QueryState loading={query.isLoading} error={query.error}>
        <Table rowKey="id" dataSource={rows} scroll={{ x: 1150 }} columns={[
          { title: "订单号", dataIndex: "orderNo", fixed: "left", render: (value) => <Typography.Text strong>{value}</Typography.Text> },
          { title: "客户", dataIndex: "customerName", render: (value, record) => <span>{value}<br /><span className="muted">{record.corporateShortName ?? "个人客户"}</span></span> },
          { title: "租赁标的", dataIndex: "vehicleGroupName", render: (value, record) => <span>{value}<br /><span className="muted">{record.plateNo ?? "待分配资产"}</span></span> },
          { title: "领取 / 归还", render: (_, record) => <span>{record.pickupStoreName}<br /><span className="muted">{record.pickupAt.slice(0, 16)} → {record.returnAt.slice(0, 16)}</span></span> },
          { title: "金额", dataIndex: "totalAmount", align: "right", render: (value) => <Typography.Text strong>¥{Number(value).toLocaleString()}</Typography.Text> },
          { title: "订单状态", dataIndex: "mainStatus", render: (value: string) => <Tag color={orderStatus[value]?.color}>{orderStatus[value]?.label ?? value}</Tag> },
          { title: "操作", render: (_, record) => <Button type="link" onClick={() => navigate(`/rental/orders/${record.id}`)}>查看详情</Button> }
        ]} />
      </QueryState>
    </Card>
  </>;
}
