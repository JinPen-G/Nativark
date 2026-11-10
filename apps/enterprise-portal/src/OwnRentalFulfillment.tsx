/** Explicit current-workspace personal fulfillment read through the original client API.
 * Not a corporate-order index, in-flight counter, handoff request or business permission. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { EnterpriseOwnRentalHandoffOrders } from "./OwnRentalHandoffOrders";
import type { ClientFulfillmentView } from "@rental-os/shared";
import { ActionButton, Alert, Input, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { EnterpriseRentalHandoffMaterialReview } from "./RentalHandoffMaterial";

const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
const text = (value: unknown, max = 191): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const orderStates = { draft: ["草稿", "Draft"], reserved: ["已预订", "Reserved"], pickup_overdue: ["逾期未取", "Pickup overdue"], ready_for_pickup: ["待领取", "Ready for pickup"], renting: ["租赁中", "Renting"], return_inspection: ["归还检查中", "Return inspection"], settling: ["结算中", "Settling"], completed: ["已完成", "Completed"], cancelled: ["已取消", "Cancelled"], no_show: ["未到场", "No-show"] } as const;
const allocationStates = { pre_assigned: ["预分配", "Pre-assigned"], locked: ["已锁定", "Locked"], allocated: ["已分配", "Allocated"], picked_up: ["已领取", "Picked up"], consumed: ["已消耗", "Consumed"], returned: ["已归还", "Returned"], released: ["已释放", "Released"] } as const;
const stateLabel = (state: string, english: boolean, allocation = false) => {
  const labels: Record<string, readonly string[]> = allocation ? allocationStates : orderStates;
  return Object.hasOwn(labels, state) ? labels[state][english ? 1 : 0] : (english ? "State unavailable" : "状态不可核对");
};

/** Copy the registered fulfillment fields only; absence is never zero, returned,
 * a corporate association or a completed handoff. Preserve original UTC instants. */
export function ownFulfillmentMaterial(value: unknown, orderId: string): ClientFulfillmentView {
  const invalid = () => new Error("本人履约原材料不可核对 / Original own fulfillment unavailable");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const row = value as Partial<ClientFulfillmentView>;
  if (!reference(orderId) || row.orderId !== orderId || !text(row.orderNo) || !row.orderNo.trim() || !text(row.status) || !Object.hasOwn(orderStates, row.status)
    || !text(row.fulfillmentMode) || !row.fulfillmentMode.trim() || !text(row.fulfillmentLocationName)
    || row.returnLocationName !== undefined && !text(row.returnLocationName) || !utc(row.startAt) || !utc(row.endAt)
    || row.effectiveEndAt !== undefined && !utc(row.effectiveEndAt) || !Array.isArray(row.allocations) || row.allocations.length > 200) throw invalid();
  const ids = new Set<string>();
  const allocations = row.allocations.map(item => {
    if (!item || !reference(item.id) || ids.has(item.id) || !reference(item.orderLineId) || typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0
      || !text(item.status) || !Object.hasOwn(allocationStates, item.status) || item.assetNo !== undefined && !text(item.assetNo)) throw invalid();
    ids.add(item.id);
    return { id: item.id, orderLineId: item.orderLineId, quantity: item.quantity, status: item.status, ...(item.assetNo === undefined ? {} : { assetNo: item.assetNo }) };
  });
  return { orderId, orderNo: row.orderNo, status: row.status, fulfillmentMode: row.fulfillmentMode, fulfillmentLocationName: row.fulfillmentLocationName,
    ...(row.returnLocationName === undefined ? {} : { returnLocationName: row.returnLocationName }), startAt: row.startAt, endAt: row.endAt,
    ...(row.effectiveEndAt === undefined ? {} : { effectiveEndAt: row.effectiveEndAt }), allocations };
}

