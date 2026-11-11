/** Enterprise order pages consume dedicated readers under current customer grants.
 * URL references only locate an order. Monetary values and identities stay tied
 * to original server facts, while changed sessions discard old responses. */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ENTERPRISE_ORDER_EXPORT_LIMIT, formatRentalMoney, type EnterpriseOrderDetail, type EnterpriseOrderDetailResponse,
  type EnterpriseOrderExportResponse, type EnterpriseOrderGroup,
  type EnterpriseOrderIndex, type EnterpriseOrderReadScope, type EnterpriseOrdersResponse } from "@rental-os/shared";
import { ActionButton, Alert, Button, ListFilters, ListSection, Select, Table } from "@/components/ui/customer-entry";
import { LoadingState } from "@/components/LoadingState";
import { ListTransferTools } from "@/components/ui/data-table/ListCapabilities";
import type { ListExport } from "@/components/ui/data-table/listTransfer";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";

const reference = (value: string) => /^[a-zA-Z0-9._:-]{1,191}$/u.test(value);
const timestamp = (value: string | null) => value ? value.replace("T", " ").replace("Z", " UTC") : "—";
function money(amount: number | null, currency: string | null) {
  return typeof amount === "number" && Number.isFinite(amount) && currency ? formatRentalMoney(amount, currency) : "—";
}

