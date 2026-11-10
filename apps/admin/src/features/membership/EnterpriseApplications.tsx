/** Merchant decisions stay on the original operator endpoint and permission domain.
 * Policy editing is deliberate; failed reads and missing configuration are distinct. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseWorkflowView, EnterpriseInvitePolicy } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, Form, Input, SaveButton, Table } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { isInvitePolicyUnconfigured, useOriginalEnterpriseOperation } from "./original-enterprise-operation";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";

type PolicySnapshot = { revision: number; policy: EnterpriseInvitePolicy };
export function EnterpriseApplications() {
  const { t } = useLocale(), auth = useAuthStore(), operation = useOriginalEnterpriseOperation();
  const permitted = auth.sessionVerified && auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const canReview = permitted && auth.hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const [verified, setVerified] = useState(false), [reason, setReason] = useState("");
  const [editor, setEditor] = useState<{ identity: string; revision: number }>();
  const [policyReason, setPolicyReason] = useState("");
  const [form] = Form.useForm<EnterpriseInvitePolicy>();
  const currentIdentity = useRef(operation.identity); currentIdentity.current = operation.identity;
  const policyFields = [
    { name: "maxLifetimeHours", label: "最长有效小时", min: 1, max: 8760 },
    { name: "maxUses", label: "单邀请最大人数", min: 1, max: 1000 },
    { name: "guessesPerWindow", label: "窗口允许尝试次数", min: 1, max: 100 },
    { name: "windowSeconds", label: "窗口秒数", min: 60, max: 86400 },
    { name: "agreementVersion", label: "企业告知版本" }
  ];
  const list = useQuery({ queryKey: ["enterprise-merchant-applications", operation.identity], enabled: permitted,
    queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>("/membership/enterprise-workflows/applications", signal) });
  const policy = useQuery({ queryKey: ["enterprise-invite-policy", operation.identity], enabled: permitted, retry: false,
    queryFn: async ({ signal }) => {
      try { return await operation.read<PolicySnapshot>("/membership/enterprise-workflows/invite-policy", signal); }
      catch (error) { if (isInvitePolicyUnconfigured(error)) return null; throw error; }
    } });
  const editing = editor?.identity === operation.identity ? editor : undefined;
  const reviewBlocked = !canReview || operation.blocked || list.isFetching || Boolean(list.error) || !list.data;
  const policyBlocked = !permitted || operation.blocked || policy.isFetching || Boolean(policy.error) || policy.data === undefined;
  useEffect(() => { setVerified(false); setReason(""); setEditor(undefined); setPolicyReason(""); form.resetFields(); }, [operation.identity, form]);
  const readEvidence = async (id: string, fileId: string) => {
    operation.assertCurrent();
    const result = await http.request<Blob>({ url: `/membership/enterprise-workflows/applications/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, method: "get", responseType: "blob", signal: currentSessionSignal() });
    operation.assertCurrent();
    if (!["application/pdf", "image/png", "image/jpeg"].includes(result.data.type) || result.data.size > 20 * 1024 * 1024) throw new Error(t("材料读取结果不可核对"));
    const url = URL.createObjectURL(result.data), link = document.createElement("a");
    link.href = url; link.download = `authority-evidence.${result.data.type === "application/pdf" ? "pdf" : result.data.type === "image/png" ? "png" : "jpg"}`;
    link.click(); URL.revokeObjectURL(url);
  };
  const refreshList = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const refreshPolicy = async () => { await policy.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const recover = () => operation.recover(async path => {
    if (path === "/membership/enterprise-workflows/invite-policy") {
      await refreshPolicy(); setEditor(undefined); setPolicyReason(""); form.resetFields();
    } else { await refreshList(); setVerified(false); setReason(""); }
  });
  const openPolicyEditor = () => {
    operation.assertCurrent();
    if (policyBlocked) return;
    form.resetFields();
    // initialValues is mount-only. Fill from the successfully read snapshot only when editing is requested.
    if (policy.data) form.setFieldsValue(policy.data.policy);
    setPolicyReason(""); setEditor({ identity: operation.identity, revision: policy.data?.revision ?? 0 });
  };
  const refreshPolicyRevision = async () => {
    const result = await policy.refetch({ throwOnError: true }); operation.assertCurrent();
    if (result.data === undefined) throw new Error(t("邀请配置读取失败"));
    // Retain the unsaved fields/reason on a known pre-write conflict; only advance the expected revision.
    setEditor({ identity: operation.identity, revision: result.data?.revision ?? 0 });
  };
  return <section><h3>{t("企业申请审核")}</h3>
    <Alert type="info" title={t("申请人仅是首位管理员候选；须核验代表资格，不自动开授信或可租范围。")}/>
    {!permitted && <Alert type="warning" title={t("当前身份没有企业管理权限")}/>}
    <label htmlFor="enterprise-application-review-reason">{t("审核依据与原因")}</label>
    <Input.TextArea id="enterprise-application-review-reason" value={reason} disabled={reviewBlocked} onChange={e => setReason(e.target.value)} maxLength={500}/>
    <Checkbox checked={verified} disabled={reviewBlocked} onChange={e => setVerified(e.target.checked)}>{t("已核验申请人的企业代表资格及附件")}</Checkbox>
    {operation.pending && <>
      <Alert type={operation.pending.state === "committed" ? "info" : "warning"} title={operation.pending.state === "committed"
        ? t("操作已提交；只能刷新结果，不要再次发送。") : t("结果待核对，请保留原请求；没有收据不代表未写入。")}/>
      <ActionButton disabled={operation.busy || !permitted} label={operation.pending.state === "committed" ? t("刷新已提交结果") : t("核对原操作")} intent="review" onAction={recover}/>
    </>}
    {operation.error && <Alert type="error" title={operation.error}/>}
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <Table rowKey="id" dataSource={permitted && !list.error ? list.data ?? [] : []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refreshList} columns={[
      { title: t("企业"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.legalName ?? "") },
      { title: t("地区"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.region ?? "") },
      { title: t("主体标识"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.legalIdentifier ?? "") },
      { title: t("代表资格说明"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.authorityStatement ?? "") },
      { title: t("授权材料"), render: (_, row: EnterpriseWorkflowView) => Array.isArray(row.payload.evidenceFileIds) ? row.payload.evidenceFileIds.filter((id): id is string => typeof id === "string").map((fileId, index) => <ActionButton key={fileId} disabled={!canReview || operation.blocked} intent="review" label={`${t("读取材料")} ${index + 1}`} onAction={() => readEvidence(row.id, fileId)} />) : null },
      { title: t("状态"), dataIndex: "state" }, { title: t("处理原因"), dataIndex: "decisionReason" },
      { title: t("操作"), render: (_, row: EnterpriseWorkflowView) => row.state === "pending" ? (["approve", "reject", "supplement"] as const).map(decision =>
        <ActionButton key={decision} disabled={reviewBlocked || !reason.trim() || (decision === "approve" && !verified)} label={decision === "approve" ? t("批准并开通首管") : decision === "reject" ? t("拒绝") : t("要求补件")} intent="confirm" onAction={() => operation.run(() => {
          if (reviewBlocked || !reason.trim() || (decision === "approve" && !verified)) throw new Error(t("请先核验当前申请并填写审核原因"));
          return { path: `/membership/enterprise-workflows/applications/${encodeURIComponent(row.id)}/decision`, method: "post", input: { decision, verifiedRepresentative: verified, expectedRevision: row.revision, reason: reason.trim() } };
        }, async () => { await refreshList(); setVerified(false); setReason(""); }, refreshList)}/>) : null }]}/>
    <h3>{t("企业邀请参数")}</h3>
    <Alert type="info" title={t("没有配置时邀请不可用；此处明确期限、次数、限速及告知版本，不采用生产默认值。")}/>
    {permitted && policy.isFetching && <p role="status">{t("正在读取邀请参数")}</p>}
    {permitted && policy.error && <Alert type="error" title={String(policy.error)}/>}
    {permitted && !policy.isFetching && !policy.error && policy.data === null && <Alert type="warning" title={t("邀请参数尚未配置，邀请不可用")}/>}
    {permitted && !policy.isFetching && !policy.error && policy.data && !editing && <dl>
      <dt>{t("最长有效小时")}</dt><dd>{policy.data.policy.maxLifetimeHours}</dd>
      <dt>{t("单邀请最大人数")}</dt><dd>{policy.data.policy.maxUses}</dd>
      <dt>{t("窗口允许尝试次数")}</dt><dd>{policy.data.policy.guessesPerWindow}</dd>
      <dt>{t("窗口秒数")}</dt><dd>{policy.data.policy.windowSeconds}</dd>
      <dt>{t("企业告知版本")}</dt><dd>{policy.data.policy.agreementVersion}</dd>
      <dt>{t("加入告知正文")}</dt><dd>{policy.data.policy.noticeText ?? t("未配置，邀请确认不可用")}</dd>
    </dl>}
    {!editing && <Button disabled={policyBlocked} onClick={openPolicyEditor}>{policy.data === null ? t("配置邀请参数") : t("编辑邀请参数")}</Button>}
    {permitted && <ActionButton disabled={operation.blocked || policy.isFetching} label={t("重新读取邀请参数")} intent="refresh" onAction={refreshPolicy}/>}
    {editing && <>
      <Form form={form} layout="vertical" disabled={policyBlocked}>
        {policyFields.map(({ name, label, min, max }) =>
          <Form.Item key={name} name={name} label={t(label)} rules={[{ required: true }]}><Input type={name === "agreementVersion" ? "text" : "number"} min={min} max={max} step={name === "agreementVersion" ? undefined : 1} maxLength={name === "agreementVersion" ? 191 : undefined}/></Form.Item>)}
        <Form.Item name="noticeText" label={t("商户批准的加入告知正文")} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={4000}/></Form.Item>
        <label htmlFor="enterprise-invite-policy-reason">{t("配置变更原因")}</label>
        <Input.TextArea id="enterprise-invite-policy-reason" value={policyReason} disabled={policyBlocked} onChange={e => setPolicyReason(e.target.value)} maxLength={500}/>
        <SaveButton form={form} disabled={policyBlocked || !policyReason.trim()} label={t("保存邀请参数")} onSave={values => operation.run(() => {
          if (policyBlocked || !policyReason.trim() || editing.identity !== currentIdentity.current) throw new Error(t("请核对当前配置并填写变更原因"));
          return { path: "/membership/enterprise-workflows/invite-policy", method: "put", input: { policy: { ...values,
            maxLifetimeHours: Number(values.maxLifetimeHours), maxUses: Number(values.maxUses), guessesPerWindow: Number(values.guessesPerWindow), windowSeconds: Number(values.windowSeconds) },
            expectedRevision: editing.revision, reason: policyReason.trim() } };
        }, async () => { await refreshPolicy(); setEditor(undefined); setPolicyReason(""); form.resetFields(); }, refreshPolicyRevision)}/>
      </Form>
      <Button disabled={operation.blocked} onClick={() => { setEditor(undefined); setPolicyReason(""); form.resetFields(); }}>{t("取消编辑")}</Button>
    </>}
  </section>;
}