export function EnterpriseOwnRentalFulfillment({ english }: { english: boolean }) {
  const context = useEnterprise(), owner = useRef(context); owner.current = context;
  const location = useLocation();
  const mounted = useRef(true), sequence = useRef(0), active = useRef<AbortController | undefined>(undefined);
  const [orderId, setOrderId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [material, setMaterial] = useState<{ identity: string; tenantCode: string; customerId: string; workspace: string; orderId: string; value: ClientFulfillmentView }>();
  const workspace = context.session?.workspace?.workspaceCode;
  const readable = Boolean(context.session?.customer.customerType === "personal" && reference(context.session.customer.customerId) && reference(workspace) && !context.loading && !context.signal.aborted);
  const current = useRef({ orderId, readable }); current.current = { orderId, readable };
  const scope = JSON.stringify([context.identity, context.tenantCode, context.session?.customer.customerId, workspace]);
  const currentScope = () => JSON.stringify([owner.current.identity, owner.current.tenantCode, owner.current.session?.customer.customerId, owner.current.session?.workspace?.workspaceCode]);
  const visible = readable && !busy && !error && material?.identity === context.identity && material.tenantCode === context.tenantCode && material.customerId === context.session?.customer.customerId && material.workspace === workspace && material.orderId === orderId ? material : undefined;
  const revoke = () => { sequence.current++; active.current?.abort(); active.current = undefined; setMaterial(undefined); setBusy(false); setError(""); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; active.current?.abort(); active.current = undefined; }; }, []);
  useEffect(() => { revoke(); setOrderId(""); }, [context.identity, workspace]);
  useEffect(() => {
    const values = new URLSearchParams(location.search).getAll("handoffOrderId");
    if (!values.length) return;
    revoke(); const id = values.length === 1 && reference(values[0]) ? values[0] : "";
    current.current.orderId = id; setOrderId(id);
  }, [location.search, context.identity, workspace]);
  const unavailable = english ? "This current-service personal order could not be verified. No handoff was submitted; keep original operation references." : "当前服务的本人订单未核对成功；未提交交接，请保留原操作引用。";
  const read = async () => {
    // A retained button belongs to its rendered locator and owner, not a later page.
    if (scope !== currentScope() || orderId !== current.current.orderId) throw new Error(unavailable);
    const original = owner.current, id = orderId, service = workspace, identity = original.identity;
    const tenantCode = original.tenantCode, customerId = original.session?.customer.customerId, signal = original.signal;
    if (!mounted.current || !current.current.readable || !reference(id) || !reference(customerId) || !reference(service) || active.current) throw new Error(unavailable);
    const token = ++sequence.current, controller = new AbortController(); active.current = controller;
    setMaterial(undefined); setError(""); setBusy(true);
    const isCurrent = () => mounted.current && sequence.current === token && owner.current.identity === identity && current.current.orderId === id && current.current.readable
      && owner.current.tenantCode === tenantCode && owner.current.session?.customer.customerId === customerId && owner.current.session?.workspace?.workspaceCode === service
      && !signal.aborted && !owner.current.signal.aborted && !controller.signal.aborted;
    try {
      const response = await original.read<ClientFulfillmentView>(`/orders/${encodeURIComponent(id)}/fulfillment`, AbortSignal.any([signal, controller.signal]));
      if (!isCurrent()) throw new Error(unavailable);
      const value = ownFulfillmentMaterial(response, id);
      setMaterial({ identity, tenantCode, customerId, workspace: service, orderId: id, value });
    } catch {
      if (isCurrent()) { setMaterial(undefined); setError(unavailable); }
      throw new Error(unavailable);
    } finally {
      if (isCurrent()) setBusy(false);
      if (active.current === controller) active.current = undefined;
    }
  };
  return <section aria-label={english ? "Current-service personal fulfillment review" : "当前服务本人履约核对"}>
    <EnterpriseOwnRentalHandoffOrders english={english}/>
    <h3>{english ? "Review an original personal rental" : "核对本人原租赁"}</h3>
    <Alert type="info" title={english ? "Current service and personal orders only; not an enterprise-order index" : "仅当前服务、原本人订单，不是企业订单索引"}
      description={english ? "Enter a reference from your original order. This read does not associate it with the reviewed enterprise relationship, count in-flight rentals, confirm enterprise funding or create a handoff task." : "请输入本人原订单引用。读取不把该订单归因到当前企业关系，不统计在途数量、不认定企业出资，也不生成交接待办。"}/>
    <p>{english ? "Authenticated service" : "当前认证服务"}: {workspace ?? (english ? "Unavailable" : "不可读取")}</p>
    <label htmlFor="enterprise-own-fulfillment-order">{english ? "Original personal order reference" : "本人原订单引用"}</label>
    <Input id="enterprise-own-fulfillment-order" value={orderId} maxLength={191} disabled={!readable} onChange={event => {
      if (!mounted.current || !current.current.readable || scope !== currentScope()) return;
      const value = event.target.value; revoke(); current.current.orderId = value; setOrderId(value);
    }}/>
    <ActionButton intent="review" label={english ? "Read original fulfillment" : "核对原履约"} disabled={!readable || !reference(orderId) || busy} onAction={read}/>
    {busy && <p role="status">{english ? "Reading the original personal fulfillment" : "正在读取本人原履约"}</p>}
    {error && <Alert type="warning" title={error}/>}
    <EnterpriseRentalHandoffMaterialReview orderId={orderId} english={english}/>
    {visible && <>
      <dl><dt>{english ? "Original order" : "原订单"}</dt><dd>{visible.value.orderNo} / {visible.value.orderId}</dd>
        <dt>{english ? "Current recorded state" : "当前记录状态"}</dt><dd>{stateLabel(visible.value.status, english)}</dd>
        <dt>{english ? "Recorded fulfillment mode" : "原履约方式"}</dt><dd>{visible.value.fulfillmentMode}</dd>
        <dt>{english ? "Pickup/delivery location" : "领取或配送地点"}</dt><dd>{visible.value.fulfillmentLocationName || (english ? "Not recorded" : "原记录未提供")}</dd>
        <dt>{english ? "Return location" : "归还地点"}</dt><dd>{visible.value.returnLocationName || (english ? "Not recorded" : "原记录未提供")}</dd>
        <dt>{english ? "Original start (UTC)" : "原约定开始（UTC）"}</dt><dd>{visible.value.startAt}</dd>
        <dt>{english ? "Original end (UTC)" : "原约定结束（UTC）"}</dt><dd>{visible.value.endAt}</dd>
        <dt>{english ? "Recorded effective end (UTC)" : "原记录生效截止（UTC）"}</dt><dd>{visible.value.effectiveEndAt ?? (english ? "Not provided in the original record" : "原记录未提供")}</dd></dl>
      <Table rowKey="id" sorting={false} pagination={false} dataSource={visible.value.allocations} columns={[
        { title: english ? "Original allocation" : "原分配引用", dataIndex: "id" }, { title: english ? "Original line" : "原商品行", dataIndex: "orderLineId" },
        { title: english ? "Recorded quantity" : "原记录数量", dataIndex: "quantity" }, { title: english ? "Recorded state" : "原记录状态", render: (_, item) => stateLabel(item.status, english, true) },
        { title: english ? "Original asset reference" : "原资产编号", render: (_, item) => item.assetNo || (english ? "Not recorded" : "原记录未提供") }
      ]}/>
      <p>{english ? "For ongoing responsibilities, use the merchant contact on this page. Reading or calling is not merchant acceptance, user reassignment, cancellation, refund or renewed enterprise authority." : "尚未处理的原责任请通过本页商户联系方式核对。读取或拨号不等于商户受理，不改使用人、取消、退款或恢复企业授权。"}</p>
    </>}
  </section>;
}