export function EnterpriseOrdersPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [parameters] = useSearchParams();
  const references = parameters.getAll("orderId"), orderId = references[0] ?? "";
  const invalidReference = references.length > 1 || references.length === 1 && !reference(orderId);
  const [group, setGroup] = useState<EnterpriseOrderGroup>("enterprise_paid");
  const [keyword, setKeyword] = useState(""), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const workspaceCode = context.session?.workspace?.workspaceCode;
  const allowed = Boolean(corporate?.actions.includes("orders:read") && workspaceCode);
  const identity = JSON.stringify([context.identity, workspaceCode, allowed]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const filterIdentity = JSON.stringify([identity, group, keyword]);
  const currentFilter = useRef(filterIdentity); currentFilter.current = filterIdentity;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const base = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/orders`;
  const list = useQuery({
    queryKey: ["enterprise-orders", identity, group, keyword, page, pageSize],
    enabled: allowed && !orderId && !invalidReference && !context.loading,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ group, keyword, page: String(page), pageSize: String(pageSize) });
      const result = await context.read<EnterpriseOrdersResponse>(`${base}?${query}`, AbortSignal.any([signal, context.signal]));
      verify(result, signal);
      if (result.group !== group || result.page !== page || result.pageSize !== pageSize || !Number.isSafeInteger(result.total)
        || result.total < 0 || !Array.isArray(result.items) || result.items.length > pageSize
        || result.items.some(row => !reference(row.orderId) || row.group !== group)) throw new Error(english ? "Order results cannot be verified" : "订单结果无法核对");
      return result;
    }
  });
  const detail = useQuery({
    queryKey: ["enterprise-order", identity, orderId],
    enabled: allowed && Boolean(orderId) && !invalidReference && !context.loading,
    queryFn: async ({ signal }) => {
      const result = await context.read<EnterpriseOrderDetailResponse>(`${base}/${encodeURIComponent(orderId)}`, AbortSignal.any([signal, context.signal]));
      verify(result, signal);
      if (result.order?.orderId !== orderId) throw new Error(english ? "Original order reference changed" : "原订单引用已变化");
      return result;
    }
  });
  function verify(result: EnterpriseOrderReadScope, signal: AbortSignal) {
    if (!mounted.current || signal.aborted || context.signal.aborted || currentIdentity.current !== identity || !corporate
      || result.apiVersion !== "v1" || result.coverage !== "current_workspace_authorized_enterprise_orders"
      || result.tenantCode !== context.tenantCode || result.corporateCustomerId !== corporate.corporateCustomerId
      || result.permissionRevision !== corporate.permissionRevision || result.workspaceCode !== workspaceCode) {
      throw new Error(english ? "Enterprise or customer workspace changed" : "企业授权或客户经营空间已变化");
    }
  }
  const refreshList = async () => { await list.refetch({ throwOnError: true }); };
  const refreshDetail = async () => { await detail.refetch({ throwOnError: true }); };
  const exportConfig: ListExport<EnterpriseOrderIndex> = { filename: `enterprise-orders-${group}`, scope: "filtered", fields: [
    { label: english ? "Order" : "订单号", value: row => row.orderNo },
    { label: english ? "Responsibility" : "费用归属", value: row => row.group === "enterprise_paid" ? english ? "Enterprise payment" : "企业承担" : english ? "Personal payment" : "企业优惠自费" },
    { label: english ? "Workspace" : "经营空间", value: () => workspaceCode },
    { label: english ? "Original user" : "原使用人", value: row => row.employeeName },
    { label: english ? "Category" : "品类", value: row => row.categoryCode },
    { label: english ? "Status" : "订单状态", value: row => row.status },
    { label: english ? "Rental start · UTC" : "租赁开始 · UTC", value: row => row.startAt },
    { label: english ? "Current return · UTC" : "当前约定归还 · UTC", value: row => row.currentReturnAt },
    { label: english ? "Original payable" : "原应付", value: row => row.payableAmount },
    { label: english ? "Adjusted payable" : "调整后应付", value: row => row.finalPayableAmount },
    { label: english ? "Currency" : "币种", value: row => row.currency }
  ] };
  const loadExportRows = async () => {
    if (currentFilter.current !== filterIdentity || !corporate?.actions.includes("export:create")) throw new Error("企业导出权限或条件已变化");
    const query = new URLSearchParams({ group, keyword });
    const result = await context.read<EnterpriseOrderExportResponse>(`${base}/export-rows?${query}`, context.signal);
    verify(result, context.signal);
    if (currentFilter.current !== filterIdentity || result.group !== group || result.maxRows !== ENTERPRISE_ORDER_EXPORT_LIMIT
      || !Array.isArray(result.items) || result.total !== result.items.length || result.total > result.maxRows
      || result.items.some(row => !reference(row.orderId) || row.group !== group)) throw new Error("完整企业订单导出结果无法核对");
    return result.items;
  };
  if (!allowed) return <Alert type="warning" title={english ? "Enterprise order access is unavailable" : "当前企业订单查看权限不可用"}
    action={<Button onClick={context.reload}>{english ? "Check access" : "重新核验权限"}</Button>} />;
  if (invalidReference) return <Alert type="error" title={english ? "Invalid order reference" : "订单引用无效"} />;
  const result = orderId ? detail : list;
  return <section className="enterprise-approval-review">
    <p>{english ? "Current customer workspace" : "当前客户经营空间"} · {context.session?.workspace?.workspaceName ?? workspaceCode}</p>
    <p>{english ? "Personal-payment enterprise orders use their recorded disclosure. Amounts retain each order's currency." : "企业优惠自费订单按原告知依据展示，金额沿各订单原币种。"}</p>
    {result.error ? <Alert type="error" title={result.error instanceof Error ? result.error.message : english ? "Order read failed" : "订单读取失败"}
      action={<ActionButton intent="refresh" label={english ? "Retry" : "重新读取"} onAction={orderId ? refreshDetail : refreshList} />} /> : orderId
      ? detail.data && <EnterpriseOrderDetails order={detail.data.order} english={english} refresh={refreshDetail} loading={detail.isFetching} back={`${context.basePath}/orders`} />
      : <ListSection title={group === "enterprise_paid" ? english ? "Enterprise-paid orders" : "企业承担订单" : english ? "Personal-payment enterprise orders" : "企业优惠自费订单"}
        controls={<><ListFilters filter={{ keyword, status: "", setKeyword: value => { setKeyword(value); setPage(1); }, setStatus: () => {}, clear: () => { setKeyword(""); setPage(1); } }}
          placeholder={english ? "Order number, user or item" : "订单号、使用人或商品"} />
          <Select aria-label={english ? "Payment responsibility" : "费用归属"} value={group} options={[
            { value: "enterprise_paid", label: english ? "Enterprise payment" : "企业承担" },
            { value: "personal_benefit", label: english ? "Corporate benefit, personal payment" : "企业优惠自费" }
          ]} onChange={value => { setGroup(value as EnterpriseOrderGroup); setPage(1); }} />
          {corporate?.actions.includes("export:create") && <ListTransferTools config={exportConfig} rows={list.data?.items ?? []}
            busy={list.isFetching} loadExportRows={loadExportRows} />}</>}>
        <Table<EnterpriseOrderIndex> rowKey="orderId" dataSource={list.data?.items ?? []} loading={list.isFetching} sorting={false} onRefresh={refreshList}
          pagination={list.data ? { current: page, pageSize, total: list.data.total, pageSizeOptions: [20, 50],
            onChange: (nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); } } : false}
          columns={[
            { title: english ? "Order" : "订单号", dataIndex: "orderNo" },
            { title: english ? "User at booking" : "原使用人", dataIndex: "employeeName", render: value => value ?? "—" },
            { title: english ? "Category" : "品类", dataIndex: "categoryCode" },
            { title: english ? "Rental period · UTC" : "租期 · UTC", render: (_, row) => <>{timestamp(row.startAt)}<br />{timestamp(row.currentReturnAt)}</> },
            { title: english ? "Status" : "订单状态", dataIndex: "status" },
            { title: english ? "Original payable" : "原应付", render: (_, row) => money(row.payableAmount, row.currency) },
            { title: english ? "Adjusted payable" : "调整后应付", render: (_, row) => money(row.finalPayableAmount, row.currency) },
            { title: english ? "Actions" : "操作", key: "actions", render: (_, row) => <Link to={`${context.basePath}/orders?${new URLSearchParams({ orderId: row.orderId })}`}
              onClick={event => { if (!mounted.current || context.signal.aborted || list.isFetching || currentIdentity.current !== identity) event.preventDefault(); }}>{english ? "View order" : "查看详情"}</Link> }
          ]} />
      </ListSection>}
    {orderId && !detail.data && detail.isFetching && <LoadingState />}
    {orderId && !detail.error && detail.data?.order.group === "enterprise_paid" && corporate?.actions.includes("finance:read")
      && <Link to={`${context.basePath}/finance?${new URLSearchParams({ orderId })}`}
        onClick={event => { if (context.signal.aborted || detail.isFetching || currentIdentity.current !== identity) event.preventDefault(); }}>{english ? "Read original financial records" : "核对原财务记录"}</Link>}
    {!orderId && group === "personal_benefit" && <p>{english ? "Personal payment. Excluded from enterprise receivables and credit." : "个人签约付款，不计企业应收或用信。"}</p>}
    {!orderId && corporate?.actions.includes("export:create") && <p>{english ? `Exports contain all matching orders, up to ${ENTERPRISE_ORDER_EXPORT_LIMIT} rows. Narrow the search for larger results.` : `导出当前筛选的完整订单，单次最多 ${ENTERPRISE_ORDER_EXPORT_LIMIT} 条，超出时请缩小筛选范围。`}</p>}
  </section>;
}

function EnterpriseOrderDetails({ order, english, refresh, loading, back }: {
  order: EnterpriseOrderDetail; english: boolean; refresh: () => Promise<void>; loading: boolean; back: string;
}) {
  const financialFacts: Array<[string, number | null]> = [
    [english ? "Rental" : "租金", order.rentalAmount], [english ? "Add-ons" : "增值服务", order.serviceAmount],
    [english ? "Fulfillment" : "履约费用", order.fulfillmentAmount], [english ? "Order discount" : "订单优惠", order.discountAmount],
    [english ? "Coupon" : "优惠券", order.couponAmount], [english ? "Adjustment" : "费用调整", order.adjustmentAmount],
    [english ? "Tax included" : "价内税", order.taxAmount], [english ? "Original payable" : "原应付", order.payableAmount],
    [english ? "Adjusted payable" : "调整后应付", order.finalPayableAmount]
  ];
  if (order.group === "enterprise_paid") financialFacts.push([english ? "Deposit target" : "应付押金", order.depositAmount], [english ? "Preauthorization target" : "应冻结额度", order.preAuthAmount]);
  return <>
    <Link to={back}>{english ? "Back to orders" : "返回订单列表"}</Link>
    <h2>{order.orderNo}</h2>
    <dl className="enterprise-review-facts">
      <dt>{english ? "Responsibility" : "费用归属"}</dt><dd>{order.group === "enterprise_paid" ? english ? "Enterprise contract and payment" : "企业签约付款" : english ? "Corporate benefit, personal contract and payment" : "企业优惠，个人签约付款"}</dd>
      <dt>{english ? "Original user" : "原使用人"}</dt><dd>{order.employeeName ?? "—"}</dd>
      <dt>{english ? "Original enterprise name" : "原企业名称"}</dt><dd>{order.corporateName ?? "—"}</dd>
      <dt>{english ? "Status" : "订单状态"}</dt><dd>{order.status}</dd>
      <dt>{english ? "Original rental period" : "原约定租期"}</dt><dd>{timestamp(order.startAt)} – {timestamp(order.endAt)}</dd>
      <dt>{english ? "Current return time" : "当前约定归还"}</dt><dd>{timestamp(order.currentReturnAt)}</dd>
      {financialFacts.map(([label, amount]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{money(amount, order.currency)}</dd></div>)}
    </dl>
    <p>{english ? "Contractual amounts and recorded fee adjustments. Payment, allocations and refunds require the enterprise finance reader." : "以上为原约定金额及已记录费用调整，回款、核销和退款沿企业财务原记录核对。"}</p>
    {order.group === "personal_benefit" && <p>{english ? "Personal payment. Excluded from enterprise receivables and credit." : "个人付款，不计企业应收或用信。"}</p>}
    <ListSection title={english ? "Items" : "商品明细"}><Table rowKey="lineId" dataSource={order.lines} pagination={false} sorting={false} loading={loading} onRefresh={refresh} columns={[
      { title: english ? "Item" : "商品", dataIndex: "itemGroupName" }, { title: english ? "Rate group" : "定价分组", dataIndex: "pricingGroupName" },
      { title: english ? "Quantity" : "原数量", dataIndex: "quantity" }, { title: english ? "Cancelled quantity" : "取消数量", dataIndex: "cancelledQuantity" },
      { title: english ? "Amount" : "原行金额", render: (_, row) => money(row.amount, order.currency) }
    ]} /></ListSection>
    <ListSection title={english ? "Recorded charges" : "费用明细"}><Table rowKey="sourceIndex" dataSource={order.chargeLines.map((charge, sourceIndex) => ({ ...charge, sourceIndex }))} pagination={false} sorting={false} loading={loading} onRefresh={refresh} columns={[
      { title: english ? "Charge" : "费用名称", dataIndex: "name" }, { title: english ? "Amount" : "金额", render: (_, row) => money(row.amount, order.currency) }
    ]} /></ListSection>
    {order.corporateBenefits?.length ? <ListSection title={english ? "Original corporate benefits" : "原企业权益"}><Table rowKey="sourceIndex"
      dataSource={order.corporateBenefits.map((benefit, sourceIndex) => ({ ...benefit, sourceIndex }))} pagination={false} sorting={false} loading={loading} onRefresh={refresh} columns={[
        { title: english ? "Plan at booking" : "原方案", dataIndex: "planName" }, { title: english ? "Applies to" : "作用费用", dataIndex: "appliesTo" },
        { title: english ? "Recorded reduction" : "原减免金额", render: (_, row) => money(row.appliedAmount, order.currency) }
      ]} /></ListSection> : order.corporateBenefits === null && <p>{english ? "Original corporate benefit details are unavailable" : "未记录原企业权益明细"}</p>}
    {order.disclosure && <p>{english ? "Original disclosure" : "原告知依据"} · {order.disclosure.noticeVersion} · {timestamp(order.disclosure.acknowledgedAt)}</p>}
  </>;
}
