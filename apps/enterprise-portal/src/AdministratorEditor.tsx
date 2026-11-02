/** Explicit administrator role/action changes; reads current grants and cannot enlarge the actor's rights. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseAdministratorView, EnterpriseMemberView, EnterprisePortalAction } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
const labels: Record<EnterprisePortalAction, [string, string]> = {
  "portal:enter": ["进入企业后台", "Enter portal"], "members:read": ["查看成员", "Read members"], "members:manage": ["维护成员", "Manage members"],
  "administrators:manage": ["管理管理员", "Manage administrators"], "invites:manage": ["管理邀请", "Manage invitations"], "policy:manage": ["管理政策", "Manage policies"],
  "approvals:review": ["审核付费申请", "Review approvals"], "orders:read": ["查看企业订单", "Read enterprise orders"], "finance:read": ["查看企业财务", "Read finances"],
  "requests:manage": ["管理资料申请", "Manage requests"], "audit:read": ["查看操作记录", "Read audit records"], "export:create": ["导出受权资料", "Export permitted data"]
};
export function EnterpriseAdministratorEditor({ member, english, refresh }: { member: EnterpriseMemberView; english: boolean; refresh: () => Promise<void> }) {
  const context = useEnterprise(), operation = useOriginalWorkflowOperation("members"), [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ role: string; actions: EnterprisePortalAction[]; reason: string }>(), [reviewed, setReviewed] = useState<EnterpriseAdministratorView>();
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const allowed = corporate?.actions.includes("members:manage") && corporate.actions.includes("administrators:manage");
  const path = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/members/${encodeURIComponent(member.membershipId)}/administrator`;
  const query = useQuery({ queryKey: ["enterprise-administrator", context.identity, member.membershipId], enabled: Boolean(allowed && open),
    queryFn: ({ signal }) => operation.read<EnterpriseAdministratorView>(path, signal) });
  useEffect(() => { setOpen(false); setReviewed(undefined); form.resetFields(); }, [context.identity, member.membershipId]);
  useEffect(() => {
    if (open && query.data && !reviewed) { setReviewed(query.data); form.setFieldsValue({ role: query.data.role, actions: query.data.actions, reason: "" }); }
  }, [open, query.data, reviewed, form]);
  const changed = Boolean(reviewed && query.data && (reviewed.updatedAt !== query.data.updatedAt || reviewed.revision !== query.data.revision));
  if (!allowed) return null;
  const refreshCurrent = async () => { await query.refetch({ throwOnError: true }); await refresh(); operation.assertCurrent(); };
  return <>
    {!open && <Button disabled={operation.blocked} onClick={() => { operation.assertCurrent(); setReviewed(undefined); setOpen(true); }}>{english ? "Administrator authority" : "管理员授权"}</Button>}
    {open && <>
      <Alert type="info" title={english ? "Promotion and action grants are explicit; never payment authority" : "晋升与管理动作分别显式授予，不授企业付款权"}
        description={english ? "Only your current actions may be delegated. Changing the relation invalidates older payment policies and unconsumed approvals." : "只能授予自己当前拥有的动作；关系改版会使旧员工付费政策及未消费批准失效，需重新核验。"} />
      {changed && <Alert type="warning" title={english ? "Authority changed; review the current grants before reopening this editor" : "原授权已变化，核对当前授权后重新编辑；旧输入不自动绑定新修订"} />}
      {query.error ? <Alert type="error" title={query.error instanceof Error ? query.error.message : "读取失败"} /> : !query.data ? <p>{english ? "Reading current grants" : "正在读取当前授权"}</p> : <Form form={form} layout="vertical" disabled={operation.blocked}>
        <Form.Item name="role" label={english ? "Role" : "关系角色"} rules={[{ required: true }]}><Select options={[{ value: "admin", label: english ? "Administrator" : "管理员" }, { value: "employee", label: english ? "Employee" : "员工" }]} onChange={value => { if (value === "employee") form.setFieldValue("actions", []); }} /></Form.Item>
        <Form.Item name="actions" label={english ? "Explicit management actions" : "明确管理动作"}><Select mode="multiple" options={corporate!.actions.map(action => ({ value: action, label: labels[action][english ? 1 : 0] }))} /></Form.Item>
        <Form.Item name="reason" label={english ? "Reason" : "原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
        <SaveButton form={form} disabled={operation.blocked || query.isFetching || changed || !reviewed} label={english ? "Save administrator authority" : "保存管理员授权"} onSave={() => operation.run(async () => {
          const values = await form.validateFields(); operation.assertCurrent(); const current = reviewed;
          if (!current || changed || query.isFetching || query.error) throw new Error("原授权审阅修订已变化，请重新核对");
          return { path, method: "PUT", input: { ...values, actions: values.actions ?? [], expectedRevision: current.revision, expectedUpdatedAt: current.updatedAt } };
        }, async () => { await refresh(); setReviewed(undefined); setOpen(false); }, refreshCurrent)} />
      </Form>}
      <Button disabled={operation.blocked} onClick={() => { setReviewed(undefined); setOpen(false); }}>{english ? "Cancel" : "取消"}</Button>
    </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original authority result" : "核对原授权结果"} onAction={() => operation.recover(async () => { await refresh(); setReviewed(undefined); setOpen(false); })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </>;
}
