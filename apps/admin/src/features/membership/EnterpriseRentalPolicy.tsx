/** Merchant upper bounds editor keeps reviewed material and input separate from current reads.
 * Original receipts never activate employees, credit, payment or rental execution. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseScopePolicyView, SaveEnterpriseScopePolicyRequest } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, SaveButton } from "@/components/ui";
import { EnterprisePolicyFields, enterprisePolicyValues, type EnterprisePolicyForm } from "@/components/EnterprisePolicyFields";
import { copyEnterprisePolicy, copyEnterprisePolicyView, captureEnterprisePolicyInput } from "@/components/enterprise-policy-material";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";

const changedMaterial = () => new Error("原商户政策材料、对象或修订已变化，请重新审阅 / Original merchant policy material or target changed");
export function EnterpriseRentalPolicy({ corporateCustomerId }: { corporateCustomerId: string }) {
  const auth = useAuthStore(), { locale } = useLocale(), english = locale === "en-US";
  const permitted = auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const operation = useOriginalEnterpriseOperation(corporateCustomerId), [form] = Form.useForm<EnterprisePolicyForm>();
  const path = `/membership/enterprise-workflows/corporates/${encodeURIComponent(corporateCustomerId)}/policy`, scope = JSON.stringify([operation.identity, corporateCustomerId, path]);
  const [reviewed, setReviewed] = useState<{ scope: string; view: EnterpriseScopePolicyView; key: string }>();
  const [observed, setObserved] = useState<{ scope: string; revision: number }>();
  const policy = useQuery({ queryKey: ["enterprise-rental-upper", operation.identity, corporateCustomerId], enabled: permitted,
    queryFn: () => operation.read<EnterpriseScopePolicyView>(path) });
  let view: EnterpriseScopePolicyView | undefined;
  try { view = copyEnterprisePolicyView(policy.data); } catch { /* Missing/bad material is not an empty policy. */ }
  const original = reviewed?.scope === scope ? reviewed : undefined, key = view && JSON.stringify(view);
  const changed = Boolean(original && original.key !== key);
  const latest = useRef({ scope, path, original, policy, auth }); latest.current = { scope, path, original, policy, auth };
  useEffect(() => { setReviewed(undefined); setObserved(undefined); form.resetFields(); }, [operation.identity, corporateCustomerId]);
  const refresh = async () => { await policy.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const beginEdit = () => {
    operation.assertCurrent(); const now = latest.current, current = copyEnterprisePolicyView(now.policy.data);
    if (now.scope !== scope || !now.auth.hasTenantMembershipPermission("rental-os:corporate:manage") || now.policy.isFetching || now.policy.error || !view || !current || JSON.stringify(current) !== key) throw changedMaterial();
    form.resetFields(); form.setFieldsValue(enterprisePolicyValues(copyEnterprisePolicy(view.merchant)));
    setReviewed({ scope, view, key: JSON.stringify(view) });
  };
  const assertOriginal = () => {
    operation.assertCurrent(); const now = latest.current, current = copyEnterprisePolicyView(now.policy.data);
    if (!original || now.original !== original || now.scope !== original.scope || now.path !== path || !now.auth.hasTenantMembershipPermission("rental-os:corporate:manage")
      || now.policy.isFetching || now.policy.error || !current || JSON.stringify(current) !== original.key) throw changedMaterial();
    return original;
  };
  const currentInput = () => captureEnterprisePolicyInput({ workspaceIds: form.getFieldValue("workspaceIds"), categoryCodes: form.getFieldValue("categoryCodes"),
    personalPaymentAllowed: form.getFieldValue("personalPaymentAllowed"), enterprisePaymentAllowed: form.getFieldValue("enterprisePaymentAllowed"), approvalMode: form.getFieldValue("approvalMode"),
    noticeVersion: form.getFieldValue("noticeVersion"), noticeText: form.getFieldValue("noticeText"), maxRequestAmount: form.getFieldValue("maxRequestAmount"), currency: form.getFieldValue("currency"),
    approvalLifetimeMinutes: form.getFieldValue("approvalLifetimeMinutes"), reason: form.getFieldValue("reason") });
  const save = async (validated?: EnterprisePolicyForm) => {
    const input = validated === undefined ? currentInput() : captureEnterprisePolicyInput(validated);
    await operation.run(async () => {
      const basis = assertOriginal(), checked = captureEnterprisePolicyInput(await form.validateFields()); assertOriginal();
      if (JSON.stringify(checked) !== JSON.stringify(input) || JSON.stringify(currentInput()) !== JSON.stringify(input)) throw changedMaterial();
      const commandInput: Omit<SaveEnterpriseScopePolicyRequest, "operationKey"> = { policy: input.policy, expectedRevision: basis.view.merchantRevision, reason: input.reason };
      return { path, method: "put", input: commandInput };
    }, async () => { await refresh(); if (latest.current.original === original) setReviewed(undefined); }, refresh);
  };
  const recover = async () => {
    const receipt = await operation.recover(async originalPath => { if (originalPath !== path) throw changedMaterial(); });
    if (receipt?.state === "committed" && typeof receipt.result?.revision === "number") {
      operation.assertCurrent(); setObserved({ scope, revision: receipt.result.revision }); setReviewed(undefined);
      // Current material may be unavailable after a known save. Its failure cannot undo
      // or substitute for the exact receipt already retired by the original operation gate.
      await refresh();
    }
  };
  if (!permitted) return <Alert type="warning" title={english ? "Merchant policy management is not permitted" : "缺少商户企业管理权限"} />;
  return <section><h3>{english ? "Enterprise rental upper bounds" : "企业租赁上限"}</h3>
    <Alert type="info" title={english ? "Separate from portal access and credit" : "入口授权、租赁上限和授信分别配置"} description={english ? "No policy means no new enterprise rental. Saving does not activate a member's payment authority, approve an order or waive a deposit." : "未配置时新企业身份业务不可用；保存不自动授员工付费权、不批准订单、不免押。告知为纯文本，由企业政策沿用。"} />
    {observed?.scope === scope && <Alert type="info" title={english ? `Original policy save verified at revision ${observed.revision}; not current authority.` : `已核对原政策保存修订 ${observed.revision}，不代表当前授权。`} />}
    {policy.error || policy.data && !view ? <Alert type="error" title={english ? "Original merchant policy could not be read" : "原商户政策材料不可读取"} action={<ActionButton intent="review" label={english ? "Read again" : "重新读取"} onAction={refresh} />} /> : !view ? <p>{english ? "Reading policy" : "正在读取政策"}</p> : <>
      <p>{english ? "Merchant policy revision" : "商户政策修订"}：{view.merchantRevision}</p>
      {!view.merchant && <Alert type="warning" title={english ? "Upper bounds not configured" : "尚未配置上限；新企业业务不可用"} />}
      {!original ? <Button disabled={operation.blocked || policy.isFetching || Boolean(policy.error)} onClick={beginEdit}>{english ? "Configure upper bounds" : "配置租赁上限"}</Button> : <Form form={form} layout="vertical" disabled={operation.blocked}>
        {changed && <Alert type="warning" title={english ? "Original limits changed; reopen after reviewing, without rebinding old input." : "原上限材料或修订已变化，重新审阅；不自动改绑旧输入。"} />}
        <EnterprisePolicyFields view={original.view} merchant english={english} />
        <SaveButton form={form} disabled={operation.blocked || policy.isFetching || Boolean(policy.error) || changed} label={english ? "Save upper bounds" : "保存租赁上限"} onSave={values => save(values)} />
        <Button disabled={operation.blocked} onClick={() => { operation.assertCurrent(); if (latest.current.original === original) setReviewed(undefined); }}>{english ? "Cancel" : "取消"}</Button>
      </Form>}
    </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original policy result" : "核对原政策操作"} onAction={recover} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
