/** Shared enterprise policy form presentation. Hosts own current identity and transport. */
import type { EnterpriseScopePolicy, EnterpriseScopePolicyView } from "@rental-os/shared";
import { RentalCategoryCode } from "@rental-os/shared";
import { Checkbox, Form, Input, Select } from "./ui/customer-entry";
export type EnterprisePolicyForm = EnterpriseScopePolicy & { reason: string };
export function EnterprisePolicyFields({ view, merchant, english }: { view: EnterpriseScopePolicyView; merchant: boolean; english: boolean }) {
  const categoryNames: Record<RentalCategoryCode, string> = { vehicle: english ? "Vehicle" : "车辆", camera: english ? "Camera" : "摄影", camping: english ? "Camping" : "露营", construction: english ? "Construction" : "工程设备" };
  const categories = merchant ? Object.values(RentalCategoryCode) : view.merchant?.categoryCodes ?? [];
  return <>
    <Form.Item name="categoryCodes" label={english ? "Allowed categories" : "允许品类"} rules={[{ required: true }]}><Select mode="multiple" options={categories.map(value => ({ value, label: categoryNames[value] ?? value }))} /></Form.Item>
    <Form.Item name="workspaceIds" label={english ? "Allowed workspaces" : "允许经营空间"} rules={[{ required: true }]}><Select mode="multiple" options={view.workspaces.map(row => ({ value: row.id, label: `${row.name} / ${categoryNames[row.categoryCode] ?? row.categoryCode}` }))} /></Form.Item>
    <Form.Item name="personalPaymentAllowed" valuePropName="checked"><Checkbox>{english ? "Allow corporate benefits with personal payment" : "允许企业优惠、个人付款"}</Checkbox></Form.Item>
    <Form.Item name="enterprisePaymentAllowed" valuePropName="checked"><Checkbox>{english ? "Allow enterprise contract and payment" : "允许企业签约与付款"}</Checkbox></Form.Item>
    <Form.Item name="approvalMode" label={english ? "Enterprise payment approval" : "企业付费审批"} rules={[{ required: true }]}><Select options={[{ value: "unconfigured", label: english ? "Not configured; payment blocked" : "未配置，不放行企业付费" }, { value: "per_order", label: english ? "Approval for each order" : "逐单审批" }, { value: "without_per_order", label: english ? "Standing authority" : "免逐单审批" }]} /></Form.Item>
    <Form.Item name="approvalLifetimeMinutes" label={english ? "Approval lifetime in minutes" : "批准有效窗口（分钟）"} rules={[{ validator: async (_, value) => { if (value != null && value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 10080)) throw new Error(english ? "Enter an integer from 1 to 10080" : "填写1至10080的整数"); } }]}><Input type="number" min={1} max={10080} /></Form.Item>
    <Form.Item name="maxRequestAmount" label={english ? "Optional rental payable limit" : "可选单笔租赁应付上限（不含押金及预授权）"}><Input inputMode="decimal" /></Form.Item>
    <Form.Item name="currency" label={english ? "Currency for the limit" : "上限币种"}><Input maxLength={3} /></Form.Item>
    <Form.Item name="noticeVersion" label={english ? "Notice version" : "告知版本"} rules={[{ required: true, whitespace: true }]}><Input readOnly={!merchant} maxLength={191} /></Form.Item>
    <Form.Item name="noticeText" label={english ? "Enterprise order visibility notice" : "企业身份订单可见性告知"} rules={[{ required: true, whitespace: true }]}><Input.TextArea readOnly={!merchant} maxLength={4000} /></Form.Item>
    <Form.Item name="reason" label={english ? "Reason" : "变更原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
  </>;
}
export function enterprisePolicyValues(policy?: EnterpriseScopePolicy): EnterprisePolicyForm {
  return { workspaceIds: [], categoryCodes: [], personalPaymentAllowed: false, enterprisePaymentAllowed: false, approvalMode: "unconfigured", noticeVersion: "", noticeText: "", ...policy, reason: "" };
}
export function enterprisePolicyPayload(values: EnterprisePolicyForm): EnterpriseScopePolicy {
  const { reason: _reason, ...policy } = values;
  return { ...policy, maxRequestAmount: values.maxRequestAmount?.trim() || undefined, currency: values.currency?.trim().toUpperCase() || undefined,
    approvalLifetimeMinutes: values.approvalLifetimeMinutes == null || String(values.approvalLifetimeMinutes) === "" ? undefined : Number(values.approvalLifetimeMinutes) };
}
