/** Current relation edits and accepted administrator handoff, never personal profile changes.
 * The editor retains original period/revision; restoration does not regrant old authority. */
import { useEffect, useRef, useState } from "react";
import type { EnterpriseMemberView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
const utcInstant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function validateMemberEnd(value: string | undefined, originalFrom: string | undefined) {
  if (!utcInstant(originalFrom)) throw new Error("原关系生效时间不可读取，不能变更有效期 / Original relationship start unavailable");
  const end = value?.trim();
  if (!end) return;
  if (!utcInstant(end)) throw new Error("失效时间须为有效 UTC 毫秒 ISO 8601 / End time requires a valid UTC millisecond ISO instant");
  if (Date.parse(end) < Date.parse(originalFrom)) throw new Error("关系失效时间不能早于原生效时间 / End time precedes original start");
}
export function EnterpriseMemberLifecycle({ member, english, refresh }: { member: EnterpriseMemberView; english: boolean; refresh: () => Promise<void> }) {
  const context = useEnterprise(), [editing, setEditing] = useState(false), [reviewedUpdatedAt, setReviewedUpdatedAt] = useState<string>();
  const [reviewedFrom, setReviewedFrom] = useState<string>();
  const latestMember = useRef(member); latestMember.current = member;
  const [form] = Form.useForm<{ department?: string; employeeNo?: string; status: string; effectiveTo?: string; reason: string }>();
  const operation = useOriginalWorkflowOperation("members");
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const canManage = corporate?.actions.includes("members:manage") && (member.role !== "admin" || corporate.actions.includes("administrators:manage"));
  const canTransfer = corporate?.actions.includes("administrators:manage") && member.membershipId !== corporate.membershipId && member.status === "active";
  useEffect(() => { setEditing(false); setReviewedUpdatedAt(undefined); setReviewedFrom(undefined); form.resetFields(); }, [context.identity, member.membershipId]);
  if (!canManage && !canTransfer && !operation.transferInitiationCorporateId && !operation.memberChangeTarget) return null;
  const changed = async () => { await refresh(); operation.assertCurrent(); setEditing(false); };
  return <>
    {canManage && !editing && <Button disabled={operation.blocked} onClick={() => {
      operation.assertCurrent(); const original = latestMember.current;
      if (original.membershipId !== member.membershipId || original.updatedAt !== member.updatedAt) throw new Error("原成员已变化，请重新核对 / Original member changed");
      form.setFieldsValue({ department: original.department, employeeNo: original.employeeNo, status: original.status, effectiveTo: original.effectiveTo, reason: "" });
      setReviewedUpdatedAt(original.updatedAt); setReviewedFrom(original.effectiveFrom); setEditing(true);
    }}>{english ? "Edit relation" : "维护关系"}</Button>}
    {editing && <Form form={form} layout="vertical" disabled={operation.blocked}>
      <p>{english ? "Original effective start (UTC)" : "原生效时间（UTC）"}: {utcInstant(reviewedFrom) ? reviewedFrom : (english ? "Unavailable; reread the original relationship" : "不可读取，须重新核对原关系")}</p>
      <Form.Item name="department" label={english ? "Department" : "部门"}><Input maxLength={120} /></Form.Item>
      <Form.Item name="employeeNo" label={english ? "Employee number" : "工号"}><Input maxLength={80} /></Form.Item>
      <Form.Item name="status" label={english ? "Relation status" : "关系状态"} rules={[{ required: true }]}><Select options={[{ value: "active", label: english ? "Active" : "有效" }, { value: "suspended", label: english ? "Suspended" : "暂停" }, { value: "exited", label: english ? "Exited" : "终止关系" }]} /></Form.Item>
      <Form.Item name="effectiveTo" label={english ? "Optional end time, UTC ISO 8601" : "可选失效时间（UTC ISO 8601）"} dependencies={["status"]} rules={[{ validator: async (_, value) => validateMemberEnd(form.getFieldValue("status") === "exited" ? undefined : value, reviewedFrom) }]}><Input placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" /></Form.Item>
      <Form.Item name="reason" label={english ? "Reason" : "变更原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <Alert type="info" title={english ? "Suspension/exit invalidates new authority; history and personal membership remain" : "暂停或终止立即使新授权失效；个人会员和历史责任保留"} />
      <Alert type="warning" title={english ? "Saving changes the relationship revision. Restoring active or removing an end time does not restore old administrator grants, payment policies or unused approvals." : "保存会推进关系修订；恢复有效或清除失效时间，不恢复旧管理员授权、付费政策或未消费批准。"} />
      {reviewedUpdatedAt !== member.updatedAt && <Alert type="warning" title={english ? "The original relationship changed; reopen the editor after reviewing the current relationship" : "原关系已变化；核对当前关系后重新打开编辑，不把旧输入绑定到新修订"} />}
      <SaveButton form={form} disabled={operation.blocked || !reviewedUpdatedAt || reviewedUpdatedAt !== member.updatedAt || !utcInstant(reviewedFrom)} label={english ? "Save relation" : "保存关系"} onSave={() => operation.run(async () => {
        const values = await form.validateFields(); operation.assertCurrent(); const original = latestMember.current;
        if (!reviewedUpdatedAt || reviewedUpdatedAt !== original.updatedAt || original.membershipId !== member.membershipId || original.effectiveFrom !== reviewedFrom) throw new Error("原关系审阅修订已变化，请重新核对 / Relationship revision changed");
        validateMemberEnd(values.status === "exited" ? undefined : values.effectiveTo, reviewedFrom);
        return { path: `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/members/${encodeURIComponent(member.membershipId)}`, method: "PUT", input: { ...values,
          effectiveTo: values.status === "exited" ? undefined : values.effectiveTo?.trim() || undefined, expectedRevision: 0, expectedUpdatedAt: reviewedUpdatedAt } };
      }, changed, refresh)} />
      <Button disabled={operation.blocked} onClick={() => setEditing(false)}>{english ? "Cancel" : "取消"}</Button>
    </Form>}
    {canTransfer && <ActionButton disabled={operation.blocked} intent="confirm" label={english ? "Request administrator handoff" : "申请管理员交接"} onAction={() => operation.run(() => ({ path: `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/transfers`, input: { targetMembershipId: member.membershipId, expectedRevision: 0, reason: english ? "Request this verified member to accept administrator handoff" : "申请向已核验成员交接，须对方本人接受后生效" } }), refresh, refresh)} />}
    {operation.transferInitiationCorporateId && <Alert type="info" title={english ? "Read the original handoff request only. Its pending result does not mean it is still pending today or that administrator authority transferred." : "只核对原交接发起结果；原 pending 不代表今天仍待接受，也不代表管理员权已交接。"} />}
    {operation.memberChangeTarget && <Alert type="info" title={english ? "Read the original relationship change only, not today's status or restored authority." : "只核对原关系变更，不代表今日状态或旧授权已恢复。"} />}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={operation.transferInitiationCorporateId ? (english ? "Read original handoff request" : "核对原交接发起") : operation.memberChangeTarget ? (english ? "Read original member change" : "核对原关系变更") : (english ? "Read original relation result" : "核对原成员操作")} onAction={async () => {
      if (!operation.transferInitiationCorporateId && !operation.memberChangeTarget) { await operation.recover(changed); return; }
      const original = await operation.recover(async () => {});
      // Do not require today's member-list permission to retire a verified original.
      // Reload current admission only outside the gate, after the reference is retired.
      if (original?.state === "committed") context.reload();
    }} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </>;
}
