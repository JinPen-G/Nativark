import { PlusOutlined } from "@ant-design/icons";
import type { RentalOrder } from "@store-rental/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const statusLabels: Record<string, string> = { draft: "软预占", reserved: "已确认", ready_for_pickup: "待交付", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消" };

export function RentalOrdersPage() {
  const navigate = useNavigate();
  const orders = useQuery({ queryKey: ["rental-core", "orders"], queryFn: rentalCoreApi.orders });
  return <><PageHeader title="租赁订单" description="统一管理各经营品类的服务端报价、库存预占、交付、归还和结算事实。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/rental/orders/new")}>新建订单</Button>} /><Card className="data-panel"><QueryState loading={orders.isLoading} error={orders.error}><Table<RentalOrder> rowKey="id" dataSource={orders.data ?? []} scroll={{ x: 1100 }} columns={[{ title: "订单", fixed: "left", render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{row.orderNo}</Button> }, { title: "客户", render: (_, row) => <><b>{row.customerName}</b><br /><span className="muted">{row.customerType}</span></> }, { title: "商品", render: (_, row) => row.lines.map((line) => `${line.itemGroupName}×${line.quantity}`).join("、") }, { title: "租赁时间", render: (_, row) => `${dayjs(row.startAt).format("MM-DD HH:mm")} → ${dayjs(row.endAt).format("MM-DD HH:mm")}` }, { title: "报价快照", render: (_, row) => <><span>{row.quoteNo}</span><br /><span className="muted">价格 v{row.pricingPlanVersion} · 规则 v{row.ruleVersion}</span></> }, { title: "应付", dataIndex: "payableAmount", render: (value) => `¥${Number(value).toFixed(2)}` }, { title: "押金 / 预授权", render: (_, row) => `¥${Number(row.depositAmount).toFixed(2)} / ¥${Number(row.preAuthAmount).toFixed(2)}` }, { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "completed" ? "success" : value === "cancelled" ? "default" : "processing"}>{statusLabels[value] ?? value}</Tag> }]} /></QueryState></Card></>;
}
