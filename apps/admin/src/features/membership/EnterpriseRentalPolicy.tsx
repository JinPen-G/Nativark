/** Merchant upper bounds editor; no default activation, credit or payment effects. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseScopePolicyView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, SaveButton } from "@/components/ui";
import { EnterprisePolicyFields, enterprisePolicyPayload, enterprisePolicyValues, type EnterprisePolicyForm } from "@/components/EnterprisePolicyFields";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";
export function EnterpriseRentalPolicy({ corporateCustomerId }: { corporateCustomerId: string }) {
  const auth = useAuthStore(), { locale } = useLocale(), english = locale === "en-US";
  const permitted = auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const operation = useOriginalEnterpriseOperation(corporateCustomerId), [form] = Form.useForm<EnterprisePolicyForm>(), [editing, setEditing] = useState(false);
  const path = `/membership/enterprise-workflows/corporates/${encodeURIComponent(corporateCustomerId)}/policy`;
  const policy = useQuery({ queryKey: ["enterprise-rental-upper", operation.identity, corporateCustomerId], enabled: permitted,
    queryFn: () => operation.read<EnterpriseScopePolicyView>(path) });
  useEffect(() => { setEditing(false); form.resetFields(); }, [operation.identity, corporateCustomerId]);
  const refresh = async () => { await policy.refetch({ throwOnError: true }); operation.assertCurrent(); };
  if (!permitted) return <Alert type="warning" title={english ? "Merchant policy management is not permitted" : "缺少商户企业管理权限"} />;
  const view = policy.data;
  return <section><h3>{english ? "Enterprise rental upper bounds" : "企业租赁上限"}</h3>
    <Alert type="info" title={english ? "Separate from portal access and credit" : "入口授权、租赁上限和授信分别配置"} description={english ? "No policy means no new enterprise rental. Saving does not activate a member's payment authority, approve an order or waive a deposit." : "未配置时新企业身份业务不可用；保存不自动授员工付费权、不批准订单、不免押。告知为纯文本，由企业政策沿用。"} />
    {policy.error ? <Alert type="error" title={policy.error instanceof Error ? policy.error.message : "读取失败"} action={<Button onClick={() => void refresh()}>{english ? "Read again" : "重新读取"}</Button>} /> : !view ? <p>{english ? "Reading policy" : "正在读取政策"}</p> : <>
      <p>{english ? "Merchant policy revision" : "商户政策修订"}：{view.merchantRevision}</p>
      {!view.merchant && <Alert type="warning" title={english ? "Upper bounds not configured" : "尚未配置上限；新企业业务不可用"} />}
      {!editing ? <Button disabled={operation.blocked} onClick={() => { operation.assertCurrent(); form.setFieldsValue(enterprisePolicyValues(view.merchant)); setEditing(true); }}>{english ? "Configure upper bounds" : "配置租赁上限"}</Button> : <Form form={form} layout="vertical" disabled={operation.blocked}>
        <EnterprisePolicyFields view={view} merchant english={english} />
        <SaveButton form={form} disabled={operation.blocked} label={english ? "Save upper bounds" : "保存租赁上限"} onSave={() => operation.run(async () => { const values = await form.validateFields(); return { path, method: "put", input: { policy: enterprisePolicyPayload(values), expectedRevision: view.merchantRevision, reason: values.reason } }; }, async () => { await refresh(); setEditing(false); }, refresh)} />
        <Button disabled={operation.blocked} onClick={() => setEditing(false)}>{english ? "Cancel" : "取消"}</Button>
      </Form>}
    </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original policy result" : "核对原政策操作"} onAction={() => operation.recover(async () => { await refresh(); setEditing(false); })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
