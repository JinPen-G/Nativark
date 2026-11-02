/** Merchant reviews proposals here, then uses the original authorized business service
 * separately. A review receipt never confirms profile, limit, payment or ledger changes. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseManagementProposal, EnterpriseManagementRequestType, EnterpriseManagementRequestView } from "@rental-os/shared";
import { ActionButton, Alert, Input, Table } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
export function EnterpriseManagementRequests() {
  const { t } = useLocale(), auth = useAuthStore(), operation = useOriginalEnterpriseOperation("enterprise-management-requests");
  const permitted = auth.sessionVerified && auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const list = useQuery({ queryKey: ["enterprise-management-queue", operation.identity], enabled: permitted,
    queryFn: ({ signal }) => operation.read<EnterpriseManagementRequestView[]>("/membership/enterprise-workflows/management-requests", signal) });
  const [selection, setSelection] = useState<{ identity: string; id: string; revision: number; reason: string }>();
  const selected = selection?.identity === operation.identity ? selection : undefined;
  const blocked = !permitted || operation.blocked || list.isFetching || Boolean(list.error);
  const requestLabels: Record<EnterpriseManagementRequestType, string> = { profile_change: "资料更正", credit_change: "授信调整申请", scope_change: "使用范围调整" };
  const proposalLabels: Record<keyof EnterpriseManagementProposal, string> = { legalName: "申请主体名称", registeredAddress: "申请注册地址", email: "企业联系邮箱", requestedCreditLimit: "申请额度", currency: "原授信币种", workspaceIds: "申请空间引用", categoryCodes: "申请品类代码" };
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const evidence = async (id: string, fileId: string) => {
    operation.assertCurrent();
    const result = await http.request<Blob>({ url: `/membership/enterprise-workflows/management-requests/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, method: "get", responseType: "blob", signal: currentSessionSignal() });
    operation.assertCurrent();
    if (!["application/pdf", "image/png", "image/jpeg"].includes(result.data.type) || result.data.size < 1 || result.data.size > 20 * 1024 * 1024) throw new Error(t("材料结果不可核对"));
    const url = URL.createObjectURL(result.data), link = document.createElement("a");
    link.href = url; link.download = "enterprise-request-evidence";
    try { link.click(); } finally { URL.revokeObjectURL(url); }
  };
  const decide = (row: EnterpriseManagementRequestView, decision: "approve" | "reject" | "supplement") => operation.run(() => {
    operation.assertCurrent();
    if (blocked || selected?.id !== row.id || selected.revision !== row.revision || !selected.reason.trim()) throw new Error(t("请先核对本条申请和当前修订"));
    if (row.requestType === "credit_change" && !auth.hasTenantMembershipPermission("rental-os:finance:manage")) throw new Error(t("授信申请须当前财务管理权"));
    return { path: `/membership/enterprise-workflows/management-requests/${encodeURIComponent(row.id)}/decision`, method: "post",
      input: { expectedRevision: row.revision, decision, reason: selected.reason.trim() } };
  }, async () => { await refresh(); setSelection(undefined); }, refresh);
  return <section><h3>{t("企业资料与调整申请")}</h3>
    <Alert type="info" title={t("本页仅记录审核决定，不直接执行业务变更")}
      description={t("批准申请不改额度、主档或范围，不入账、不确认到账；实际变更须另行使用原受权业务入口。")} />
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={t("核对原审核结果")} onAction={() => operation.recover(refresh)} />}
    {operation.error && <Alert type="error" title={operation.error} />}
    {list.error && <Alert type="error" title={list.error instanceof Error ? list.error.message : t("申请读取失败")} />}
    <Table rowKey="id" dataSource={permitted && !list.error ? list.data ?? [] : []} loading={list.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: t("企业引用"), dataIndex: "corporateCustomerId" }, { title: t("申请类别"), render: (_, row: EnterpriseManagementRequestView) => t(requestLabels[row.requestType]) }, { title: t("申请人引用"), dataIndex: "applicantCustomerId" },
      { title: t("申请原因"), dataIndex: "reason" }, { title: t("状态"), dataIndex: "state" }, { title: t("原对象修订"), dataIndex: "objectRevision" },
      { title: t("申请明细"), render: (_, row: EnterpriseManagementRequestView) => <dl>{Object.entries(row.proposal).map(([key, value]) => <div key={key}><dt>{t(proposalLabels[key as keyof EnterpriseManagementProposal] ?? "未登记字段")}</dt><dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd></div>)}</dl> },
      { title: t("申请材料"), render: (_, row: EnterpriseManagementRequestView) => row.evidenceFileIds.map((id, index) => <ActionButton key={id} disabled={blocked} intent="review" label={`${t("读取材料")} ${index + 1}`} onAction={() => evidence(row.id, id)} />) },
      { title: t("审核"), render: (_, row: EnterpriseManagementRequestView) => row.state === "pending" ? selected?.id === row.id && selected.revision === row.revision ? <>
        <Input.TextArea aria-label={t("本条申请审核原因")} disabled={blocked} maxLength={500} value={selected.reason} onChange={event => setSelection({ ...selected, reason: event.target.value })} />
        {(["approve", "reject", "supplement"] as const).map(decision => <ActionButton key={decision} disabled={blocked || !selected.reason.trim()} intent="confirm"
          label={decision === "approve" ? t("记录审核通过") : decision === "reject" ? t("拒绝申请") : t("要求补件")} onAction={() => decide(row, decision)} />)}
      </> : <ActionButton disabled={blocked} intent="review" label={t("核对本条申请")} onAction={async () => { operation.assertCurrent(); setSelection({ identity: operation.identity, id: row.id, revision: row.revision, reason: "" }); }} /> : row.decisionReason },
    ]} />
  </section>;
}
