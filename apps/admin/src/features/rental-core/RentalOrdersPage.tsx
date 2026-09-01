import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { RentalOrder } from "@store-rental/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, DatePicker, Input, Row, Col, Segmented, Space, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const statusLabels: Record<string, string> = { draft: "软预占", reserved: "已确认", ready_for_pickup: "待交付", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消" };

export function RentalOrdersPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const orders = useQuery({ queryKey: ["rental-core", "orders"], queryFn: rentalCoreApi.orders });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const data = useMemo(() => (orders.data ?? []).filter((order) => {
    const term = keyword.trim().toLowerCase();
    const matchesKeyword = !term || [order.orderNo, order.customerName, order.membershipSnapshot?.corporateCustomerName, order.payerSubjectCustomerId].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    const matchesStatus = status === "all" || order.status === status;
    const matchesPeriod = !period?.[0] || !period?.[1] || (dayjs(order.startAt).isBefore(period[1]!.endOf("day")) && dayjs(order.endAt).isAfter(period[0]!.startOf("day")));
    return matchesKeyword && matchesStatus && matchesPeriod;
  }), [orders.data, keyword, period, status]);
  const statusOptions = [{ label: "全部", value: "all" }, ...[...new Set((orders.data ?? []).map((item) => item.status))].map((value) => ({ label: statusLabels[value] ?? value, value }))];
  return <>
    <PageHeader title="租赁订单" description="按个人使用人、企业主体、租期、履约与结算状态管理当前经营空间订单。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/rental/orders/new")}>新建订单</Button>} />
    <Card className="data-panel">
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}><Col xs={24} xl={10}><Input allowClear prefix={<SearchOutlined />} placeholder="订单号、个人会员或企业名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></Col><Col xs={24} md={12} xl={7}><DatePicker.RangePicker value={period} onChange={(value) => setPeriod(value)} style={{ width: "100%" }} /></Col><Col xs={24} md={12} xl={7}><Segmented block options={statusOptions} value={status} onChange={(value) => setStatus(String(value))} /></Col></Row>
      <QueryState loading={orders.isLoading} error={orders.error}><Table<RentalOrder> rowKey="id" dataSource={data} scroll={{ x: 1260 }} columns={[
        { title: "订单", fixed: "left", width: 170, render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{row.orderNo}</Button> },
        { title: "使用人 / 主体", width: 210, render: (_, row) => <Space direction="vertical" size={0}><b>{row.membershipSnapshot?.personalCustomerName ?? row.customerName}</b>{row.membershipSnapshot?.corporateCustomerName && <Tag color="blue">{row.membershipSnapshot.corporateCustomerName}{row.membershipSnapshot.enterpriseContractAndPayer ? " · 企业签约付款" : " · 企业权益"}</Tag>} {!row.membershipSnapshot && <span className="muted">旧客户记录</span>}</Space> },
        { title: profile.data?.terminology.itemLabel ?? "商品", width: 220, render: (_, row) => row.lines.map((line) => `${line.itemGroupName}×${line.quantity}`).join("、") },
        { title: "租赁时间", width: 210, render: (_, row) => `${dayjs(row.startAt).format("MM-DD HH:mm")} → ${dayjs(row.endAt).format("MM-DD HH:mm")}` },
        { title: "报价快照", width: 150, render: (_, row) => <><span>{row.quoteNo}</span><br /><span className="muted">价格 v{row.pricingPlanVersion} · 规则 v{row.ruleVersion}</span></> },
        { title: "应付", width: 110, dataIndex: "payableAmount", render: (value) => `¥${Number(value).toFixed(2)}` },
        { title: "押金 / 预授权", width: 150, render: (_, row) => `¥${Number(row.depositAmount).toFixed(2)} / ¥${Number(row.preAuthAmount).toFixed(2)}` },
        { title: "状态", fixed: "right", width: 110, dataIndex: "status", render: (value) => <Tag color={value === "completed" ? "success" : value === "cancelled" ? "default" : "processing"}>{statusLabels[value] ?? value}</Tag> }
      ]} /></QueryState>
    </Card>
  </>;
}
