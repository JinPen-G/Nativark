import { InfoCircleOutlined, PlusOutlined } from "@/components/ui/icons";
import type { RentalCoreOrderStatus, RentalOrder, RentalOrderAssignmentFilter, RentalOrderListQuery } from "@rental-os/shared";
import { RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE } from "@rental-os/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import { getCoreRowModel, useReactTable, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { Checkbox, EmptyScene } from "@/components/ui";
import { Alert, DataTable, ListTransferTools, ListSelectionBar, type ListExport, dataTableSelectionColumn, useDataTableSelection, DataTableToolbar, ListFilterItem, Button, DatePicker, Pagination, SearchField, Select, Tooltip } from "@/components/ui";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { currentSessionEpoch } from "@/app/queryClient";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@/app/designTokens";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { PageEnter } from "@/components/workspace/PageEnter";
import { useAuthStore } from "@/features/auth/authStore";
import { orderStatusLabels, rentalOrderColumns } from "./rentalOrderColumns";
import styles from "./RentalOrdersPage.module.css";

const statusLabels = orderStatusLabels;
const EMPTY_ORDERS: RentalOrder[] = [];
// Order-specific narrative minimum; shared lists inherit the same natural layout.
const ORDER_CONTENT_LAYOUT = {
  compactColumns: ["select", "orderNo", "payableAmount", "actions"],
  minimumWidths: { items: ADMIN_TABLE_COLUMN_WIDTH.summary }
};
/** 分配进度分段的显示文案 → 服务端筛选值。判据在服务端 SQL 里，与 `rentalAllocationProgress` 对应。 */
const assignmentFilterOptions: Array<{ label: string; value: RentalOrderAssignmentFilter | "all" }> = [
  { label: "全部分配", value: "all" },
  { label: "待分配", value: "pending" },
  { label: "部分分配", value: "partial" },
  { label: "待锁定", value: "unlocked" },
  { label: "已锁定", value: "locked" },
  { label: "分配异常", value: "issue" }
];

