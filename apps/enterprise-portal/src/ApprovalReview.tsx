/** Human-readable review of immutable quote fields, without current-profile fallback
 * or an inferred payment, guarantee source or settlement mode. */
import { formatRentalMoney, type EnterpriseBookingApprovalView } from "@rental-os/shared";
import { Alert, Table } from "@/components/ui/customer-entry";

export function approvalReviewKey(identity: string, row: EnterpriseBookingApprovalView) {
  return JSON.stringify([identity, row.id, row.revision, row.quoteId, row.state, row.amount, row.currency, row.quote]);
}
export function EnterpriseApprovalReview({ row, english }: { row: EnterpriseBookingApprovalView; english: boolean }) {
  const quote = row.quote, missing = english ? "Not recorded; verify with the merchant" : "原依据缺失，请向商户核对";
  const money = (value: number | null) => typeof value === "number" && Number.isFinite(value) && quote.currency ? `${formatRentalMoney(value, quote.currency)} ${quote.currency}` : missing;
  const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(english ? "en-US" : "zh-CN", { timeZoneName: "short" }) : missing;
  const fulfillment: Record<string, string> = english ? { self_pickup: "Self pickup", delivery: "Delivery", on_site: "On site" } : { self_pickup: "自取", delivery: "配送", on_site: "上门" };
  const totals: Array<[string, number | null]> = [
    [english ? "Rental" : "租金", quote.rentalAmount], [english ? "Discount" : "方案优惠", quote.discountAmount],
    [english ? "Coupon" : "优惠券", quote.couponAmount], [english ? "Services" : "增值服务", quote.serviceAmount],
    [english ? "Fulfillment" : "履约费用", quote.fulfillmentAmount], [english ? "Tax in original quote (not added again)" : "原报价税额（不重复加收）", quote.taxAmount],
    [english ? "Rental payable (excludes guarantees)" : "租赁应付（不含保证金）", quote.payableAmount],
  ];
  return <section className="enterprise-approval-review" aria-label={english ? "Original quote review" : "原报价审阅"}>
    <dl className="enterprise-review-facts">
      <dt>{english ? "Applicant / actual user" : "申请人／实际使用人"}</dt><dd>{quote.applicantName ?? missing} <small>{row.applicantCustomerId}</small></dd>
      <dt>{english ? "Contracting and paying enterprise" : "签约及付款企业"}</dt><dd>{quote.corporateName ?? missing} <small>{row.corporateCustomerId}</small></dd>
      <dt>{english ? "Workspace reference / category" : "经营空间引用／品类"}</dt><dd>{row.workspaceId} / {quote.categoryCode}</dd>
      <dt>{english ? "Quote" : "报价"}</dt><dd>{quote.quoteNo ?? row.quoteId}</dd>
      <dt>{english ? "Rental period" : "租期"}</dt><dd>{time(quote.startAt)} — {time(quote.endAt)}</dd>
      <dt>{english ? "Fulfillment" : "履约方式"}</dt><dd>{quote.fulfillmentMode ? fulfillment[quote.fulfillmentMode] ?? quote.fulfillmentMode : missing}</dd>
      <dt>{english ? "Purpose" : "用途"}</dt><dd>{row.purpose}</dd>
      <dt>{english ? "Quote expires" : "原报价到期"}</dt><dd>{time(quote.expiresAt)}</dd>
      <dt>{english ? "Approval expires" : "批准有效期"}</dt><dd>{time(row.expiresAt)}</dd>
      <dt>{english ? "Settlement" : "结算方式"}</dt><dd>{quote.settlementMode === "credit" ? english ? "Credit term, subject to Core gates" : "账期，仍须原 Core 资金门禁" : quote.settlementMode === "per_order" ? english ? "Per-order payment" : "逐单收款" : missing}</dd>
    </dl>
    <Table rowKey="index" caption={english ? "Original rental items" : "原租赁商品"} pagination={false} sorting={false} dataSource={quote.lines.map((line, index) => ({ ...line, index }))} columns={[
      { title: english ? "Item / pricing group" : "商品／定价分组", render: (_, line) => <>{line.pricingGroupName ?? line.itemGroupName ?? missing}<small>{line.itemGroupId ?? line.pricingGroupId}</small></> },
      { title: english ? "Quantity" : "数量", dataIndex: "quantity" },
    ]} />
    <dl className="enterprise-review-facts">{totals.map(([label, value]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
    <Table rowKey="index" caption={english ? "Original charge lines" : "原费用明细"} pagination={false} sorting={false} dataSource={quote.chargeLines.map((line, index) => ({ ...line, index }))} columns={[
      { title: english ? "Charge" : "费用", dataIndex: "name" }, { title: english ? "Amount" : "金额", render: (_, line) => money(line.amount) },
    ]} />
    <h3>{english ? "Guarantees are separate from rental charges" : "保证金与租赁费用分开"}</h3>
    <dl className="enterprise-review-facts">
      <dt>{english ? "Deposit quoted" : "原报价押金"}</dt><dd>{money(quote.depositAmount)}</dd>
      <dt>{english ? "Preauthorization quoted" : "原报价预授权额度"}</dt><dd>{money(quote.preAuthAmount)}</dd>
      <dt>{english ? "Contractual responsibility" : "承担主体依据"}</dt><dd>{quote.guaranteePayer === "enterprise" ? english ? "Enterprise default recorded in the original policy; not a payment receipt" : "原企业政策记录的企业承担默认，不是已付款收据" : missing}</dd>
    </dl>
    <Alert type="warning" title={english ? "Actual guarantee funding and contract reference are not recorded in this quote" : "本报价未记录保证金实际付款／预授权来源与独立合同引用"}
      description={english ? "Do not infer payment, a freeze or an employee-funded guarantee. Verify the arrangement with the merchant. Damage, overdue and other future charges remain subject to the original contract and formal determination." : "不能据此推断已付款、已冻结或员工保证金已获准。请向商户核对；损坏、超期等未来费用仍按原合同和正式裁定处理。"} />
  </section>;
}
