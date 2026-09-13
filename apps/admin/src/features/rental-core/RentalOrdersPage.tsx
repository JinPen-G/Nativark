import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { RentalOrder } from "@rental-os/shared";
import { formatRentalMoney, rentalAllocationProgress } from "@rental-os/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Checkbox, DatePicker, Input, Row, Col, Segmented, Space, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { hasPendingFeeReview } from "./orderFeeReview";

const statusLabels: Record<string, string> = { draft: "软预占", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待交付", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消", no_show: "已爽约" };

export function RentalOrdersPage() {
  const navigate = useNavigate();
  const canOperate = useAuthStore((s) => s.hasPermission("rental-os:order:operate"));
  const canCreate = useAuthStore((s) => s.hasPermission("rental-os:order:create"));
  const [assignmentFilter, setAssignmentFilter] = useState("全部分配");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // ORDER-CLOSE-02：待裁定费用会阻止关单，必须能在列表上直接筛出来，
  // 否则运营只能逐单点开才知道哪张单卡在费用审核上。
  const [pendingFeeOnly, setPendingFeeOnly] = useState(false);
  const orders = useQuery({ queryKey: ["rental-core", "orders"], queryFn: rentalCoreApi.orders });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const data = useMemo(() => (orders.data ?? []).filter((order) => {
    const term = keyword.trim().toLowerCase();
    const matchesKeyword = !term || [order.orderNo, order.customerName, order.membershipSnapshot?.corporateCustomerName, order.payerSubjectCustomerId].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    const matchesStatus = status === "all" || order.status === status;
    // 区间筛选按**当前**归还时间：续租过的订单实际占用到 effectiveEndAt，
    // 读原 endAt 会让它在覆盖续租那几天的筛选里查不出来。
    const matchesPeriod = !period?.[0] || !period?.[1] || (dayjs(order.startAt).isBefore(period[1]!.endOf("day")) && dayjs(order.effectiveEndAt ?? order.endAt).isAfter(period[0]!.startOf("day")));
    const assignmentMatches = assignmentFilter === "全部分配" || assignmentFilter === "分配异常" ? assignmentFilter !== "分配异常" || Boolean(order.assignment?.issue) : ["reserved", "ready_for_pickup"].includes(order.status) && rentalAllocationProgress(order).label === assignmentFilter;
    const matchesPendingFee = !pendingFeeOnly || hasPendingFeeReview(order);
    return matchesKeyword && matchesStatus && matchesPeriod && assignmentMatches && matchesPendingFee;
  }), [orders.data, keyword, period, status, assignmentFilter, pendingFeeOnly]);
  const statusOptions = [{ label: "全部", value: "all" }, ...[...new Set((orders.data ?? []).map((item) => item.status))].map((value) => ({ label: statusLabels[value] ?? value, value }))];
  return <>
    <PageHeader title="租赁订单" description="按个人使用人、企业主体、租期、履约与结算状态管理当前经营空间订单。" extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/rental/orders/new")}>新建订单</Button>} />
    <Card className="data-panel">
      <Segmented style={{ marginBottom: 16 }} value={assignmentFilter} onChange={setAssignmentFilter} options={["全部分配", "待分配", "部分分配", "待锁定", "已锁定", "分配异常"]} />
      <Space style={{ marginBottom: 16 }}>
        <Checkbox checked={pendingFeeOnly} onChange={(event) => setPendingFeeOnly(event.target.checked)}>只看有待审费用的订单</Checkbox>
        <Tag color="orange">{(orders.data ?? []).filter((row) => hasPendingFeeReview(row)).length} 张待裁定</Tag>
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}><Col xs={24} xl={10}><Input allowClear prefix={<SearchOutlined />} placeholder="订单号、个人会员或企业名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></Col><Col xs={24} md={12} xl={7}><DatePicker.RangePicker value={period} onChange={(value) => setPeriod(value)} style={{ width: "100%" }} /></Col><Col xs={24} md={12} xl={7}><Segmented block options={statusOptions} value={status} onChange={(value) => setStatus(String(value))} /></Col></Row>
      <QueryState loading={orders.isLoading} error={orders.error}><Table<RentalOrder> rowKey="id" dataSource={data} scroll={{ x: 1260 }} columns={[
        { title: "订单", fixed: "left", width: 170, render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{row.orderNo}</Button> },
        { title: "使用人 / 主体", width: 210, render: (_, row) => <Space orientation="vertical" size={0}><b>{row.membershipSnapshot?.personalCustomerName ?? row.customerName}</b>{row.membershipSnapshot?.corporateCustomerName && <Tag color="blue">{row.membershipSnapshot.corporateCustomerName}{row.membershipSnapshot.enterpriseContractAndPayer ? " · 企业签约付款" : " · 企业权益"}</Tag>} {!row.membershipSnapshot && <span className="muted">旧客户记录</span>}</Space> },
        { title: profile.data?.terminology.itemLabel ?? "商品", width: 220, render: (_, row) => row.lines.map((line) => `${line.itemGroupName}×${line.quantity}`).join("、") },
        { title: "租赁时间", width: 210, render: (_, row) => {
          // 续租不改 `endAt`（需求 4.6.9），当前归还时间在 `effectiveEndAt`。
          // 列表必须显示后者，否则续租过的单在列表上看起来仍是原时间。
          const end = row.effectiveEndAt ?? row.endAt;
          return <>{`${dayjs(row.startAt).format("MM-DD HH:mm")} → ${dayjs(end).format("MM-DD HH:mm")}`}{row.effectiveEndAt && row.effectiveEndAt !== row.endAt && <><br /><span className="muted">已续租，原 {dayjs(row.endAt).format("MM-DD HH:mm")}</span></>}</>;
        } },
        { title: "报价快照", width: 150, render: (_, row) => <><span>{row.quoteNo}</span><br /><span className="muted">价格 v{row.pricingPlanVersion} · 规则 v{row.ruleVersion}</span></> },
        { title: "应付", width: 110, dataIndex: "payableAmount", render: (value, row) => formatRentalMoney(Number(value), row.currency) },
        { title: "实际资源 / 分配", width: 240, render: (_, row) => <><div>{row.allocations.filter((a) => !["released", "returned"].includes(a.status)).map((a) => `${a.assetNo ?? a.metadata?.itemGroupName ?? "数量库存"} × ${a.quantity}`).join("、") || "尚未分配"}</div>{["reserved", "ready_for_pickup"].includes(row.status) && <Tag color={row.assignment?.issue ? "error" : "blue"}>{row.assignment?.issue ? "待人工处理" : rentalAllocationProgress(row).label}</Tag>}</> },
        { title: "操作", fixed: "right", width: 115, render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{!canOperate ? "查看" : row.status === "reserved" ? "分配 / 锁定" : row.status === "ready_for_pickup" ? "办理领取" : row.status === "renting" ? "办理归还" : "查看详情"}</Button> },
        { title: "押金 / 预授权", width: 150, render: (_, row) => `${formatRentalMoney(row.depositAmount, row.currency)} / ${formatRentalMoney(row.preAuthAmount, row.currency)}` },
        { title: "状态", fixed: "right", width: 110, dataIndex: "status", render: (value, row) => <Space orientation="vertical" size={0}>
          <Tag color={value === "completed" ? "success" : value === "cancelled" ? "default" : "processing"}>{statusLabels[value] ?? value}</Tag>
          {hasPendingFeeReview(row) && <Tag color="orange">待裁定费用</Tag>}
        </Space> }
      ]} /></QueryState>
    </Card>
  </>;
}
