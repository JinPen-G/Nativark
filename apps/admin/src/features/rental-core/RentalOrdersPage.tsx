import { PlusOutlined } from "@ant-design/icons";
import type { RentalCoreOrderStatus, RentalOrder, RentalOrderAssignmentFilter, RentalOrderListQuery } from "@rental-os/shared";
import { RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE, formatRentalMoney, rentalAllocationProgress } from "@rental-os/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Card, Row, Col, Space, Tag } from "antd";
import { Checkbox } from "@/components/ui";
import { AnimatedTable, Button, DatePicker, SearchField, Segmented, Select } from "@/components/ui";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { hasPendingFeeReview } from "./orderFeeReview";

const statusLabels: Record<string, string> = { draft: "软预占", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待交付", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消", no_show: "已爽约" };
/** 分配进度分段的显示文案 → 服务端筛选值。判据在服务端 SQL 里，与 `rentalAllocationProgress` 对应。 */
const assignmentFilterOptions: Array<{ label: string; value: RentalOrderAssignmentFilter | "all" }> = [
  { label: "全部分配", value: "all" },
  { label: "待分配", value: "pending" },
  { label: "部分分配", value: "partial" },
  { label: "待锁定", value: "unlocked" },
  { label: "已锁定", value: "locked" },
  { label: "分配异常", value: "issue" }
];
const orderSortValue = (row: RentalOrder, column: number): unknown => [
  row.orderNo, row.membershipSnapshot?.personalCustomerName ?? row.customerName,
  row.lines.map(line => line.itemGroupName).join("、"), new Date(row.startAt), row.quoteNo,
  Number(row.payableAmount), row.allocations.filter(a => !["released", "returned", "consumed"].includes(a.status)).reduce((sum, a) => sum + a.quantity, 0),
  undefined, Number(row.depositAmount), row.status,
][column];

