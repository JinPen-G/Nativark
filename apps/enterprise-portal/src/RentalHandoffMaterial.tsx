/** Original own-order material, explicit handoff requests and exact creation recovery.
 * Reading is not submission; recorded requests do not change Core, funds or grants. */
import { useEffect, useRef, useState } from "react";
import { enterpriseRentalHandoffMaterialSnapshot, type EnterpriseRentalHandoffMaterial, type EnterpriseRentalHandoffCreated } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Input } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
export function rentalHandoffMaterialSnapshot(value: unknown, orderId: string, workspaceCode: string): EnterpriseRentalHandoffMaterial {
  const material = enterpriseRentalHandoffMaterialSnapshot(value, orderId, workspaceCode);
  if (!material) throw new Error("原订单交接材料不可核对 / Original handoff material unavailable");
  return material;
}
export function EnterpriseRentalHandoffMaterialReview({ orderId, english }: { orderId: string; english: boolean }) {
  const context = useEnterprise(), operation = useOriginalWorkflowOperation("rental-handoff"), owner = useRef({ context, orderId }); owner.current = { context, orderId };
  const [reason, setReason] = useState(""), [submitted, setSubmitted] = useState<{ identity: string; value: EnterpriseRentalHandoffCreated }>();
  const confirmation = useRef<{ material: { scope: string; value: EnterpriseRentalHandoffMaterial }; reason: string } | undefined>(undefined);
  const workspaceCode = context.session?.workspace?.workspaceCode;
  const scope = JSON.stringify([context.identity, context.tenantCode, context.session?.customer.customerId, workspaceCode, orderId]);
  const currentScope = () => { const now = owner.current; return JSON.stringify([now.context.identity, now.context.tenantCode, now.context.session?.customer.customerId, now.context.session?.workspace?.workspaceCode, now.orderId]); };
  const mounted = useRef(true), epoch = useRef(0), active = useRef<AbortController | undefined>(undefined);
  const [result, setResult] = useState<{ scope: string; value: EnterpriseRentalHandoffMaterial }>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; active.current?.abort(); active.current = undefined; }; }, []);
  useEffect(() => { epoch.current++; active.current?.abort(); active.current = undefined; setResult(undefined); setError(""); setBusy(false); }, [scope]);
  const readable = Boolean(context.session?.customer.customerType === "personal" && reference(orderId) && reference(workspaceCode) && !context.loading && !context.signal.aborted);
  const visible = readable && !busy && !error && result?.scope === scope ? result : undefined;
  const latest = useRef({ visible, reason }); latest.current = { visible, reason };
  useEffect(() => { setReason(""); confirmation.current = undefined; setSubmitted(undefined); }, [scope]);
  const unavailable = english ? "Original enterprise/relationship material unavailable. Do not replace it with today's membership; no request was submitted." : "原企业或关系材料不可读取，不能用今天的成员资料补历史；未提交交接申请。";
  const read = async () => {
    if (!mounted.current || !readable || scope !== currentScope() || active.current || !reference(workspaceCode)) throw new Error(unavailable);
    const token = ++epoch.current, controller = new AbortController(), signal = context.signal;
    active.current = controller; latest.current.visible = undefined; confirmation.current = undefined; setResult(undefined); setError(""); setBusy(true);
    const isCurrent = () => mounted.current && epoch.current === token && scope === currentScope() && !owner.current.context.loading && owner.current.context.session?.customer.customerType === "personal" && !signal.aborted && !owner.current.context.signal.aborted && !controller.signal.aborted;
    try {
      const value = await context.read<EnterpriseRentalHandoffMaterial>(`/orders/${encodeURIComponent(orderId)}/enterprise-handoff-material`, AbortSignal.any([signal, controller.signal]));
      if (!isCurrent()) throw new Error(unavailable);
      setResult({ scope, value: rentalHandoffMaterialSnapshot(value, orderId, workspaceCode) });
    } catch { if (isCurrent()) { setResult(undefined); setError(unavailable); } throw new Error(unavailable); }
    finally { if (isCurrent()) setBusy(false); if (active.current === controller) active.current = undefined; }
  };
  const record = (value: EnterpriseRentalHandoffCreated) => { operation.assertCurrent(); setSubmitted({ identity: context.identity, value }); };
  const submit = async () => {
    const original = confirmation.current;
    const assertOriginal = () => { operation.assertCurrent(); if (!original || !original.reason.trim() || original.reason.length > 500 || scope !== currentScope()
      || latest.current.visible !== original.material || latest.current.reason !== original.reason || original.material.value.orderId !== orderId) throw new Error("原交接材料或原因已变化 / Original handoff material changed"); };
    assertOriginal();
    await operation.run<EnterpriseRentalHandoffCreated>(async () => {
      assertOriginal();
      const current = rentalHandoffMaterialSnapshot(await operation.read<EnterpriseRentalHandoffMaterial>(`/orders/${encodeURIComponent(orderId)}/enterprise-handoff-material`), orderId, workspaceCode!);
      assertOriginal(); if (JSON.stringify(current) !== JSON.stringify(original!.material.value)) throw new Error("原订单依据已变化，请重新核对 / Original order basis changed");
      return { path: `/enterprise/orders/${encodeURIComponent(orderId)}/handoff-requests`, input: { expectedRevision: 0, reason: original!.reason.trim(), confirm: true, materialKey: JSON.stringify(original!.material.value) } };
    }, async value => { record(value); if (latest.current.visible === original!.material) { setReason(""); confirmation.current = undefined; } });
  };
  const role = (value: string) => value === "personal" || value === "self" ? (english ? "This person" : "本人个人") : value === "corporate" ? (english ? "Original enterprise" : "原企业") : (english ? "Original basis unavailable" : "原依据不足");
  return <section aria-label={english ? "Original rental handoff material" : "原租赁交接材料"}>
    <ActionButton intent="review" label={english ? "Read original enterprise and responsibility basis" : "核对原企业与责任依据"} disabled={!readable || busy} onAction={read}/>
    {busy && <p role="status">{english ? "Reading original order basis" : "正在读取原订单依据"}</p>}
    {error && <Alert type="warning" title={error}/>}
    {visible && <dl>
      <dt>{english ? "Original enterprise" : "原企业引用"}</dt><dd>{visible.value.corporateCustomerId}</dd>
      <dt>{english ? "Original relationship" : "原关系引用"}</dt><dd>{visible.value.corporateMembershipId}</dd>
      <dt>{english ? "Original order revision (UTC)" : "原订单修订（UTC）"}</dt><dd>{visible.value.orderUpdatedAt}</dd>
      <dt>{english ? "Original identity resolution (UTC)" : "原身份解析时间（UTC）"}</dt><dd>{visible.value.membershipResolvedAt}</dd>
      <dt>{english ? "Historical relationship revision (UTC)" : "历史关系修订（UTC）"}</dt><dd>{visible.value.membershipUpdatedAt ?? (english ? "Not recorded" : "原记录未提供")}</dd>
      <dt>{english ? "Recorded contract subject" : "原记录签约主体类别"}</dt><dd>{role(visible.value.subjects.contract)}</dd>
      <dt>{english ? "Recorded payer subject" : "原记录付款主体类别"}</dt><dd>{role(visible.value.subjects.payer)}</dd>
      <dt>{english ? "Recorded user subject" : "原记录使用主体类别"}</dt><dd>{role(visible.value.subjects.user)}</dd>
      <dt>{english ? "Subject source" : "主体来源"}</dt><dd>{visible.value.subjectBasis === "legacy_customer_fallback" ? (english ? "Legacy original customer fallback" : "旧单原客户回落") : (english ? "Original order subject columns" : "原订单主体列")}</dd>
    </dl>}
    {visible && <>
      <label htmlFor="enterprise-rental-handoff-reason">{english ? "Handoff request reason" : "交接申请原因"}</label>
      <Input.TextArea id="enterprise-rental-handoff-reason" maxLength={500} value={reason} disabled={operation.blocked} onChange={event => { if (scope === currentScope()) { latest.current.reason = event.target.value; setReason(event.target.value); } }}/>
      <ConfirmAction disabled={operation.blocked || !reason.trim() || visible.value.subjects.user !== "self"} label={english ? "Submit handoff request" : "提交交接申请"}
        prompt={english ? "Record this original personal rental handoff request for merchant review? Orders, subjects, funding and enterprise exit are unchanged." : "记录本条本人原租赁交接申请供商户核对？不改变订单、主体、资金或退出授权。"}
        onStateChange={state => { if (state === "confirming") confirmation.current = { material: visible, reason }; else if (state === "idle" || state === "done") confirmation.current = undefined; }} onConfirm={submit}/>
    </>}
    {operation.pending && !operation.rentalHandoffWithdrawalId && <ActionButton intent="review" disabled={operation.busy || context.loading || !context.session || context.signal.aborted} label={english ? "Read original handoff creation" : "核对原交接创建"} onAction={async () => {
      const original = await operation.recover(async receipt => { if (receipt?.state === "committed" && receipt.result) record(receipt.result as unknown as EnterpriseRentalHandoffCreated); });
      if (!original && !operation.rentalHandoffOrderId) throw new Error("原交接引用不可核对 / Original handoff reference unavailable");
    }}/>}
    {!context.loading && !context.signal.aborted && submitted?.identity === context.identity && <Alert type="info" title={english ? "Original request creation verified; not merchant acceptance" : "原申请创建已核对，不代表商户受理"} description={`${submitted.value.id} / ${submitted.value.orderId}`} />}
    {operation.error && <Alert type="warning" title={operation.error}/>}
    <Alert type="info" title={english ? "Reading is not a request; only explicit submission records a handoff request" : "读取不等于申请，只有明确提交才记录交接请求"}
      description={english ? "Original enterprise identity is not current management authority or proof of payment. Unknown subject facts remain unavailable; orders, personal membership and original command references are unchanged." : "原企业身份不是当前管理权或实际付款证明。缺主体依据保持不可用，不改变订单、个人会员或原操作引用。"}/>
  </section>;
}
