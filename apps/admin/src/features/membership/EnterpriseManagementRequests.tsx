/** Merchant reviews are facts only; original services own profile, credit and policy changes.
 * Freeze reviewed material and confirmation input; the server owns authorization and revisions. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseManagementProposal, EnterpriseManagementRequestType, EnterpriseManagementRequestView, EnterpriseOperationResult } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Input, Table } from "@/components/ui";
import { copyEnterpriseManagementRequest } from "@/components/enterprise-management-material";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
type Selection = { identity: string; material: EnterpriseManagementRequestView; key: string; reason: string };
type Decision = "approve" | "reject" | "supplement";
type Confirmation = { selection: Selection; decision: Decision; reason: string };
export function EnterpriseManagementRequests() {
  const { t } = useLocale(), auth = useAuthStore(), operation = useOriginalEnterpriseOperation("enterprise-management-requests");
  const permitted = auth.sessionVerified && auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const list = useQuery({ queryKey: ["enterprise-management-queue", operation.identity], enabled: permitted,
    queryFn: ({ signal }) => operation.read<EnterpriseManagementRequestView[]>("/membership/enterprise-workflows/management-requests", signal) });
  const [selection, setSelection] = useState<Selection>();
  const [originalReview, setOriginalReview] = useState<{ identity: string; result: NonNullable<EnterpriseOperationResult["result"]> }>();
  const selected = selection?.identity === operation.identity ? selection : undefined;
  const confirmations = useRef(new Map<string, Confirmation>());
  useEffect(() => { setSelection(undefined); setOriginalReview(undefined); confirmations.current.clear(); }, [operation.identity]);
  let rows: EnterpriseManagementRequestView[] = [], materialError = false;
  try {
    if (list.data !== undefined) {
      if (!Array.isArray(list.data) || list.data.length > 200) throw new Error();
      rows = list.data.map(copyEnterpriseManagementRequest);
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error();
    }
  } catch { rows = []; materialError = true; }
  const blocked = !permitted || operation.blocked || list.isFetching || Boolean(list.error) || materialError || !Array.isArray(list.data);
  const latest = useRef({ selected, list }); latest.current = { selected, list };
  const requestLabels: Record<EnterpriseManagementRequestType, string> = { profile_change: "资料更正", credit_change: "授信调整申请", scope_change: "使用范围调整" };
  const proposalLabels: Record<keyof EnterpriseManagementProposal, string> = { legalName: "申请主体名称", registeredAddress: "申请注册地址", email: "企业联系邮箱", requestedCreditLimit: "申请额度", currency: "原授信币种", workspaceIds: "申请空间引用", categoryCodes: "申请品类代码" };
  const unavailable = () => new Error(t("原申请材料或审核依据已变化，请重新核对"));
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const assertMaterial = (material: EnterpriseManagementRequestView, key: string, pending = false) => {
    operation.assertCurrent(); const currentAuth = useAuthStore.getState(), query = latest.current.list;
    if (!currentAuth.sessionVerified || !currentAuth.hasTenantMembershipPermission("rental-os:corporate:manage") || query.isFetching || query.error || !Array.isArray(query.data)) throw unavailable();
    if (material.requestType === "credit_change" && !currentAuth.hasTenantMembershipPermission("rental-os:finance:manage")) throw new Error(t("授信申请须当前财务管理权"));
    const current = query.data.find(row => row.id === material.id);
    if (!current || JSON.stringify(copyEnterpriseManagementRequest(current)) !== key || pending && current.state !== "pending") throw unavailable();
  };
  const review = async (row: EnterpriseManagementRequestView) => {
    const material = copyEnterpriseManagementRequest(row), key = JSON.stringify(material); assertMaterial(material, key, true);
    if (operation.blocked) throw unavailable();
    setSelection({ identity: operation.identity, material, key, reason: "" }); confirmations.current.clear();
  };
  const evidence = async (material: EnterpriseManagementRequestView, fileId: string) => {
    const original = copyEnterpriseManagementRequest(material), key = JSON.stringify(original); assertMaterial(original, key);
    if (!original.evidenceFileIds.includes(fileId)) throw unavailable();
    const result = await http.request<Blob>({ url: `/membership/enterprise-workflows/management-requests/${encodeURIComponent(original.id)}/files/${encodeURIComponent(fileId)}`, method: "get", responseType: "blob", signal: currentSessionSignal() });
    assertMaterial(original, key);
    if (!["application/pdf", "image/png", "image/jpeg"].includes(result.data.type) || result.data.size < 1 || result.data.size > 20 * 1024 * 1024) throw new Error(t("材料结果不可核对"));
    const url = URL.createObjectURL(result.data), link = document.createElement("a");
    link.href = url; link.download = "enterprise-request-evidence";
    try { link.click(); } finally { URL.revokeObjectURL(url); }
  };
  const decide = async (original: Confirmation) => {
    const assertOriginal = () => {
      assertMaterial(original.selection.material, original.selection.key, true);
      const current = latest.current.selected;
      if (current !== original.selection || current.identity !== operation.identity || current.reason !== original.reason || typeof original.reason !== "string" || !original.reason.trim() || original.reason.length > 500) throw unavailable();
    };
    assertOriginal();
    return operation.run(() => {
      // The native confirmation and original Web Lock may yield; never adopt a newer row/reason.
      assertOriginal();
      return { path: `/membership/enterprise-workflows/management-requests/${encodeURIComponent(original.selection.material.id)}/decision`, method: "post",
        input: { expectedRevision: original.selection.material.revision, decision: original.decision, reason: original.reason.trim() } };
    }, async () => { await refresh(); if (latest.current.selected === original.selection) setSelection(undefined); }, refresh);
  };
  const actions = (row: EnterpriseManagementRequestView) => {
    if (selected?.material.id !== row.id) return row.state === "pending" ? <ActionButton disabled={blocked} intent="review" label={t("核对本条申请")} onAction={() => review(row)} /> : row.decisionReason;
    const stale = selected.key !== JSON.stringify(row) || row.state !== "pending";
    return <>
      <p>{t("已核对的原申请修订")}: {selected.material.revision} / {selected.material.objectRevision}</p>
      {stale && <Alert type="warning" title={t("原申请已变化，旧审核原因未自动改绑")}
        action={row.state === "pending" ? <ActionButton disabled={blocked} intent="review" label={t("重新核对本条申请")} onAction={() => review(row)} /> : undefined} />}
      <Input.TextArea aria-label={t("本条申请审核原因")} disabled={blocked} maxLength={500} value={selected.reason} onChange={event => {
        operation.assertCurrent(); if (latest.current.selected !== selected || blocked) throw unavailable();
        setSelection({ ...selected, reason: event.target.value });
      }} />
      {(["approve", "reject", "supplement"] as const).map(decision => <ConfirmAction key={decision} disabled={blocked || stale || !selected.reason.trim()}
        label={decision === "approve" ? t("记录审核通过") : decision === "reject" ? t("拒绝申请") : t("要求补件")}
        prompt={t("仅记录本条申请的审核结论？不会修改主档、额度、政策或账本。")}
        onStateChange={state => {
          // The adapter uses the latest onConfirm; retain the original review and reason at opening.
          if (state === "confirming") confirmations.current.set(decision, { selection: selected, decision, reason: selected.reason });
          else if (state === "idle" || state === "done") confirmations.current.delete(decision);
        }} onConfirm={async () => { const original = confirmations.current.get(decision); if (!original) throw unavailable(); return decide(original); }} />)}
      <ActionButton disabled={operation.blocked} intent="review" label={t("结束审阅")} onAction={async () => { operation.assertCurrent(); setSelection(undefined); confirmations.current.clear(); }} />
    </>;
  };
  const recoverOriginal = async () => {
    operation.assertCurrent();
    const original = await operation.recover(async () => {});
    if (original?.state === "committed" && original.result) {
      setOriginalReview({ identity: operation.identity, result: original.result }); setSelection(undefined); confirmations.current.clear();
      // K is retired before today's queue read; a failed current read is not a retry grant.
      await refresh();
    }
  };
  return <section><h3>{t("企业资料与调整申请")}</h3>
    <Alert type="info" title={t("本页仅记录审核决定，不直接执行业务变更")}
      description={t("批准申请不改额度、主档或范围，不入账、不确认到账；实际变更须另行使用原受权业务入口。")} />
    {operation.pending && <ActionButton disabled={operation.busy || !permitted} intent="review" label={t("核对原审核结果")} onAction={recoverOriginal} />}
    {originalReview?.identity === operation.identity && <Alert type="info" title={t("原审核收据已核对，不代表业务变更或当前授权")} description={`${originalReview.result.id} / ${originalReview.result.state} / ${originalReview.result.revision}`} />}
    {operation.error && <Alert type="error" title={operation.error} />}
    {(list.error || materialError) && <Alert type="error" title={t("申请材料不可核对")}
      action={<ActionButton disabled={!permitted || operation.busy} intent="review" label={t("重新读取申请")} onAction={refresh} />} />}
    <Table rowKey="id" dataSource={permitted && !list.error ? rows : []} loading={list.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: t("企业引用"), dataIndex: "corporateCustomerId" }, { title: t("申请类别"), render: (_, row: EnterpriseManagementRequestView) => t(requestLabels[row.requestType]) }, { title: t("申请人引用"), dataIndex: "applicantCustomerId" },
      { title: t("申请原因"), dataIndex: "reason" }, { title: t("状态"), dataIndex: "state" }, { title: t("原对象修订"), dataIndex: "objectRevision" },
      { title: t("申请明细"), render: (_, row: EnterpriseManagementRequestView) => <dl>{Object.entries(row.proposal).map(([key, value]) => <div key={key}><dt>{t(proposalLabels[key as keyof EnterpriseManagementProposal])}</dt><dd>{Array.isArray(value) ? value.join("、") : value}</dd></div>)}</dl> },
      { title: t("申请材料"), render: (_, row: EnterpriseManagementRequestView) => row.evidenceFileIds.map((id, index) => <ActionButton key={id} disabled={blocked} intent="review" label={`${t("读取材料")} ${index + 1}`} onAction={() => evidence(row, id)} />) },
      { title: t("审核"), render: (_, row: EnterpriseManagementRequestView) => actions(row) },
    ]} />
  </section>;
}