export function RentalOrdersPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const canOperate = useAuthStore((s) => s.hasPermission("rental-os:order:operate"));
  const canCreate = useAuthStore((s) => s.hasPermission("rental-os:order:create"));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE);
  const [assignment, setAssignment] = useState<RentalOrderAssignmentFilter | "all">("all");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<RentalCoreOrderStatus>();
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // ORDER-CLOSE-02：待裁定费用会阻止关单，必须能在列表上直接筛出来，
  // 否则运营只能逐单点开才知道哪张单卡在费用审核上。
  const [pendingFeeOnly, setPendingFeeOnly] = useState(false);

  // 筛选与分页全部交给服务端；页面不再拉整张表再在内存里过滤。
  // 查询键包含全部条件，否则换了条件却命中上一次的缓存。
  const query: RentalOrderListQuery = {
    page,
    pageSize,
    status,
    keyword: keyword || undefined,
    // 区间筛选按**当前**归还时间：续租过的订单实际占用到 effectiveEndAt，
    // 读原 endAt 会让它在覆盖续租那几天的筛选里查不出来（判据在服务端）。
    from: period?.[0] ? period[0].startOf("day").toISOString() : undefined,
    to: period?.[1] ? period[1].endOf("day").toISOString() : undefined,
    assignment: assignment === "all" ? undefined : assignment,
    pendingFeeOnly: pendingFeeOnly || undefined
  };
  const orders = useQuery({ queryKey: ["rental-core", "orders", query], queryFn: () => rentalCoreApi.orderPage(query), placeholderData: keepPreviousData });
  // 「待裁定」计数是当前空间的总数，不随列表筛选变化；只取 total，不取行。
  const pendingFeeCount = useQuery({ queryKey: ["rental-core", "orders", { pendingFeeOnly: true, pageSize: 1 }], queryFn: () => rentalCoreApi.orderPage({ pendingFeeOnly: true, pageSize: 1 }) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const rows = orders.data?.items ?? [];
  const total = orders.data?.total ?? 0;
  const itemLabel = profile.data?.terminology.itemLabel ?? "商品";
  /** 任何筛选条件变化都回到第一页，否则可能停在一个新条件下不存在的页码上。 */
  const applyFilter = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const localizedAssignmentFilterOptions = assignmentFilterOptions.map(({ label, value }) => ({ value, label: t(label) }));
  const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label: t(label) }));
  return <>
    <PageHeader title="租赁订单" description="按个人使用人、企业主体、租期、履约与结算状态管理当前经营空间订单。" extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/rental/orders/new")}>{t("新建订单")}</Button>} />
    <Card className="data-panel">
      <Segmented style={{ marginBottom: 16 }} value={assignment} onChange={applyFilter(setAssignment)} options={localizedAssignmentFilterOptions} />
      <Space style={{ marginBottom: 16 }}>
        <Checkbox checked={pendingFeeOnly} onChange={(event) => applyFilter(setPendingFeeOnly)(event.target.checked)}>{t("只看有待审费用的订单")}</Checkbox>
        <Tag color="orange">{pendingFeeCount.data?.total ?? 0} {t("张待裁定")}</Tag>
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><SearchField label={t("搜索订单")} placeholder={t("订单号、个人会员或企业名称，回车搜索")} value={keywordInput} onValueChange={(value) => { setKeywordInput(value); if (!value) applyFilter(setKeyword)(""); }} onSearch={(value) => applyFilter(setKeyword)(value.trim())} /></Col>
        <Col xs={24} md={8}><DatePicker.RangePicker value={period} onChange={applyFilter(setPeriod)} style={{ width: "100%" }} presets={[
          { label: t("今天"), value: (): [Dayjs, Dayjs] => [dayjs().startOf("day"), dayjs().endOf("day")] },
          { label: t("近 7 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")] },
          { label: t("本月"), value: (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")] },
          { label: t("近 30 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")] },
          { label: t("近 90 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(89, "day").startOf("day"), dayjs().endOf("day")] }
        ]} /></Col>
        <Col xs={24} md={8}><Select allowClear placeholder={t("全部状态")} style={{ width: "100%" }} options={statusOptions} value={status} onChange={value => applyFilter(setStatus)(value as RentalCoreOrderStatus | undefined)} /></Col>
      </Row>
      <QueryState loading={orders.isLoading} error={orders.error}><AnimatedTable<RentalOrder> sorting={false} sortValue={orderSortValue} rowKey="id" dataSource={rows} loading={orders.isLoading || orders.isPlaceholderData && orders.isFetching}
        pagination={{ current: page, pageSize, total, showSizeChanger: false, showTotal: (count) => `${t("共")} ${count} ${t("单")}`, onChange: (nextPage, nextSize) => { if (nextSize !== pageSize) { setPageSize(nextSize); setPage(1); } else setPage(nextPage); } }}
        columns={[
        { title: t("订单"), fixed: "left", width: 170, render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{row.orderNo}</Button> },
        { title: t("使用人 / 主体"), width: 210, render: (_, row) => <Space orientation="vertical" size={0}><b>{row.membershipSnapshot?.personalCustomerName ?? row.customerName}</b>{row.membershipSnapshot?.corporateCustomerName && <Tag color="blue">{row.membershipSnapshot.corporateCustomerName}{row.membershipSnapshot.enterpriseContractAndPayer ? ` · ${t("企业签约付款")}` : ` · ${t("企业权益")}`}</Tag>} {!row.membershipSnapshot && <span className="muted">{t("旧客户记录")}</span>}</Space> },
        { title: t(itemLabel), width: 220, render: (_, row) => row.lines.map((line) => `${line.itemGroupName}×${line.quantity}`).join("、") },
        { title: t("租赁时间"), width: 210, render: (_, row) => {
          // 续租不改 `endAt`（需求 4.6.9），当前归还时间在 `effectiveEndAt`。
          // 列表必须显示后者，否则续租过的单在列表上看起来仍是原时间。
          const end = row.effectiveEndAt ?? row.endAt;
          return <>{`${dayjs(row.startAt).format("MM-DD HH:mm")} → ${dayjs(end).format("MM-DD HH:mm")}`}{row.effectiveEndAt && row.effectiveEndAt !== row.endAt && <><br /><span className="muted">{t("已续租，原")} {dayjs(row.endAt).format("MM-DD HH:mm")}</span></>}</>;
        } },
        { title: t("报价快照"), width: 150, render: (_, row) => <><span>{row.quoteNo}</span><br /><span className="muted">{t("价格")} v{row.pricingPlanVersion} · {t("规则")} v{row.ruleVersion}</span></> },
        { title: t("应付"), width: 110, dataIndex: "payableAmount", render: (value, row) => formatRentalMoney(Number(value), row.currency) },
        { title: t("实际资源 / 分配"), width: 240, render: (_, row) => <><div>{row.allocations.filter((a) => !["released", "returned", "consumed"].includes(a.status)).map((a) => `${a.assetNo ?? a.metadata?.itemGroupName ?? t("数量库存")} × ${a.quantity}`).join("、") || t("尚未分配")}</div>{["reserved", "ready_for_pickup"].includes(row.status) && <Tag color={row.assignment?.issue ? "error" : "blue"}>{row.assignment?.issue ? t("待人工处理") : t(rentalAllocationProgress(row).label)}</Tag>}</> },
        { title: t("操作"), fixed: "right", width: 115, render: (_, row) => <Button type="link" onClick={() => navigate(`/rental/orders/${row.id}`)}>{!canOperate ? t("查看") : row.status === "reserved" ? t("分配 / 锁定") : row.status === "ready_for_pickup" ? t("办理领取") : row.status === "renting" ? t("办理归还") : t("查看详情")}</Button> },
        { title: t("押金 / 预授权"), width: 150, render: (_, row) => `${formatRentalMoney(row.depositAmount, row.currency)} / ${formatRentalMoney(row.preAuthAmount, row.currency)}` },
        { title: t("状态"), fixed: "right", width: 110, dataIndex: "status", render: (value, row) => <Space orientation="vertical" size={0}>
          <Tag color={value === "completed" ? "success" : value === "cancelled" ? "default" : "processing"}>{t(statusLabels[value] ?? value)}</Tag>
          {hasPendingFeeReview(row) && <Tag color="orange">{t("待裁定费用")}</Tag>}
        </Space> }
      ]} /></QueryState>
    </Card>
  </>;
}
