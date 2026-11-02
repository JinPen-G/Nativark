/** Current relation edits and accepted administrator handoff, never personal profile changes. */
import { useEffect, useState } from "react";
import type { EnterpriseMemberView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
export function EnterpriseMemberLifecycle({ member, english, refresh }: { member: EnterpriseMemberView; english: boolean; refresh: () => Promise<void> }) {
  const context = useEnterprise(), [editing, setEditing] = useState(false), [reviewedUpdatedAt, setReviewedUpdatedAt] = useState<string>();
  const [form] = Form.useForm<{ department?: string; employeeNo?: string; status: string; effectiveTo?: string; reason: string }>();
  const operation = useOriginalWorkflowOperation("members");
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const canManage = corporate?.actions.includes("members:manage") && (member.role !== "admin" || corporate.actions.includes("administrators:manage"));
  const canTransfer = corporate?.actions.includes("administrators:manage") && member.membershipId !== corporate.membershipId && member.status === "active";
  useEffect(() => { setEditing(false); setReviewedUpdatedAt(undefined); form.resetFields(); }, [context.identity, member.membershipId]);
  if (!canManage && !canTransfer) return null;
  const changed = async () => { await refresh(); operation.assertCurrent(); setEditing(false); };
  return <>
    {canManage && !editing && <Button disabled={operation.blocked} onClick={() => { operation.assertCurrent(); form.setFieldsValue({ department: member.department, employeeNo: member.employeeNo, status: member.status, effectiveTo: member.effectiveTo, reason: "" }); setReviewedUpdatedAt(member.updatedAt); setEditing(true); }}>{english ? "Edit relation" : "维护关系"}</Button>}
    {editing && <Form form={form} layout="vertical" disabled={operation.blocked}>
      <Form.Item name="department" label={english ? "Department" : "部门"}><Input maxLength={120} /></Form.Item>
      <Form.Item name="employeeNo" label={english ? "Employee number" : "工号"}><Input maxLength={80} /></Form.Item>
      <Form.Item name="status" label={english ? "Relation status" : "关系状态"} rules={[{ required: true }]}><Select options={[{ value: "active", label: english ? "Active" : "有效" }, { value: "suspended", label: english ? "Suspended" : "暂停" }, { value: "exited", label: english ? "Exited" : "终止关系" }]} /></Form.Item>
      <Form.Item name="effectiveTo" label={english ? "Optional end time, ISO 8601" : "可选失效时间（ISO 8601）"}><Input /></Form.Item>
      <Form.Item name="reason" label={english ? "Reason" : "变更原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <Alert type="info" title={english ? "Suspension/exit invalidates new authority; history and personal membership remain" : "暂停或终止立即使新授权失效；个人会员和历史责任保留"} />
      {reviewedUpdatedAt !== member.updatedAt && <Alert type="warning" title={english ? "The original relationship changed; reopen the editor after reviewing the current relationship" : "原关系已变化；核对当前关系后重新打开编辑，不把旧输入绑定到新修订"} />}
      <SaveButton form={form} disabled={operation.blocked || !reviewedUpdatedAt || reviewedUpdatedAt !== member.updatedAt} label={english ? "Save relation" : "保存关系"} onSave={() => operation.run(async () => { const values = await form.validateFields(); operation.assertCurrent(); if (!reviewedUpdatedAt || reviewedUpdatedAt !== member.updatedAt) throw new Error("原关系审阅修订已变化，请重新核对 / Relationship revision changed"); return { path: `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/members/${encodeURIComponent(member.membershipId)}`, method: "PUT", input: { ...values, effectiveTo: values.effectiveTo?.trim() || undefined, expectedRevision: 0, expectedUpdatedAt: reviewedUpdatedAt } }; }, changed, refresh)} />
      <Button disabled={operation.blocked} onClick={() => setEditing(false)}>{english ? "Cancel" : "取消"}</Button>
    </Form>}
    {canTransfer && <ActionButton disabled={operation.blocked} intent="confirm" label={english ? "Request administrator handoff" : "申请管理员交接"} onAction={() => operation.run(() => ({ path: `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/transfers`, input: { targetMembershipId: member.membershipId, expectedRevision: 0, reason: english ? "Request this verified member to accept administrator handoff" : "申请向已核验成员交接，须对方本人接受后生效" } }), refresh, refresh)} />}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original relation result" : "核对原成员操作"} onAction={() => operation.recover(changed)} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </>;
}
