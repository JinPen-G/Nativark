/** Merchant decisions stay on the original operator endpoint and permission domain.
 * Policy editing is deliberate; failed reads and missing configuration are distinct. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseWorkflowView, EnterpriseInvitePolicy, EnterpriseOperationResult, EnterpriseApplicationClaimView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, ConfirmAction, Form, Input, SaveButton, Table } from "@/components/ui";
import { copyEnterpriseApplicationMaterial } from "@/components/enterprise-application-material";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { isInvitePolicyUnconfigured, useOriginalEnterpriseOperation } from "./original-enterprise-operation";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
import { enterpriseApplicationRegionHasIdentityMapping } from "@rental-os/shared";

type PolicySnapshot = { revision: number; policy: EnterpriseInvitePolicy };
type ApplicationFeedback = { identity: string; locator: string; material: EnterpriseWorkflowView; key: string };
type ApplicationSelection = { identity: string; material: EnterpriseWorkflowView; key: string; feedback?: ApplicationFeedback };
type ApplicationDecision = "approve" | "reject" | "supplement";
type ClaimReview = { identity: string; selection: ApplicationSelection; material: EnterpriseApplicationClaimView; key: string };
type ApplicationConfirmation = { selection: ApplicationSelection; decision: ApplicationDecision; reason: string; verified: boolean; claim?: ClaimReview };
export function EnterpriseApplications() {
  const { t, locale } = useLocale(), auth = useAuthStore(), operation = useOriginalEnterpriseOperation();
  const permitted = auth.sessionVerified && auth.hasTenantMembershipPermission("rental-os:corporate:manage");
  const canReview = permitted && auth.hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const [verified, setVerified] = useState(false), [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState<ApplicationSelection>();
  const [claim, setClaim] = useState<ClaimReview>();
  const [readingClaim, setReadingClaim] = useState<string>();
  const claimEpoch = useRef(0);
  const latestClaim = useRef<ClaimReview | undefined>(undefined);
  const [readingMaterial, setReadingMaterial] = useState<string>();
  const materialRead = useRef({ epoch: 0, busy: false });
  const [requestedId, setRequestedId] = useState("");
  const [feedback, setFeedback] = useState<ApplicationFeedback>();
  const [readingFeedback, setReadingFeedback] = useState<string>();
  const [feedbackError, setFeedbackError] = useState<string>();
  const feedbackEpoch = useRef(0);
  const locator = JSON.stringify([operation.identity, requestedId]);
  const currentFeedback = feedback?.identity === operation.identity && feedback.locator === locator ? feedback : undefined;
  const latestFeedback = useRef({ locator, requestedId, feedback: currentFeedback }); latestFeedback.current = { locator, requestedId, feedback: currentFeedback };
  const [originalReview, setOriginalReview] = useState<{ identity: string; result: NonNullable<EnterpriseOperationResult["result"]> }>();
  const confirmations = useRef(new Map<string, ApplicationConfirmation>());
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
  const selected = reviewed?.identity === operation.identity ? reviewed : undefined;
  const currentClaim = claim?.identity === operation.identity && claim.selection === selected ? claim : undefined; latestClaim.current = currentClaim;
  let applicationRows: EnterpriseWorkflowView[] = [], materialError = false;
  try {
    if (list.data !== undefined) {
      if (!Array.isArray(list.data) || list.data.length > 200) throw new Error();
      applicationRows = list.data.map(row => { const value = copyEnterpriseApplicationMaterial(row); if (!value) throw new Error(); return value; });
      if (new Set(applicationRows.map(row => row.id)).size !== applicationRows.length) throw new Error();
    }
  } catch { applicationRows = []; materialError = true; }
  const reviewBlocked = !canReview || operation.blocked || readingMaterial === operation.identity || list.isFetching || Boolean(list.error) || materialError || !Array.isArray(list.data);
  const policyBlocked = !permitted || operation.blocked || policy.isFetching || Boolean(policy.error) || policy.data === undefined;
  const selectedBlocked = selected?.feedback ? !canReview || operation.blocked || readingMaterial === operation.identity || readingFeedback === locator || selected.feedback !== currentFeedback : reviewBlocked;
  const latestReview = useRef({ selected, list, verified, reason }); latestReview.current = { selected, list, verified, reason };
  useEffect(() => {
    materialRead.current.epoch++; materialRead.current.busy = false; setReadingMaterial(undefined);
    feedbackEpoch.current++; latestFeedback.current.feedback = undefined; setRequestedId(""); setFeedback(undefined); setReadingFeedback(undefined); setFeedbackError(undefined);
    claimEpoch.current++; latestClaim.current = undefined; setClaim(undefined); setReadingClaim(undefined);
    setVerified(false); setReason(""); setReviewed(undefined); setOriginalReview(undefined); confirmations.current.clear(); setEditor(undefined); setPolicyReason(""); form.resetFields();
    return () => { materialRead.current.epoch++; materialRead.current.busy = false; feedbackEpoch.current++; claimEpoch.current++; };
  }, [operation.identity, form]);
  const unavailable = () => new Error(t("原企业申请材料或代表资格确认已变化，请重新核对"));
  const assertPermission = () => {
    operation.assertCurrent(); const currentAuth = useAuthStore.getState();
    if (!currentAuth.sessionVerified || !currentAuth.hasTenantMembershipPermission("rental-os:corporate:manage") || !currentAuth.hasTenantMembershipPermission("rental-os:corporate:employee-manage")) throw unavailable();
  };
  const assertMaterial = (original: EnterpriseWorkflowView, key: string, pending = false, source?: ApplicationFeedback) => {
    assertPermission();
    if (source) {
      if (source !== latestFeedback.current.feedback || source.identity !== operation.identity || source.locator !== latestFeedback.current.locator || source.material.id !== latestFeedback.current.requestedId) throw unavailable();
      const current = copyEnterpriseApplicationMaterial(source.material);
      if (!current || JSON.stringify(current) !== key || source.key !== key || pending && current.state !== "pending") throw unavailable();
      return;
    }
    const query = latestReview.current.list;
    if (query.isFetching || query.error || !Array.isArray(query.data) || query.data.length > 200) throw unavailable();
    const rows = query.data.filter(row => row.id === original.id), current = rows.length === 1 && copyEnterpriseApplicationMaterial(rows[0]);
    if (!current || JSON.stringify(current) !== key || pending && current.state !== "pending") throw unavailable();
  };
  // A locator selects only a read. Revoke old feedback immediately, without retiring
  // K or overwriting the reviewed reason; an old confirmation cannot borrow new feedback.
  const changeLocator = (value: string) => {
    operation.assertCurrent(); feedbackEpoch.current++;
    latestFeedback.current = { locator: JSON.stringify([operation.identity, value]), requestedId: value, feedback: undefined };
    setRequestedId(value); setFeedback(undefined); setReadingFeedback(undefined); setFeedbackError(undefined);
  };
  const readFeedback = async () => {
    assertPermission();
    const target = latestFeedback.current;
    if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(target.requestedId) || materialRead.current.busy) throw unavailable();
    const epoch = ++feedbackEpoch.current;
    latestFeedback.current.feedback = undefined; setFeedback(undefined); setReadingFeedback(target.locator); setFeedbackError(undefined);
    try {
      const value = await operation.read<EnterpriseWorkflowView>(`/membership/enterprise-workflows/applications/${encodeURIComponent(target.requestedId)}`);
      assertPermission();
      if (epoch !== feedbackEpoch.current || target.locator !== latestFeedback.current.locator) throw unavailable();
      const material = copyEnterpriseApplicationMaterial(value);
      if (!material || material.id !== target.requestedId) throw unavailable();
      const result = { identity: operation.identity, locator: target.locator, material, key: JSON.stringify(material) };
      latestFeedback.current.feedback = result; setFeedback(result);
    } catch (error) {
      if (epoch === feedbackEpoch.current && target.locator === latestFeedback.current.locator) setFeedbackError(target.locator);
      throw error;
    } finally { if (epoch === feedbackEpoch.current) setReadingFeedback(undefined); }
  };
  const readOriginalMaterial = async (original: EnterpriseWorkflowView, key: string, source?: ApplicationFeedback) => {
    assertMaterial(original, key, true, source);
    if (materialRead.current.busy) throw unavailable();
    const epoch = ++materialRead.current.epoch, selection = latestReview.current.selected;
    materialRead.current.busy = true; setReadingMaterial(operation.identity);
    try {
      const response = await operation.read<EnterpriseWorkflowView>(`/membership/enterprise-workflows/applications/${encodeURIComponent(original.id)}`);
      if (epoch !== materialRead.current.epoch || selection !== latestReview.current.selected) throw unavailable();
      assertMaterial(original, key, true, source);
      const material = copyEnterpriseApplicationMaterial(response);
      if (!material || material.id !== original.id || JSON.stringify(material) !== key || material.state !== "pending") throw unavailable();
      return { material, epoch };
    } finally {
      if (epoch === materialRead.current.epoch) { materialRead.current.busy = false; setReadingMaterial(undefined); }
    }
  };
  const review = async (row: EnterpriseWorkflowView, source?: ApplicationFeedback) => {
    const material = copyEnterpriseApplicationMaterial(row); if (!material) throw unavailable(); const key = JSON.stringify(material); assertMaterial(material, key, true, source);
    const previous = latestReview.current.selected;
    if (operation.blocked || materialRead.current.busy || previous && (previous.material.id !== material.id || Boolean(previous.feedback) !== Boolean(source))) throw unavailable();
    const exact = await readOriginalMaterial(material, key, source);
    operation.assertCurrent();
    if (exact.epoch !== materialRead.current.epoch || operation.blocked) throw unavailable();
    claimEpoch.current++; latestClaim.current = undefined; setClaim(undefined);
    setReviewed({ identity: operation.identity, material: exact.material, key, feedback: source }); setVerified(false); confirmations.current.clear();
    if (latestReview.current.selected?.material.id !== material.id) setReason("");
  };
  const copyClaim = (value: unknown, original: ApplicationSelection): EnterpriseApplicationClaimView | undefined => {
    const row = value as EnterpriseApplicationClaimView | null;
    if (!row || Array.isArray(row) || Object.keys(row).length !== 8 || row.readOnly !== true
      || row.applicationId !== original.material.id || row.applicationRevision !== original.material.revision
      || row.corporateCustomerId !== original.material.payload.existingCorporateCustomerId
      || typeof row.corporateCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.corporateCustomerId)
      || typeof row.corporateName !== "string" || !row.corporateName.trim() || row.corporateName.length > 191
      || typeof row.legalIdentifierMasked !== "string" || !row.legalIdentifierMasked.trim() || row.legalIdentifierMasked.length > 191
      || typeof row.migrated !== "boolean" || typeof row.hasCurrentAdministrator !== "boolean") return undefined;
    return { applicationId: row.applicationId, applicationRevision: row.applicationRevision, corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateName, legalIdentifierMasked: row.legalIdentifierMasked, migrated: row.migrated, hasCurrentAdministrator: row.hasCurrentAdministrator, readOnly: true };
  };
  const readClaimTarget = async () => {
    if (!selected || latestReview.current.selected !== selected) throw unavailable();
    assertMaterial(selected.material, selected.key, true, selected.feedback);
    const epoch = ++claimEpoch.current; latestClaim.current = undefined; setClaim(undefined); setReadingClaim(operation.identity);
    try {
      const result = await operation.read<EnterpriseApplicationClaimView>(`/membership/enterprise-workflows/applications/${encodeURIComponent(selected.material.id)}/claim-material`);
      assertMaterial(selected.material, selected.key, true, selected.feedback);
      if (epoch !== claimEpoch.current || latestReview.current.selected !== selected) throw unavailable();
      const material = copyClaim(result, selected); if (!material) throw unavailable();
      const review = { identity: operation.identity, selection: selected, material, key: JSON.stringify(material) };
      latestClaim.current = review; setClaim(review);
    } finally { if (epoch === claimEpoch.current) setReadingClaim(undefined); }
  };
  const approvalMaterialReady = (row: EnterpriseWorkflowView) => {
    const data = row.payload, acceptedAt = data.agreementAcknowledgedAt;
    return ["legalName", "region", "legalIdentifier", "contactName", "contactPhone", "authorityStatement", "agreementVersion"].every(field => typeof data[field] === "string" && String(data[field]).trim())
      && data.agreementAcknowledged === true && typeof acceptedAt === "string" && Number.isFinite(Date.parse(acceptedAt)) && Date.parse(acceptedAt) <= Date.parse(row.updatedAt)
      && Array.isArray(data.evidenceFileIds) && data.evidenceFileIds.length > 0;
  };
  const readEvidence = async (row: EnterpriseWorkflowView, fileId: string, source?: ApplicationFeedback) => {
    const original = copyEnterpriseApplicationMaterial(row); if (!original) throw unavailable(); const key = JSON.stringify(original); assertMaterial(original, key, false, source);
    if (!Array.isArray(original.payload.evidenceFileIds) || !original.payload.evidenceFileIds.includes(fileId)) throw unavailable();
    const result = await http.request<Blob>({ url: `/membership/enterprise-workflows/applications/${encodeURIComponent(original.id)}/files/${encodeURIComponent(fileId)}`, method: "get", responseType: "blob", signal: currentSessionSignal() });
    assertMaterial(original, key, false, source);
    if (!["application/pdf", "image/png", "image/jpeg"].includes(result.data.type) || !Number.isSafeInteger(result.data.size) || result.data.size < 1 || result.data.size > 20 * 1024 * 1024) throw new Error(t("材料读取结果不可核对"));
    const url = URL.createObjectURL(result.data), link = document.createElement("a");
    link.href = url; link.download = `authority-evidence.${result.data.type === "application/pdf" ? "pdf" : result.data.type === "image/png" ? "png" : "jpg"}`;
    try { link.click(); } finally { URL.revokeObjectURL(url); }
  };
  const refreshList = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const refreshPolicy = async () => { await policy.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const recoveringApplication = operation.pending?.path.startsWith("/membership/enterprise-workflows/applications/") === true;
  const recover = async () => {
    const application = recoveringApplication;
    const original = await operation.recover(async path => {
      if (path === "/membership/enterprise-workflows/invite-policy") {
        await refreshPolicy(); setEditor(undefined); setPolicyReason(""); form.resetFields();
      } else if (!application) { await refreshList(); setReviewed(undefined); confirmations.current.clear(); setVerified(false); setReason(""); }
    });
    if (application && original?.state === "committed" && original.result) {
      operation.assertCurrent();
      const result = original.result;
      setOriginalReview({ identity: operation.identity, result: { id: result.id, state: result.state, revision: result.revision, corporateCustomerId: result.corporateCustomerId } });
      if (latestReview.current.selected?.material.id === result.id) { setReviewed(undefined); setVerified(false); setReason(""); }
      for (const surface of ["list", "detail"]) for (const decision of ["approve", "reject", "supplement"]) confirmations.current.delete(`${surface}:${result.id}:${decision}`);
      // The exact original K has retired before today's material/queue read.
      // A locator selects only the current reader, never the original operation's authority.
      if (latestFeedback.current.requestedId === result.id) await readFeedback(); else await refreshList();
    }
  };
  const decide = async (original: ApplicationConfirmation) => {
    const assertOriginal = () => {
      assertMaterial(original.selection.material, original.selection.key, true, original.selection.feedback); const current = latestReview.current;
      if (current.selected !== original.selection || original.selection.identity !== operation.identity || current.reason !== original.reason || current.verified !== original.verified
        || typeof original.reason !== "string" || !original.reason.trim() || original.reason.length > 500 || typeof original.verified !== "boolean") throw unavailable();
      if (original.decision === "approve" && !enterpriseApplicationRegionHasIdentityMapping(original.selection.material.payload.region)) throw new Error(locale === "en-US" ? "No registered identity mapping for this region; the original application may be rejected or supplemented, not approved." : "该地区暂无正式企业主档映射；原申请可拒绝或要求补件，不能批准开通。");
      if (original.decision === "approve" && (!original.verified || !approvalMaterialReady(original.selection.material))) throw new Error(t("原申请缺少本人协议确认或授权材料，请要求补件"));
      if (original.decision === "approve" && original.selection.material.payload.existingCorporateCustomerId
        && (!original.claim || original.claim !== latestClaim.current || original.claim.selection !== original.selection || original.claim.material.hasCurrentAdministrator)) throw unavailable();
    };
    assertOriginal();
    return operation.run(async () => {
      // The list is not authoritative after confirmation/lock waits. Re-read the same
      // registered applicant material before creating K, without adopting changed input.
      assertOriginal(); const exact = await readOriginalMaterial(original.selection.material, original.selection.key, original.selection.feedback);
      assertOriginal(); if (exact.epoch !== materialRead.current.epoch) throw unavailable();
      if (original.decision === "approve" && original.claim) {
        const current = copyClaim(await operation.read<EnterpriseApplicationClaimView>(`/membership/enterprise-workflows/applications/${encodeURIComponent(original.selection.material.id)}/claim-material`), original.selection);
        assertOriginal(); if (!current || JSON.stringify(current) !== original.claim.key) throw unavailable();
      }
      return { path: `/membership/enterprise-workflows/applications/${encodeURIComponent(original.selection.material.id)}/decision`, method: "post",
        input: { decision: original.decision, verifiedRepresentative: original.verified, expectedRevision: original.selection.material.revision, reason: original.reason.trim() } };
    }, async () => {
      if (original.selection.feedback && original.selection.feedback.locator === latestFeedback.current.locator) {
        if (latestReview.current.selected === original.selection) { setReviewed(undefined); setVerified(false); setReason(""); }
        await readFeedback();
      } else { await refreshList(); if (latestReview.current.selected === original.selection) { setReviewed(undefined); setVerified(false); setReason(""); } }
    }, async () => { if (original.selection.feedback && original.selection.feedback.locator === latestFeedback.current.locator) await readFeedback(); else await refreshList(); });
  };
  const applicationActions = (row: EnterpriseWorkflowView, source?: ApplicationFeedback) => {
    const surface = source ? "detail" : "list";
    const blocked = source ? !canReview || operation.blocked || readingMaterial === operation.identity || readingFeedback === locator || source !== currentFeedback : reviewBlocked;
    if (selected?.material.id !== row.id || Boolean(selected.feedback) !== Boolean(source)) return row.state === "pending" ? <ActionButton disabled={blocked || Boolean(selected)} intent="review" label={t("核对本条申请")} onAction={() => review(row, source)} /> : null;
    const stale = selected.key !== JSON.stringify(row) || row.state !== "pending" || Boolean(source && selected.feedback !== source);
    return <>
      {stale && <Alert type="warning" title={t("原企业申请已变化，审核原因保留但代表资格须重新核验")}
        action={row.state === "pending" ? <ActionButton disabled={blocked} intent="review" label={t("重新核对本条申请")} onAction={() => review(row, source)} /> : undefined} />}
      {(["approve", "reject", "supplement"] as const).map(decision => {
        const key = `${surface}:${row.id}:${decision}`;
        return <ConfirmAction key={decision} disabled={blocked || stale || !reason.trim() || decision === "approve" && (!enterpriseApplicationRegionHasIdentityMapping(selected.material.payload.region) || !verified || !approvalMaterialReady(selected.material) || Boolean(selected.material.payload.existingCorporateCustomerId && (!currentClaim || currentClaim.material.hasCurrentAdministrator)))}
          label={decision === "approve" ? t("批准并开通首管") : decision === "reject" ? t("拒绝") : t("要求补件")}
          prompt={decision === "approve" ? t("批准本条原企业申请并开通首管？不会自动授信或开放租赁范围。") : t("仅记录本条原企业申请的拒绝或补件结果，原企业、会员与材料保留。")}
          onStateChange={state => { if (state === "confirming") confirmations.current.set(key, { selection: selected, decision, reason, verified, claim: currentClaim }); else if (state === "idle" || state === "done") confirmations.current.delete(key); }}
          onConfirm={async () => { const original = confirmations.current.get(key); if (!original || original.decision !== decision) throw unavailable(); return decide(original); }} />;
      })}
    </>;
  };
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
  const stateLabel = (state: EnterpriseWorkflowView["state"]) => {
    const item = ([ ["draft", "草稿", "Draft"], ["pending", "待商户审核", "Awaiting merchant review"], ["supplement_required", "要求补件", "Additional evidence requested"], ["approved", "原申请审核通过", "Original application approved"], ["rejected", "申请被拒绝", "Application rejected"], ["withdrawn", "已撤回", "Withdrawn"] ] as const).find(item => item[0] === state);
    return item ? item[locale === "en-US" ? 2 : 1] : t("企业申请材料不可核对");
  };
  return <section><h3>{t("企业申请审核")}</h3>
    <Alert type="info" title={t("申请人仅是首位管理员候选；须核验代表资格，不自动开授信或可租范围。")}/>
    {!permitted && <Alert type="warning" title={t("当前身份没有企业管理权限")}/>}
    <label htmlFor="enterprise-application-locator">{locale === "en-US" ? "Original application ID" : "原企业申请 ID"}</label>
    <Input id="enterprise-application-locator" value={requestedId} maxLength={191} disabled={!canReview} onChange={e => changeLocator(e.target.value)} />
    <ActionButton intent="review" disabled={!canReview || !/^[a-zA-Z0-9_-]{1,191}$/u.test(requestedId) || readingFeedback === locator || readingMaterial === operation.identity}
      label={locale === "en-US" ? "Read original feedback" : "读取本条申请反馈"} onAction={readFeedback} />
    {readingFeedback === locator && <p role="status">{locale === "en-US" ? "Reading original feedback" : "正在读取本条申请反馈"}</p>}
    {canReview && feedbackError === locator && <Alert type="error" title={locale === "en-US" ? "Original application feedback unavailable" : "本条原申请反馈不可读取"} />}
    {canReview && currentFeedback && <section data-enterprise-application-feedback={currentFeedback.material.id}>
      <h4>{locale === "en-US" ? "Original application feedback" : "本条原申请反馈"}</h4>
      <Alert type="info" title={locale === "en-US" ? "Feedback is not an operation receipt or current authorization" : "申请反馈不是原操作收据或当前授权"} />
      <dl>
        <dt>{locale === "en-US" ? "Original ID / revision" : "原 ID / 修订"}</dt><dd>{currentFeedback.material.id} / {currentFeedback.material.revision}</dd>
        <dt>{t("状态")}</dt><dd>{stateLabel(currentFeedback.material.state)}</dd>
        <dt>{t("原申请人引用")}</dt><dd>{currentFeedback.material.applicantCustomerId}</dd>
        <dt>{locale === "en-US" ? "Enterprise reference" : "企业引用"}</dt><dd>{currentFeedback.material.corporateCustomerId ?? t("原申请未记录")}</dd>
        {([ ["legalName", "企业名称", "Legal name"], ["region", "地区", "Region"], ["legalIdentifier", "主体标识", "Legal identifier"], ["contactName", "原申请联系人", "Original proposed contact"], ["contactPhone", "原申请联系电话", "Original contact phone"], ["email", "原申请联系邮箱", "Original contact email"], ["authorityStatement", "代表资格说明", "Authority statement"], ["agreementVersion", "原申请协议版本", "Original agreement version"], ["agreementAcknowledgedAt", "原申请协议确认时间（UTC）", "Original agreement acceptance (UTC)"] ] as const).map(([field, zh, en]) => <div key={field}><dt>{locale === "en-US" ? en : zh}</dt><dd>{String(currentFeedback.material.payload[field] ?? t("原申请未记录"))}</dd></div>)}
        <dt>{t("处理原因")}</dt><dd>{currentFeedback.material.decisionReason ?? t("原申请未记录")}</dd>
        <dt>{t("原申请时间（UTC）")}</dt><dd>{currentFeedback.material.createdAt}</dd>
        <dt>{t("原申请更新时间（UTC）")}</dt><dd>{currentFeedback.material.updatedAt}</dd>
        <dt>{t("授权材料")}</dt><dd>{Array.isArray(currentFeedback.material.payload.evidenceFileIds) ? currentFeedback.material.payload.evidenceFileIds.map((fileId, index) => <span key={String(fileId)}>{String(fileId)} <ActionButton
          disabled={!canReview || readingFeedback === locator || readingMaterial === operation.identity} intent="review" label={`${t("读取材料")} ${index + 1}`}
          onAction={() => readEvidence(currentFeedback.material, String(fileId), currentFeedback)} /></span>) : t("原申请未记录")}</dd>
      </dl>
      {applicationActions(currentFeedback.material, currentFeedback)}
    </section>}
    {readingMaterial === operation.identity && <p role="status">{locale === "en-US" ? "Reading original application material" : "正在核对原申请材料"}</p>}
    {selected && (selected.feedback ? canReview : permitted) && <>
      <p>{t("已核对的原企业申请")}: {selected.material.id} / {selected.material.revision}</p>
      <dl>
        <dt>{t("原申请人引用")}</dt><dd>{selected.material.applicantCustomerId}</dd>
        {([["contactName", "原申请联系人"], ["contactPhone", "原申请联系电话"], ["email", "原申请联系邮箱"], ["agreementVersion", "原申请协议版本"], ["agreementAcknowledgedAt", "原申请协议确认时间（UTC）"]] as const).map(([field, label]) => <div key={field}><dt>{t(label)}</dt><dd>{String(selected.material.payload[field] ?? t("原申请未记录"))}</dd></div>)}
        <dt>{t("原申请时间（UTC）")}</dt><dd>{selected.material.createdAt}</dd>
        <dt>{t("原申请更新时间（UTC）")}</dt><dd>{selected.material.updatedAt}</dd>
      </dl>
      {typeof selected.material.payload.existingCorporateCustomerId === "string" && <section>
        <p>{locale === "en-US" ? "Original existing-company target" : "原申请指定存量企业"}: {selected.material.payload.existingCorporateCustomerId}</p>
        <ActionButton intent="review" disabled={!canReview || selectedBlocked || readingClaim === operation.identity}
          label={locale === "en-US" ? "Read current claim target" : "核对存量认领目标"} onAction={readClaimTarget} />
        {readingClaim === operation.identity && <p role="status">{locale === "en-US" ? "Reading current identity facts" : "正在读取当前主体依据"}</p>}
        {currentClaim && <>
          <dl><dt>{locale === "en-US" ? "Registered company" : "已登记企业"}</dt><dd>{currentClaim.material.corporateCustomerId} / {currentClaim.material.corporateName}</dd>
            <dt>{locale === "en-US" ? "Registered identifier (masked)" : "登记主体标识（脱敏）"}</dt><dd>{currentClaim.material.legalIdentifierMasked}</dd>
            <dt>{locale === "en-US" ? "Portal migration observed" : "已观察到门户迁入"}</dt><dd>{String(currentClaim.material.migrated)}</dd>
            <dt>{locale === "en-US" ? "Current protected administrator" : "当前受保护管理员存在"}</dt><dd>{String(currentClaim.material.hasCurrentAdministrator)}</dd></dl>
          <Alert type={currentClaim.material.hasCurrentAdministrator ? "warning" : "info"} title={locale === "en-US" ? "Current read-only facts; approval still revalidates in the original transaction" : "当前只读依据，批准仍由原事务最终复验"} />
        </>}
      </section>}
      {!enterpriseApplicationRegionHasIdentityMapping(selected.material.payload.region) && <Alert type="warning" title={locale === "en-US" ? "This region has no registered identity mapping; approval is unavailable. Keep the original request and use rejection or supplement." : "该地区尚无正式企业主档映射，不能批准；保留原申请，可拒绝或要求补件。"} />}
      {!approvalMaterialReady(selected.material) && <Alert type="warning" title={t("原申请缺少本人协议确认或授权材料，请要求补件")} />}
      <Button disabled={operation.blocked || readingMaterial === operation.identity} onClick={() => { operation.assertCurrent(); if (operation.blocked || materialRead.current.busy || latestReview.current.selected !== selected) return; claimEpoch.current++; latestClaim.current = undefined; setClaim(undefined); setReadingClaim(undefined); setReviewed(undefined); confirmations.current.clear(); setVerified(false); setReason(""); }}>{t("结束审阅")}</Button>
    </>}
    <label htmlFor="enterprise-application-review-reason">{t("审核依据与原因")}</label>
    <Input.TextArea id="enterprise-application-review-reason" value={selected && (selected.feedback ? canReview : permitted) ? reason : ""} disabled={selectedBlocked || !selected} onChange={e => { if (!selected || latestReview.current.selected !== selected) return; assertMaterial(selected.material, selected.key, true, selected.feedback); setReason(e.target.value); }} maxLength={500}/>
    <Checkbox checked={Boolean(selected && (selected.feedback ? canReview : permitted) && verified)} disabled={selectedBlocked || !selected} onChange={e => { if (!selected || latestReview.current.selected !== selected) return; assertMaterial(selected.material, selected.key, true, selected.feedback); setVerified(e.target.checked); }}>{t("已核验本条原申请的代表资格及附件")}</Checkbox>
    {operation.pending && <>
      <Alert type={operation.pending.state === "committed" ? "info" : "warning"} title={operation.pending.state === "committed"
        ? t("操作已提交；只能刷新结果，不要再次发送。") : t("结果待核对，请保留原请求；没有收据不代表未写入。")}/>
      <ActionButton disabled={operation.busy || !permitted || recoveringApplication && !canReview} label={operation.pending.state === "committed" ? t("刷新已提交结果") : t("核对原操作")} intent="review" onAction={recover}/>
    </>}
    {canReview && originalReview?.identity === operation.identity && <Alert type="info"
      title={locale === "en-US" ? "Original review receipt verified; not current authorization" : "原审核收据已核对，不代表当前授权"}
      description={`${originalReview.result.id} / ${originalReview.result.state} / ${originalReview.result.revision}`} />}
    {operation.error && <Alert type="error" title={operation.error}/>}
    {(list.error || materialError) && <Alert type="error" title={t("企业申请材料不可核对")} action={<ActionButton disabled={!permitted || operation.busy} intent="review" label={t("重新读取申请")} onAction={refreshList} />} />}
    <Table rowKey="id" dataSource={permitted && !list.error ? applicationRows : []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refreshList} columns={[
      { title: t("企业"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.legalName ?? "") },
      { title: t("地区"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.region ?? "") },
      { title: t("主体标识"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.legalIdentifier ?? "") },
      { title: t("代表资格说明"), render: (_, row: EnterpriseWorkflowView) => String(row.payload.authorityStatement ?? "") },
      { title: t("授权材料"), render: (_, row: EnterpriseWorkflowView) => Array.isArray(row.payload.evidenceFileIds) ? row.payload.evidenceFileIds.map((fileId, index) => <ActionButton key={String(fileId)} disabled={reviewBlocked} intent="review" label={`${t("读取材料")} ${index + 1}`} onAction={() => readEvidence(row, String(fileId))} />) : null },
      { title: t("状态"), render: (_, row: EnterpriseWorkflowView) => stateLabel(row.state) }, { title: t("处理原因"), dataIndex: "decisionReason" },
      { title: locale === "en-US" ? "Original feedback" : "本条反馈", render: (_, row: EnterpriseWorkflowView) => <ActionButton intent="review" label={locale === "en-US" ? "Read original feedback" : "读取本条申请反馈"} disabled={!canReview || readingMaterial === operation.identity}
        onAction={async () => { assertPermission(); const material = copyEnterpriseApplicationMaterial(row); if (!material) throw unavailable(); changeLocator(material.id); await readFeedback(); }} /> },
      { title: t("操作"), render: (_, row: EnterpriseWorkflowView) => applicationActions(row) }]}/>
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
