/** Explicit administrator changes use current grants and a frozen original review.
 * Client preflight is not authorization; the server still revalidates and commits.
 * Original receipt recovery is historical only, never management/payment regranting. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ENTERPRISE_PORTAL_ACTIONS, type EnterpriseAdministratorView, type EnterpriseMemberView, type EnterprisePortalAction } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { enterpriseActionLabel } from "./enterprise-action-labels";

type AuthorityForm = { role: string; actions: EnterprisePortalAction[]; reason: string };
type AuthorityReview = { scope: string; memberUpdatedAt: string; value: EnterpriseAdministratorView };
const registeredActions = (value: unknown): value is EnterprisePortalAction[] => Array.isArray(value)
  && value.length <= ENTERPRISE_PORTAL_ACTIONS.length && new Set(value).size === value.length
  && value.every(action => typeof action === "string" && ENTERPRISE_PORTAL_ACTIONS.some(registered => registered === action));
const roleActionsMatch = (role: string, actions: EnterprisePortalAction[]) => (role === "admin" || role === "employee")
  && (role !== "employee" || actions.length === 0) && (actions.length === 0 || actions.includes("portal:enter"));
const materialKey = (value: EnterpriseAdministratorView) => JSON.stringify([value.membershipId, value.updatedAt, value.revision, value.role, value.actions]);
function originalAuthority(value: unknown, membershipId: string): EnterpriseAdministratorView | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Partial<EnterpriseAdministratorView>;
  if (row.membershipId !== membershipId || (row.role !== "admin" && row.role !== "employee")
    || !registeredActions(row.actions) || !roleActionsMatch(row.role, row.actions)
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt)
    || !Number.isFinite(Date.parse(row.updatedAt)) || new Date(row.updatedAt).toISOString() !== row.updatedAt) return undefined;
  // Neither a later query mutation nor the form's array may change this review.
  return { membershipId, role: row.role, actions: [...row.actions], updatedAt: row.updatedAt, revision: row.revision };
}
function saveActions(value: unknown, actorActions: EnterprisePortalAction[]): EnterprisePortalAction[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["role", "actions", "reason"].includes(key))) throw new Error("管理员表单字段无效，未创建原键 / Invalid authority form; no operation key created");
  const row = value as Partial<AuthorityForm>, actions = row.actions ?? [];
  if (typeof row.role !== "string" || !registeredActions(actions) || !roleActionsMatch(row.role, actions)
    || actions.some(action => !actorActions.includes(action)) || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500) throw new Error("角色、动作或原因无效，不能扩大当前授权；未创建原键 / Invalid role, actions or reason; no operation key created");
  return [...actions];
}
export function EnterpriseAdministratorEditor({ member, english, refresh }: { member: EnterpriseMemberView; english: boolean; refresh: () => Promise<void> }) {
  const context = useEnterprise(), operation = useOriginalWorkflowOperation("members"), [open, setOpen] = useState(false);
  const [form] = Form.useForm<AuthorityForm>(), [reviewed, setReviewed] = useState<AuthorityReview>();
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const actorActions = Array.isArray(corporate?.actions) ? corporate.actions : [];
  const allowed = registeredActions(actorActions) && actorActions.includes("members:manage") && actorActions.includes("administrators:manage");
  const path = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/members/${encodeURIComponent(member.membershipId)}/administrator`;
  const scope = JSON.stringify([context.identity, path, member.membershipId]);
  const query = useQuery({ queryKey: ["enterprise-administrator", context.identity, member.membershipId], enabled: Boolean(allowed && open),
    queryFn: ({ signal }) => operation.read<EnterpriseAdministratorView>(path, signal) });
  const current = originalAuthority(query.data, member.membershipId), currentKey = current && materialKey(current);
  const latest = useRef({ scope, open, allowed, memberUpdatedAt: member.updatedAt, current, reviewed, fetching: query.isFetching, queryError: Boolean(query.error), loading: Boolean(context.loading), actorActions });
  latest.current = { scope, open, allowed, memberUpdatedAt: member.updatedAt, current, reviewed, fetching: query.isFetching, queryError: Boolean(query.error), loading: Boolean(context.loading), actorActions: [...actorActions] };
  useEffect(() => { setOpen(false); setReviewed(undefined); form.resetFields(); }, [context.identity, member.membershipId]);
  useEffect(() => {
    if (open && allowed && !context.loading && !query.isFetching && !query.error && current && !reviewed) {
      setReviewed({ scope, memberUpdatedAt: member.updatedAt, value: current });
      form.setFieldsValue({ role: current.role, actions: [...current.actions], reason: "" });
    }
  }, [open, allowed, context.loading, query.isFetching, query.error, currentKey, reviewed, scope, member.updatedAt, form]);
  const changed = Boolean(reviewed && (reviewed.scope !== scope || reviewed.memberUpdatedAt !== member.updatedAt || !current || materialKey(reviewed.value) !== currentKey));
  if (!allowed && !operation.administratorChangeTarget) return null;
  const refreshCurrent = async () => { await query.refetch({ throwOnError: true }); await refresh(); operation.assertCurrent(); };
  return <>
    {allowed && !open && <Button disabled={operation.blocked || context.loading} onClick={() => { operation.assertCurrent(); setReviewed(undefined); setOpen(true); }}>{english ? "Administrator authority" : "管理员授权"}</Button>}
    {allowed && open && <>
      <Alert type="info" title={english ? "Promotion and action grants are explicit; never payment authority" : "晋升与管理动作分别显式授予，不授企业付款权"}
        description={english ? "Only your current actions may be delegated. Changing the relation invalidates older payment policies and unconsumed approvals." : "只能授予自己当前拥有的动作；关系改版会使旧员工付费政策及未消费批准失效，需重新核验。"} />
      {reviewed && <p>{english ? "Reviewed original relationship / UTC revision / portal version" : "已审阅原关系 / UTC 修订 / 门户版本"}: {reviewed.value.membershipId} / {reviewed.value.updatedAt} / {reviewed.value.revision}</p>}
      {changed && <Alert type="warning" title={english ? "Authority changed; review the current grants before reopening this editor" : "原授权已变化，核对当前授权后重新编辑；旧输入不自动绑定新修订"} />}
      {query.error ? <Alert type="error" title={english ? "Current authority could not be read; retain the original inputs" : "当前授权材料不可读取，保留原输入"} /> : !query.data ? <p>{english ? "Reading current grants" : "正在读取当前授权"}</p> : <>
        {!current && <Alert type="warning" title={english ? "Original authority material is unavailable; no operation can be prepared" : "原授权材料不可读取，不能准备新操作"} />}
        {reviewed && <Form form={form} layout="vertical" disabled={operation.blocked}>
          <Form.Item name="role" label={english ? "Role" : "关系角色"} rules={[{ required: true }]}><Select options={[{ value: "admin", label: english ? "Administrator" : "管理员" }, { value: "employee", label: english ? "Employee" : "员工" }]} onChange={value => { if (value === "employee") form.setFieldValue("actions", []); }} /></Form.Item>
          <Form.Item name="actions" label={english ? "Explicit management actions" : "明确管理动作"}><Select mode="multiple" options={actorActions.map(action => ({ value: action, label: enterpriseActionLabel(action, english) }))} /></Form.Item>
          <Form.Item name="reason" label={english ? "Reason" : "原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
          <SaveButton form={form} disabled={operation.blocked || context.loading || query.isFetching || changed || !current || !reviewed} label={english ? "Save administrator authority" : "保存管理员授权"} onSave={async () => {
            await operation.run(async () => {
              const original = reviewed, values = await form.validateFields(); operation.assertCurrent(); const now = latest.current;
              // validateFields yields. Do not use the earlier callback's stale query
              // flags, actor actions or target row to prepare a new durable K.
              if (!original || now.reviewed !== original || now.scope !== original.scope || !now.open || !now.allowed || now.loading || now.fetching || now.queryError
                || now.memberUpdatedAt !== original.memberUpdatedAt || !now.current || materialKey(now.current) !== materialKey(original.value)) throw new Error("原授权审阅修订已变化，请重新核对 / Original authority review changed");
              const actions = saveActions(values, now.actorActions);
              return { path, method: "PUT", input: { ...values, actions, expectedRevision: original.value.revision, expectedUpdatedAt: original.value.updatedAt } };
            }, async () => { await refresh(); setReviewed(undefined); setOpen(false); }, refreshCurrent);
            // Retire the verified original before reloading real current admission.
            operation.assertCurrent(); context.reload();
          }} />
        </Form>}
      </>}
      <Button disabled={operation.blocked} onClick={() => { setReviewed(undefined); setOpen(false); }}>{english ? "Cancel" : "取消"}</Button>
    </>}
    {operation.administratorChangeTarget && <Alert type="info" title={english ? "Original roles/actions are history; reading them does not restore management or payment authority." : "原角色/动作是历史；回读不恢复管理权或企业付费权。"} />}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original authority result" : "核对原授权结果"} onAction={async () => {
      if (!operation.administratorChangeTarget) { await operation.recover(async () => { await refresh(); setReviewed(undefined); setOpen(false); }); return; }
      const original = await operation.recover(async () => { setReviewed(undefined); setOpen(false); });
      if (original?.state === "committed") context.reload();
    }} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </>;
}