export function RentalOrdersPage() {
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const permissionKey = useAuthStore(s => ["operate", "pickup", "return", "extend", "cancel", "settle"].map(action => s.hasPermission(`rental-os:order:${action}`) ? "1" : "0").join(""));
  const permissions = useMemo(() => {
    const operate = permissionKey[0] === "1";
    return { operate, pickup: operate || permissionKey[1] === "1", return: operate || permissionKey[2] === "1",
      extend: operate || permissionKey[3] === "1", cancel: operate || permissionKey[4] === "1", settle: permissionKey[5] === "1" };
  }, [permissionKey]);
  const canCreate = useAuthStore((s) => s.hasPermission("rental-os:order:create"));
  const selectionScope = useAuthStore(s => JSON.stringify([s.tenant?.tenantId, s.currentWorkspaceId, s.user?.id]));
  const [rowSelection, setRowSelection] = useDataTableSelection(selectionScope);
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ createdAt: false, quoteNo: false, security: false, allocations: false, fulfillment: false });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

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
    pendingFeeOnly: pendingFeeOnly || undefined,
    sort: sorting.length ? sorting.map(sort => `${sort.id}.${sort.desc ? "desc" : "asc"}`).join(",") : undefined
  };
  const orders = useQuery({ queryKey: ["rental-core", "orders", query], queryFn: () => rentalCoreApi.orderPage(query), placeholderData: keepPreviousData });
  // 「待裁定」计数是当前空间的总数，不随列表筛选变化；只取 total，不取行。
  const pendingFeeCount = useQuery({ queryKey: ["rental-core", "orders", { pendingFeeOnly: true, pageSize: 1 }], queryFn: () => rentalCoreApi.orderPage({ pendingFeeOnly: true, pageSize: 1 }) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const rows = orders.data?.items ?? EMPTY_ORDERS;
  // Only a first load or another page's placeholder blocks existing controls.
  const waitingForRows = orders.isLoading || orders.isPlaceholderData;
  const total = orders.data?.total ?? 0;
  const exportConfig: ListExport<RentalOrder> = { filename: t("租赁订单"), scope: "filtered", fields: [
    { label: t("订单号"), value: row => row.orderNo }, { label: t("使用人"), value: row => row.membershipSnapshot?.personalCustomerName ?? row.customerName },
    { label: t("企业"), value: row => row.membershipSnapshot?.corporateCustomerName }, { label: t("计划取机"), value: row => row.startAt },
    { label: t("计划还机"), value: row => row.effectiveEndAt ?? row.endAt }, { label: t("应付"), value: row => Number.isFinite(row.payableAmount) ? row.payableAmount : undefined },
    { label: t("币种"), value: row => row.currency }, { label: t("状态"), value: row => t(statusLabels[row.status] ?? row.status) },
  ] };
  const loadExportRows = async () => {
    const epoch = currentSessionEpoch();
    const { page: _page, pageSize: _pageSize, ...filters } = query;
    const result = await rentalCoreApi.orderExportRows(filters);
    // Session aborts cancel the request; also prevent a completed old response from reaching a download.
    if (epoch !== currentSessionEpoch()) throw new Error("Export session changed");
    return result;
  };
  useEffect(() => { setRowSelection({}); }, [page, pageSize, assignment, keyword, status, query.from, query.to, pendingFeeOnly, JSON.stringify(sorting)]);
  const itemLabel = profile.data?.terminology.itemLabel ?? "商品";
  const pickupLabel = profile.data?.terminology.pickupLabel ?? "领取";
  const returnLabel = profile.data?.terminology.returnLabel ?? "归还";
  const columnLabels = useMemo<Record<string, string>>(() => ({
    orderNo: t("订单"), createdAt: t("创建时间"), customerName: t("使用人 / 主体"), items: t(itemLabel),
    startAt: t(`计划${pickupLabel}`), endAt: t(`计划${returnLabel}`),
    status: t("状态"), payableAmount: t("应付"), allocations: t("实际资源 / 分配"),
    fulfillment: t("取还地点"), security: t("押金 / 预授权"), quoteNo: t("报价快照"), actions: t("操作"),
  }), [t, itemLabel, pickupLabel, returnLabel]);
  const columns = useMemo(() => [
    dataTableSelectionColumn<RentalOrder>({ label: order => `${t("选择订单")} ${order.orderNo}`, disabled: waitingForRows || orders.isError }),
    ...rentalOrderColumns({ t, locale, now, permissions, pickupLabel, returnLabel, navigate, labels: columnLabels }),
  ], [t, locale, now, permissions, pickupLabel, returnLabel, navigate, columnLabels, waitingForRows, orders.isError]);
  const table = useReactTable({
    data: rows, columns, getRowId: order => order.id, getCoreRowModel: getCoreRowModel(),
    manualSorting: true, manualPagination: true, enableMultiSort: true,
    // Item disclosure belongs to the stable row ID, not remounted cell components.
    // The reminder clock/refresh must not collapse an operator's open item summary.
    getRowCanExpand: row => row.original.lines.length > 1, autoResetExpanded: false,
    enableRowSelection: !waitingForRows && !orders.isError,
    state: { sorting, columnVisibility, rowSelection }, onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: updater => { setSorting(updater); setPage(1); },
    initialState: { columnPinning: { right: ["actions"] } },
  });
  useEffect(() => { table.resetExpanded(true); }, [selectionScope, table]);
  /** 任何筛选条件变化都回到第一页，否则可能停在一个新条件下不存在的页码上。 */
  const applyFilter = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const localizedAssignmentFilterOptions = assignmentFilterOptions.map(({ label, value }) => ({ value, label: t(label) }));
  const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label: t(label) }));
  const hasFilters = assignment !== "all" || Boolean(keywordInput || keyword || status || period?.some(Boolean) || pendingFeeOnly);
  const searchNotApplied = keywordInput.trim() !== keyword;
  const clearFilters = () => {
    setAssignment("all"); setKeywordInput(""); setKeyword(""); setStatus(undefined);
    setPeriod(null); setPendingFeeOnly(false); setPage(1);
  };
  if (orders.isLoading) return <div className="route-loader"><LoadingState /></div>;
  return <PageEnter className={styles.page}>
    <PageHeader title="租赁订单" extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/rental/orders/new")}>{t("新建订单")}</Button>} />
      <div className={styles.filters} role="region" aria-label={t("订单筛选")}>
        <DataTableToolbar extra={<ListTransferTools config={exportConfig} rows={rows} loadExportRows={loadExportRows} busy={waitingForRows || orders.isError} />} table={table} label={id => columnLabels[id] ?? id} onRefresh={() => orders.refetch()} busy={waitingForRows} keyboardShortcut controls={<>
            <SearchField label={t("搜索订单")} placeholder={t("订单号、个人会员或企业名称，回车搜索")} value={keywordInput} onValueChange={(value) => { setKeywordInput(value); if (!value) applyFilter(setKeyword)(""); }} onSearch={(value) => applyFilter(setKeyword)(value.trim())} />
          <ListFilterItem label={t("租期范围")} active={Boolean(period?.some(Boolean))} width="dateRange" priority>
            <DatePicker.RangePicker value={period} onChange={applyFilter(setPeriod)} presets={[
          { label: t("今天"), value: (): [Dayjs, Dayjs] => [dayjs().startOf("day"), dayjs().endOf("day")] },
          { label: t("近 7 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")] },
          { label: t("本月"), value: (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")] },
          { label: t("近 30 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")] },
          { label: t("近 90 天"), value: (): [Dayjs, Dayjs] => [dayjs().subtract(89, "day").startOf("day"), dayjs().endOf("day")] }
            ]} />
          </ListFilterItem>
          <ListFilterItem label={t("分配进度")} active={assignment !== "all"} collapsed>
            <Select allowClear aria-label={t("分配进度")} placeholder={t("全部分配")} value={assignment === "all" ? undefined : assignment}
              onChange={value => applyFilter(setAssignment)((value ?? "all") as RentalOrderAssignmentFilter | "all")} options={localizedAssignmentFilterOptions.filter(option => option.value !== "all")} />
          </ListFilterItem>
          <ListFilterItem label={t("订单状态")} active={Boolean(status)} collapsed>
            <Select allowClear placeholder={t("全部状态")} aria-label={t("订单状态")} options={statusOptions} value={status} onChange={value => applyFilter(setStatus)(value as RentalCoreOrderStatus | undefined)} />
          </ListFilterItem>
          <ListFilterItem label={t("待裁定费用")} active={pendingFeeOnly} width="wide" collapsed>
          <div className={styles.feeCondition}>
            <div className={styles.feeToggle}>
            <Checkbox checked={pendingFeeOnly} onChange={(event) => applyFilter(setPendingFeeOnly)(event.target.checked)}>{t("只看有待审费用的订单")}</Checkbox>
            {pendingFeeCount.isFetching ? <span className={styles.feeNote}>{t("正在统计待裁定费用")}</span>
              : pendingFeeCount.isError ? <span className={styles.feeNote}>{t("待裁定数量暂不可用")} <Button type="link" size="small" onClick={() => void pendingFeeCount.refetch()}>{t("重试")}</Button></span>
                : pendingFeeCount.data && <Tag color="orange">{t("{count} 张待裁定", { count: pendingFeeCount.data.total })}</Tag>}
            </div>
            <Tooltip title={t("数量为当前空间总数，不随列表筛选变化。") }>
              <Button type="text" size="small" aria-label={t("数量统计口径")} icon={<InfoCircleOutlined />} />
            </Tooltip>
          </div>
          </ListFilterItem>
          <Button data-list-filter-reset size="small" type="text" disabled={!hasFilters} onClick={clearFilters}>{t("清除筛选")}</Button>
        </>} />
      </div>
      {searchNotApplied && <div className={styles.feedback}>
        <span className={styles.queryStatus}>{t("搜索词尚未应用，按回车搜索。")}</span>
      </div>}
      {orders.isError && <Alert className={styles.error} type="error" showIcon title={t("订单读取失败")} description={t("筛选条件已保留，请重试读取。")}
        action={<Button onClick={() => void orders.refetch()}>{t("重试")}</Button>} />}
      {(!orders.isError || rows.length > 0) &&
        <DataTable compactHeader contentLayout={ORDER_CONTENT_LAYOUT} table={table} caption={t("租赁订单")} busy={orders.isPlaceholderData} refreshing={orders.isFetching} loading={orders.isLoading} animated
          motionScope={JSON.stringify([selectionScope, page, pageSize, assignment, keyword, status, query.from, query.to, pendingFeeOnly])}
          empty={<EmptyScene compact scene={hasFilters ? 'search' : 'empty'} title={t(hasFilters ? "没有符合筛选条件的订单" : "暂无订单")}
            action={hasFilters ? <Button onClick={clearFilters}>{t('清除筛选')}</Button> : undefined} />}
          footer={<><Pagination current={page} pageSize={pageSize} total={total} showSizeChanger disabled={waitingForRows}
            showTotal={(count) => t(count === 1 ? "共 1 单" : "共 {count} 单", { count })}
            onChange={(nextPage, nextSize) => { if (nextSize !== pageSize) { setPageSize(nextSize); setPage(1); } else setPage(nextPage); }} /></>} />}
    <ListSelectionBar key={selectionScope} rows={rows.filter(row => rowSelection[row.id])} clear={() => setRowSelection({})} onSelectPage={() => table.toggleAllPageRowsSelected(true)} config={exportConfig} busy={waitingForRows || orders.isError} />
  </PageEnter>;
}
