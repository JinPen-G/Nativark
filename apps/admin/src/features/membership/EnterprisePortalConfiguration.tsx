/** Explicit merchant activation and action grants. Never rental, credit or payment authority. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ENTERPRISE_PORTAL_ACTIONS } from "@rental-os/shared";
import type { EnterprisePortalAction, EnterprisePortalConfiguration as Configuration } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, Form, Input, SaveButton, Select } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { membershipApi } from "@/api/membership";
import { portalAccessGrants, type PortalAccessForm } from "./enterprise-portal-config";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";

const actionLabels: Record<EnterprisePortalAction, [string, string]> = {
  "portal:enter": ["企业后台入口", "Portal entry"],
  "members:read": ["查看企业成员", "View members"],
  "members:manage": ["维护企业成员", "Manage members"],
  "administrators:manage": ["管理企业管理员", "Manage administrators"],
  "invites:manage": ["管理加入邀请", "Manage invitations"],
  "policy:manage": ["管理企业租赁政策", "Manage rental policies"],
  "approvals:review": ["审核企业付费申请", "Review payment approvals"],
  "orders:read": ["查看企业订单", "View enterprise orders"],
  "finance:read": ["查看企业财务", "View enterprise finances"],
  "requests:manage": ["管理企业资料与核对申请", "Manage enterprise requests"],
  "audit:read": ["查看企业操作记录", "View enterprise audit records"],
  "export:create": ["导出受权企业资料", "Export permitted enterprise data"],
};
const extraActions = ENTERPRISE_PORTAL_ACTIONS.filter(action => action !== "portal:enter" && action !== "members:read");

export function EnterprisePortalConfiguration({ corporateCustomerId }: { corporateCustomerId: string }) {
  const { locale } = useLocale(), english = locale === "en-US";
  const auth = useAuthStore();
  const permitted = auth.hasTenantMembershipPermission("rental-os:corporate:manage") && auth.hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const canRead = ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"].some(permission => auth.hasTenantMembershipPermission(permission));
  const operation = useOriginalEnterpriseOperation(`portal-access:${corporateCustomerId}`, "/membership/enterprise-portal/operations");
  const [form] = Form.useForm<PortalAccessForm>();
  const [open, setOpen] = useState(false);
  const path = `/membership/corporate/${encodeURIComponent(corporateCustomerId)}/enterprise-portal`;
  const config = useQuery({ queryKey: ["enterprise-portal-config", operation.identity], enabled: canRead,
    queryFn: ({ signal }) => operation.read<Configuration>(path, signal) });
  const members = useQuery({ queryKey: ["enterprise-portal-admins", operation.identity], enabled: permitted && open,
    queryFn: () => membershipApi.corporateEmployees(corporateCustomerId) });
  useEffect(() => { setOpen(false); form.resetFields(); }, [operation.identity, corporateCustomerId]);
  const settings = config.data;
  const refresh = async () => { operation.assertCurrent(); await config.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const save = () => operation.run(async () => {
    if (!permitted || !settings) throw new Error("Operation unavailable");
    const values = await form.validateFields();
    return { path, method: "put", input: { enabled: values.enabled, expectedRevision: settings.revision,
      reason: values.reason, grants: portalAccessGrants(values, settings.grants) } };
  }, async () => { await refresh(); setOpen(false); }, refresh);
  const enableTenant = () => operation.run(() => {
    if (!permitted || !settings) throw new Error("Operation unavailable");
    return { path: "/membership/enterprise-portal/settings", method: "put", input: { enabled: true,
      expectedRevision: settings.tenantRevision, reason: english ? "Enable enterprise portal entry" : "显式开启企业客户后台入口" } };
  }, async () => { await refresh(); }, refresh);
  const grantIds = settings?.grants.map(grant => grant.membershipId) ?? [];
  const options = [...new Set([...(members.data ?? []).filter(member => member.role === "admin" && member.status === "active").map(member => member.id), ...grantIds])].map(id => {
    const member = members.data?.find(value => value.id === id);
    return { value: id, label: member?.personalCustomerName ?? member?.personalCustomerId ?? id };
  });
  return <section>
    <h3>{english ? "Enterprise portal access" : "企业后台开通"}</h3>
    {!canRead ? <Alert type="warning" title={english ? "Portal configuration is not permitted" : "缺少企业门户配置读取权限"} /> :
      config.error ? <Alert type="error" title={english ? "Cannot read portal configuration" : "企业后台配置读取失败"}
        action={<ActionButton disabled={operation.busy} intent="review" label={english ? "Read again" : "重新读取"} onAction={refresh} />} /> :
      !settings ? <p>{english ? "Loading" : "读取中"}</p> : <>
        <p>{settings.tenantEnabled ? english ? "Merchant portal enabled" : "商户企业服务已开启" : english ? "Merchant portal not enabled" : "商户企业服务未开启"} / {settings.enabled ? english ? "Enterprise enabled" : "本企业已开启" : english ? "Enterprise not enabled" : "本企业未开启"}</p>
        <Alert type="info" title={english ? "Existing administrator roles do not activate this portal." : "现有管理员角色不会自动开通企业后台。"}
          description={english ? "Grant management actions separately. Registered actions do not imply connected services, credit or rental execution authority." : "管理动作分别授权；动作登记不等于业务已接通，不授予价格、授信或实际租赁执行权。"} />
        {permitted && !settings.tenantEnabled && <ActionButton disabled={operation.blocked} intent="confirm" label={english ? "Enable merchant enterprise service" : "开启商户企业服务"} onAction={enableTenant} />}
        {!open && <Button disabled={!permitted || operation.blocked} onClick={() => {
          operation.assertCurrent();
          form.setFieldsValue({ enabled: settings.enabled,
            entryMembershipIds: settings.grants.filter(grant => grant.actions.includes("portal:enter")).map(grant => grant.membershipId),
            memberMembershipIds: settings.grants.filter(grant => grant.actions.includes("members:read")).map(grant => grant.membershipId), reason: "",
            actionMembershipIds: Object.fromEntries(extraActions.map(action => [action, settings.grants.filter(grant => grant.actions.includes(action)).map(grant => grant.membershipId)])) });
          setOpen(true);
        }}>{english ? "Configure enterprise access" : "配置企业授权"}</Button>}
        {open && <Form form={form} layout="vertical" disabled={operation.blocked}>
          {members.error && <Alert type="error" title={english ? "Administrator list unavailable; original grants remain visible" : "管理员列表读取失败；保留原授权，不以空列表覆盖"} />}
          <Form.Item name="enabled" valuePropName="checked"><Checkbox>{english ? "Enable this enterprise" : "开启本企业后台"}</Checkbox></Form.Item>
          <Form.Item name="entryMembershipIds" label={actionLabels["portal:enter"][english ? 1 : 0]}><Select mode="multiple" options={options} /></Form.Item>
          <Form.Item name="memberMembershipIds" label={actionLabels["members:read"][english ? 1 : 0]}><Select mode="multiple" options={options} /></Form.Item>
          {extraActions.map(action => <Form.Item key={action} name={["actionMembershipIds", action]} label={actionLabels[action][english ? 1 : 0]}><Select mode="multiple" options={options} /></Form.Item>)}
          <Form.Item name="reason" label={english ? "Reason" : "变更原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
          <SaveButton form={form} disabled={operation.blocked} label={english ? "Save access" : "保存授权"} onSave={save} />
          <Button disabled={operation.blocked} onClick={() => setOpen(false)}>{english ? "Cancel" : "取消"}</Button>
        </Form>}
      </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original access result" : "核对原授权操作"}
      onAction={() => operation.recover(async originalPath => { await refresh(); if (originalPath === path) setOpen(false); })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
