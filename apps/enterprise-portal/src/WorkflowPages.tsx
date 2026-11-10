/** Customer-owned application and membership pages; no operator endpoint is called.
 * Each page shares one original-operation gate across all form and row actions. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ClientPublicDocumentResponse, EnterpriseApplicationInput, EnterpriseInviteCreated, EnterpriseInviteView, EnterpriseWorkflowView, EnterpriseOwnRelation, EnterpriseInvitePreview, EnterpriseOperationResult } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, ConfirmAction, Form, Input, SaveButton, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { AuthorityUpload } from "./AuthorityUpload";
import { EnterpriseWorkflowReview, readJoinReviewMaterial } from "./WorkflowReview";
import { readAdministratorTransferMaterial } from "./administrator-transfer-review";
import { EnterpriseTransferDecisionRecovery } from "./TransferDecisionRecovery";
import { EnterpriseMerchantContact } from "./MerchantContact";
import { EnterpriseOwnRentalFulfillment } from "./OwnRentalFulfillment";
import { EnterpriseOwnRentalHandoffs } from "./OwnRentalHandoffs";
import { EnterpriseMemberOperationRecovery } from "./MemberOperationRecovery";
import { clearEnterpriseInvite, readEnterpriseInvite } from "@rental-os/web-client";
import { copyEnterpriseApplicationMaterial } from "@/components/enterprise-application-material";
import { enterpriseApplicationRegionHasIdentityMapping } from "@rental-os/shared";

type OriginalOperation = ReturnType<typeof useOriginalWorkflowOperation>;
const invitationSnapshot = (value: EnterpriseInvitePreview): EnterpriseInvitePreview | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.semantics !== "join_request_only"
    || typeof value.corporateName !== "string" || !value.corporateName.trim() || value.corporateName.length > 191
    || typeof value.agreementVersion !== "string" || !value.agreementVersion.trim() || value.agreementVersion.length > 191
    || typeof value.noticeText !== "string" || !value.noticeText.trim() || value.noticeText.length > 4000
    || typeof value.noticeHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.noticeHash)
    || typeof value.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expiresAt)
    || !Number.isFinite(Date.parse(value.expiresAt)) || new Date(value.expiresAt).toISOString() !== value.expiresAt) return undefined;
  // Original server material only; no today's-policy fallback or private/raw-code properties.
  return { corporateName: value.corporateName, agreementVersion: value.agreementVersion, noticeText: value.noticeText,
    noticeHash: value.noticeHash, expiresAt: value.expiresAt, semantics: "join_request_only" };
};
type ApplicationFormValues = Omit<EnterpriseApplicationInput, "evidenceFileIds"> & { evidenceFileIds?: string | string[] };
type ApplicationEditing = EnterpriseWorkflowView & { source?: "feedback"; feedbackKey?: string };
type ApplicationWithdrawalReview = { identity: string; locator: string; source: "list" | "feedback"; material: EnterpriseWorkflowView; key: string };
const applicationFields = ["legalName", "region", "legalIdentifier", "contactName", "contactPhone", "email", "authorityStatement", "evidenceFileIds", "agreementVersion", "existingCorporateCustomerId"] as const;
/** Copy registered input and preserve the existing CSV transform; legal/region/file authorization stays server-side. */
const applicationInputSnapshot = (value: unknown): EnterpriseApplicationInput => {
  const invalid = () => new Error("企业申请字段缺失或无效，保留输入 / Application input unavailable");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(field => !applicationFields.some(registered => registered === field))) throw invalid();
  const text = (field: string, max: number, optional = false): string | undefined => {
    const item = data[field]; if (optional && item === undefined) return undefined;
    if (typeof item !== "string" || item.length > max || !optional && !item.trim()) throw invalid(); return item;
  };
  const required = (field: string, max: number) => text(field, max)!;
  const raw = data.evidenceFileIds, ids = typeof raw === "string" ? raw.split(",").map(item => item.trim()).filter(Boolean) : Array.isArray(raw) ? [...raw] : raw ?? [];
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw invalid();
  return { legalName: required("legalName", 191), region: required("region", 80), legalIdentifier: required("legalIdentifier", 191), contactName: required("contactName", 120),
    contactPhone: required("contactPhone", 32), email: text("email", 191, true), authorityStatement: required("authorityStatement", 2000), evidenceFileIds: [...ids],
    agreementVersion: required("agreementVersion", 191), existingCorporateCustomerId: text("existingCorporateCustomerId", 191, true) };
};
const applicationEditingSnapshot = (row: EnterpriseWorkflowView): EnterpriseWorkflowView | undefined => {
  const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!row || row.kind !== "corporate_application" || !["draft", "supplement_required"].includes(row.state) || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.id)
    || typeof row.applicantCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.applicantCustomerId)
    || !Number.isSafeInteger(row.revision) || row.revision < 1 || !utc(row.createdAt) || !utc(row.updatedAt)) return undefined;
  try {
    const fields = Object.fromEntries(applicationFields.map(field => [field, row.payload?.[field]])), application = applicationInputSnapshot(fields);
    return { id: row.id, kind: row.kind, state: row.state, revision: row.revision, applicantCustomerId: row.applicantCustomerId, createdAt: row.createdAt, updatedAt: row.updatedAt,
      corporateCustomerId: row.corporateCustomerId, decisionReason: row.decisionReason, payload: { ...application, evidenceFileIds: [...application.evidenceFileIds] } };
  } catch { return undefined; }
};
const applicationEditingKey = (row?: EnterpriseWorkflowView) => row && JSON.stringify(applicationEditingSnapshot(row));
const applicationAgreementKey = (document: ClientPublicDocumentResponse | undefined, tenantCode: string) => document?.tenantCode === tenantCode && document.kind === "user_agreement"
  && typeof document.name === "string" && (document.version === undefined || typeof document.version === "string") && (document.body === undefined || typeof document.body === "string")
  ? JSON.stringify([document.tenantCode, document.kind, document.name, document.version, document.body]) : undefined;
const applicationFeedbackSnapshot = (row: EnterpriseWorkflowView, id: string, customerId?: string): EnterpriseWorkflowView | undefined => {
  const original = copyEnterpriseApplicationMaterial(row);
  return original && customerId && original.id === id && original.applicantCustomerId === customerId ? original : undefined;
};
type ExitReview = { identity: string; key: string; relation: EnterpriseOwnRelation; reason: string; confirmed: boolean };
const exitRelationKey = (identity: string, row: EnterpriseOwnRelation) => JSON.stringify([identity, row.corporateCustomerId, row.membershipId,
  row.updatedAt, row.role, row.status, row.department, row.employeeNo, row.effectiveFrom, row.effectiveTo]);
const exitRelationSnapshot = (row: EnterpriseOwnRelation): EnterpriseOwnRelation => ({ corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateName,
  membershipId: row.membershipId, displayName: row.displayName, updatedAt: row.updatedAt, role: row.role, status: row.status,
  department: row.department, employeeNo: row.employeeNo, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo });
function OperationStatus({ operation, refresh, en, onRecovered, onExitRecovered, transferRow, transferUnavailable = true }: { operation: OriginalOperation; refresh: () => Promise<void>; en: boolean; onRecovered?: (path?: string, original?: EnterpriseOperationResult) => void | Promise<void>; onExitRecovered?: () => void; transferRow?: EnterpriseWorkflowView; transferUnavailable?: boolean }) {
  if (operation.transferDecisionId) return <EnterpriseTransferDecisionRecovery row={transferRow} operation={operation} refresh={refresh} unavailable={transferUnavailable} english={en}/>;
  if (operation.applicationSave) return <section aria-label={en ? "Original application save recovery" : "原企业申请保存核对"}>
    <Alert type="warning" title={en ? "Read the original save only; current draft material or approval cannot prove this key." : "仅读原保存；今天草稿材料或审核不能证明原键。"}
      description={en ? "Missing receipts never allow replay. A saved draft or pending request is not enterprise membership or management authority." : "缺收据不允许重发；原草稿或待审结果不是企业会员或管理权限。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original application save" : "核对原企业申请保存"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.applicationWithdrawalId) return <section aria-label={en ? "Original application withdrawal recovery" : "原企业申请撤回核对"}>
    <Alert type="warning" title={en ? "Read the original application withdrawal only; today's state cannot prove this key." : "仅核对原企业申请撤回；今天状态不能证明该原键。"}
      description={en ? "Missing receipts never allow replay. Withdrawal does not delete enterprise/member records or archived evidence." : "缺收据不允许重发；撤回不删除企业、会员或归档材料。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original application withdrawal" : "核对原企业申请撤回"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); await onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.joinSubmission) return <section aria-label={en ? "Original join submission recovery" : "原加入提交核对"}>
    <Alert type="warning" title={en ? "Read only your original join key; do not regenerate the code or resend." : "只核对本人原加入键，不补邀请码或重发。"}
      description={en ? "Original pending or already-member results are not current authority. A persisted refusal is not admission; missing receipts prove neither rollback nor replay safety." : "原待审或已有关系不代表当前权限，原拒绝不代表入企；缺收据不证明回滚或可重发。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original join submission" : "核对原加入提交"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.joinReviewTarget) return <section aria-label={en ? "Original join review recovery" : "原加入审核核对"}>
    <Alert type="warning" title={en ? "Read this original review only; today's request or member state cannot prove its key." : "仅核对本条原审核；今天申请或成员状态不能证明原键结果。"}
      description={en ? "Missing evidence never permits replay. Historical approval is not today's membership or management authority." : "缺证据不允许重发；历史批准不代表今天成员或管理权限。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original join review" : "核对原加入审核"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.joinWithdrawalId) return <section aria-label={en ? "Original join withdrawal recovery" : "原加入申请撤回核对"}>
    <Alert type="warning" title={en ? "Read the original withdrawal only; today's request state cannot prove this key." : "仅核对原撤回；今日申请状态不能证明该原键结果。"}
      description={en ? "Missing evidence never permits replay. Withdrawal does not remove joined members or cancel rentals." : "缺证据不允许重发；撤回申请不移除已加入成员或取消租赁。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original join withdrawal" : "核对原加入申请撤回"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.inviteRevocationTarget) return <section aria-label={en ? "Original invite revocation recovery" : "原邀请停用核对"}>
    <Alert type="warning" title={en ? "Read the original revocation only; current revoked state or expiry cannot prove this key." : "只核对原停用；当前已停用或到期不证明该原键结果。"}
      description={en ? "A missing receipt never permits replay. Revocation does not remove already joined members." : "缺收据不允许重发；停用邀请不移除已加入成员。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original invite revocation" : "核对原邀请停用"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.inviteCreationCorporateId) return <section aria-label={en ? "Original invite creation recovery" : "原邀请创建核对"}>
    <Alert type="warning" title={en ? "Read the original creation only; the raw invite code is returned once and cannot be recovered." : "只核对原创建；邀请码原码仅首次返回，不能回读或补造。"}
      description={en ? "A missing receipt does not prove no write. Original creation is not today's invitation availability." : "缺收据不代表未写入；原创建不代表今天邀请仍可用。"} />
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original invite creation" : "核对原邀请创建"} onAction={async () => {
      const path = operation.pending?.path, original = await operation.recover(async () => {});
      operation.assertCurrent(); onRecovered?.(path, original);
    }} />
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
  if (operation.memberExitTarget) return <section aria-label={en ? "Original exit recovery" : "原退出结果核对"}>
    <Alert type="warning" title={en ? "Keep the original exit; a missing receipt does not prove no write." : "保留原退出；缺收据不代表未写入。"}
      description={en ? "This reads the original exit, not today's relationship or a completed business handoff." : "仅核对原退出，不代表当前关系状态或业务交接已完成。"}/>
    <ActionButton disabled={operation.busy} intent="review" label={en ? "Read original exit result" : "核对原退出结果"} onAction={async () => {
      const original = await operation.recover(async (_, path) => { await refresh(); operation.assertCurrent(); onRecovered?.(path); });
      operation.assertCurrent(); if (original?.state === "committed" && original.result?.status === "exited") onExitRecovered?.();
    }}/>
    {operation.error && <Alert type="error" title={operation.error}/>}</section>;
  return <>
    {operation.pending && <>
      <Alert type={operation.pending.state === "committed" ? "info" : "warning"} title={operation.pending.state === "committed"
        ? (en ? "The operation committed. Refresh only; do not send it again." : "操作已提交；只能刷新结果，不要再次发送。")
        : (en ? "The outcome is unconfirmed. Keep the original request; a missing receipt does not mean no write." : "结果待核对，请保留原请求；没有收据不代表未写入。")}/>
      <ActionButton disabled={operation.busy} label={operation.pending.state === "committed" ? (en ? "Refresh committed result" : "刷新已提交结果") : (en ? "Read original result" : "核对原操作")}
        intent="review" onAction={() => operation.recover(async (_, path) => { await refresh(); operation.assertCurrent(); onRecovered?.(path); })} />
    </>}
    {operation.error && <Alert type="error" title={operation.error}/>}</>;
}

export function EnterpriseApplicationPage() {
  const context = useEnterprise(), { locale } = useLocale(), en = locale === "en-US", location = useLocation();
  const requestIds = new URLSearchParams(location.search).getAll("requestId"), requestedId = requestIds.length === 1 ? requestIds[0] : requestIds.length > 1 ? "" : undefined;
  const validLocator = requestedId === undefined || /^[a-zA-Z0-9_-]{1,191}$/u.test(requestedId), locator = JSON.stringify([context.identity, requestedId]);
  const latestLocator = useRef(locator); latestLocator.current = locator;
  const operation = useOriginalWorkflowOperation("applications");
  const [editing, setEditing] = useState<ApplicationEditing>(), [fileBusy, setFileBusy] = useState(false), [accepted, setAccepted] = useState(false);
  const [withdrawal, setWithdrawal] = useState<{ identity: string; id: string; revision: number }>();
  const withdrawalReviews = useRef(new Map<string, ApplicationWithdrawalReview>());
  const [saved, setSaved] = useState<{ identity: string; id: string; state: string; revision: number }>(), [acceptedDocumentKey, setAcceptedDocumentKey] = useState<string>();
  const [feedback, setFeedback] = useState<{ identity: string; locator: string; id: string; busy: boolean; data?: EnterpriseWorkflowView; error?: string }>();
  const latestFeedback = useRef(feedback); latestFeedback.current = feedback;
  const feedbackEpoch = useRef(0), feedbackMounted = useRef(true), feedbackIdentity = useRef(context.identity); feedbackIdentity.current = context.identity;
  useEffect(() => { feedbackMounted.current = true; return () => { feedbackMounted.current = false; feedbackEpoch.current++; }; }, []);
  useEffect(() => { feedbackEpoch.current++; setFeedback(undefined); }, [context.identity]);
  const [form] = Form.useForm<ApplicationFormValues>();
  const region = Form.useWatch("region", form);
  const regionMapped = enterpriseApplicationRegionHasIdentityMapping(region);
  const list = useQuery({ queryKey: ["enterprise-applications", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>("/enterprise/applications", signal) });
  const agreement = useQuery({ queryKey: ["enterprise-agreement", context.identity], queryFn: ({ signal }) => operation.read<ClientPublicDocumentResponse>(`/public/documents/user_agreement?tenantCode=${encodeURIComponent(context.tenantCode)}`, signal) });
  const baseUnavailable = context.loading || operation.blocked || fileBusy || !validLocator;
  const listUnavailable = baseUnavailable || list.isFetching || Boolean(list.error) || !list.data;
  const detailUnavailable = !feedback || feedback.identity !== context.identity || feedback.locator !== locator || feedback.busy || Boolean(feedback.error) || feedback.id !== editing?.id || !feedback.data;
  const unavailable = editing?.source === "feedback" ? baseUnavailable || detailUnavailable : listUnavailable;
  const latestApplications = useRef({ rows: list.data, editing, readable: false });
  latestApplications.current = { rows: list.data, editing, readable: !context.loading && !fileBusy && !list.isFetching && !list.error && Boolean(list.data) };
  const documentKey = applicationAgreementKey(agreement.data, context.tenantCode), canAccept = Boolean(documentKey && typeof agreement.data?.body === "string" && agreement.data.body.trim() && typeof agreement.data.version === "string" && agreement.data.version.trim() && !agreement.error && !agreement.isFetching);
  const latestSave = useRef({ editing, accepted, acceptedDocumentKey, document: agreement.data, agreementError: agreement.error, agreementFetching: agreement.isFetching, fileBusy, loading: context.loading });
  latestSave.current = { editing, accepted, acceptedDocumentKey, document: agreement.data, agreementError: agreement.error, agreementFetching: agreement.isFetching, fileBusy, loading: context.loading };
  useEffect(() => { setEditing(undefined); setAccepted(false); setAcceptedDocumentKey(undefined); setWithdrawal(undefined); withdrawalReviews.current.clear(); setSaved(undefined); form.resetFields(); }, [context.identity, form]);
  useEffect(() => { setAccepted(false); setAcceptedDocumentKey(undefined); }, [documentKey]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const refreshRevision = async () => {
    const result = await list.refetch({ throwOnError: true }); operation.assertCurrent();
    // Keep the old material and input. Only an explicit Edit can review/rebind a new revision.
    if (editing && !result.data?.some(row => row.id === editing.id)) throw new Error(en ? "The original application is no longer readable." : "原申请已不可读取，请保留表单并核对。");
  };
  const readFeedback = async (id: string) => {
    operation.assertCurrent();
    const unavailable = en ? "Original application feedback is unavailable; keep any retained command references." : "原企业申请反馈未取得，请保留原操作引用。";
    if (!validLocator || latestLocator.current !== locator || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new Error(unavailable);
    const epoch = ++feedbackEpoch.current; setFeedback(undefined);
    const active = () => feedbackMounted.current && feedbackEpoch.current === epoch && feedbackIdentity.current === context.identity && latestLocator.current === locator && !context.signal.aborted;
    setFeedback({ identity: context.identity, locator, id, busy: true });
    try {
      const result = await operation.read<EnterpriseWorkflowView>(`/enterprise/applications/${encodeURIComponent(id)}`), original = applicationFeedbackSnapshot(result, id, context.session?.customer.customerId);
      if (!active() || !original) throw new Error(unavailable);
      setFeedback({ identity: context.identity, locator, id, busy: false, data: original });
    } catch {
      if (active()) setFeedback({ identity: context.identity, locator, id, busy: false, error: unavailable });
      throw new Error(unavailable);
    }
  };
  useEffect(() => {
    // Only locator/session readiness triggers this read; it never opens an editor or resolves K.
    if (requestedId === undefined) return;
    if (!validLocator) { feedbackEpoch.current++; setFeedback(undefined); return; }
    if (!context.loading && context.session && !context.signal.aborted) void readFeedback(requestedId).catch(() => undefined);
  }, [locator, context.loading, Boolean(context.session), context.signal]);
  const feedbackStillCurrent = (id: string) => latestFeedback.current?.id === id && latestFeedback.current.locator === latestLocator.current;
  const readOriginalApplication = async (id: string) => {
    operation.assertCurrent(); const epoch = feedbackEpoch.current, visible = latestFeedback.current;
    const assertVisible = () => {
      operation.assertCurrent(); const now = latestFeedback.current;
      if (!feedbackMounted.current || feedbackEpoch.current !== epoch || feedbackIdentity.current !== context.identity || latestLocator.current !== locator || context.signal.aborted
        || !context.session || latestSave.current.loading || latestSave.current.fileBusy || now !== visible || now?.identity !== context.identity || now.locator !== locator || now.id !== id || now.busy || now.error || !now.data) throw new Error("原本人申请详情已变化或不可核对 / Original own application detail unavailable");
    };
    assertVisible(); const result = await operation.read<EnterpriseWorkflowView>(`/enterprise/applications/${encodeURIComponent(id)}`); assertVisible();
    const original = applicationFeedbackSnapshot(result, id, context.session?.customer.customerId);
    if (!original) throw new Error("原本人申请材料不可核对 / Original own application material unavailable"); return original;
  };
  const refreshEditing = async (original?: ApplicationEditing) => {
    if (original?.source === "feedback" && feedbackStillCurrent(original.id)) await readFeedback(original.id); else await refresh();
  };
  const refreshEditingRevision = async (original?: ApplicationEditing) => {
    if (original?.source === "feedback" && feedbackStillCurrent(original.id)) await readFeedback(original.id); else await refreshRevision();
  };
  const feedbackAction = (row: EnterpriseWorkflowView) => {
    const id = row.id;
    return <ActionButton disabled={!validLocator || context.loading || !context.session || feedback?.busy && feedback.id === id} intent="review" label={en ? "Read application feedback" : "核对申请反馈"} onAction={() => readFeedback(id)} />;
  };
  const recordWithdrawal = (result: Record<string, unknown>) => {
    operation.assertCurrent(); if (typeof result.id === "string" && result.state === "withdrawn" && typeof result.revision === "number") setWithdrawal({ identity: context.identity, id: result.id, revision: result.revision });
  };
  const retireEditing = (id: string) => {
    if (latestApplications.current.editing?.id === id) { setEditing(current => current?.id === id ? undefined : current); form.resetFields(); }
  };
  const refreshWithdrawal = async (id: string, source: ApplicationWithdrawalReview["source"]) => {
    if (source === "feedback" && feedbackStillCurrent(id)) await readFeedback(id); else await refresh();
  };
  const recoverWithdrawal = async (id: string, result: Record<string, unknown>) => {
    recordWithdrawal(result); retireEditing(id);
    withdrawalReviews.current.delete(`list:${id}`); withdrawalReviews.current.delete(`feedback:${id}`);
    await refreshWithdrawal(id, feedbackStillCurrent(id) ? "feedback" : "list");
  };
  const withdrawalAction = (row: EnterpriseWorkflowView, source: ApplicationWithdrawalReview["source"] = "list") => {
    const material = row && applicationFeedbackSnapshot(row, row.id, context.session?.customer.customerId);
    if (!material) return <Alert type="warning" title={en ? "Original application unavailable" : "原本人申请不可核对"} />;
    const reviewKey = `${source}:${material.id}`, changed = () => new Error("原本人企业申请已变化，须重新核对 / Original own application changed");
    const assertWithdrawal = (original: ApplicationWithdrawalReview) => {
      operation.assertCurrent(); const applications = latestApplications.current, visible = latestFeedback.current;
      const current = original.source === "feedback" ? visible?.data : applications.rows?.find(item => item.id === original.material.id);
      const value = current && applicationFeedbackSnapshot(current, original.material.id, context.session?.customer.customerId);
      if (original.identity !== context.identity || latestSave.current.loading || latestSave.current.fileBusy || !context.session
        || original.source === "list" && !applications.readable
        || original.source === "feedback" && (original.locator !== latestLocator.current || !visible || visible.locator !== latestLocator.current || visible.identity !== context.identity || visible.id !== original.material.id || visible.busy || visible.error)
        || !value || !["draft", "pending", "supplement_required"].includes(value.state) || JSON.stringify(value) !== original.key) throw changed();
    };
    return <ConfirmAction disabled={!context.session || (source === "feedback" ? baseUnavailable || feedback?.id !== material.id || feedback.busy || Boolean(feedback.error) : listUnavailable)} label={en ? "Withdraw" : "撤回"}
      prompt={`${en ? "Withdraw this unfinished enterprise application? Enterprise/member records and archived evidence are retained." : "撤回本条未完成企业申请？企业、会员及归档材料保留。"} ${material.id} / ${material.revision}`}
      onStateChange={state => {
        // The latest callback cannot replace the original opening or borrow another surface.
        if (state === "confirming") withdrawalReviews.current.set(reviewKey, { identity: context.identity, locator, source, material, key: JSON.stringify(material) });
        else if (state === "idle" || state === "done") withdrawalReviews.current.delete(reviewKey);
      }} onConfirm={async () => {
        const original = withdrawalReviews.current.get(reviewKey); if (!original) throw changed(); assertWithdrawal(original);
        return operation.run<Record<string, unknown>>(async () => {
          assertWithdrawal(original);
          if (original.source === "feedback") {
            const current = await readOriginalApplication(original.material.id);
            if (JSON.stringify(current) !== original.key) throw changed(); assertWithdrawal(original);
          }
          return { path: `/enterprise/applications/${encodeURIComponent(original.material.id)}/withdraw`, input: { expectedRevision: original.material.revision, reason: "申请人明确撤回" } };
        }, async result => { recordWithdrawal(result); await refreshWithdrawal(original.material.id, original.source); retireEditing(original.material.id); }, () => refreshWithdrawal(original.material.id, original.source));
      }} />;
  };
  const recordSave = (result: Record<string, unknown>) => {
    operation.assertCurrent(); if (typeof result.id === "string" && typeof result.state === "string" && typeof result.revision === "number") setSaved({ identity: context.identity, id: result.id, state: result.state, revision: result.revision });
  };
  const fillApplicationEditor = (snapshot: ApplicationEditing) => {
    setEditing(snapshot); setAccepted(false); setAcceptedDocumentKey(undefined); form.resetFields();
    const application = applicationInputSnapshot(snapshot.payload);
    form.setFieldsValue({ ...application, evidenceFileIds: application.evidenceFileIds.join(",") });
  };
  const editApplication = (row: EnterpriseWorkflowView) => {
    operation.assertCurrent(); const latest = latestApplications.current, current = latest.rows?.find(item => item.id === row.id), snapshot = current && applicationEditingSnapshot(current);
    if (!latest.readable || !snapshot || snapshot.applicantCustomerId !== context.session?.customer.customerId || applicationEditingKey(row) !== applicationEditingKey(snapshot)) throw new Error("原企业申请材料已变化或不可编辑 / Original application material unavailable");
    fillApplicationEditor(snapshot);
  };
  const editFeedback = async () => {
    operation.assertCurrent(); const visible = latestFeedback.current, original = visible?.data, key = original && JSON.stringify(original);
    if (operation.blocked || latestSave.current.loading || latestSave.current.fileBusy || !original || !applicationEditingSnapshot(original)
      || latestSave.current.editing && latestSave.current.editing.id !== original.id) throw new Error("请先结束原编辑，再核对本条补件 / Close the original editor before reviewing this application");
    const current = await readOriginalApplication(original.id), snapshot = applicationEditingSnapshot(current);
    if (latestFeedback.current !== visible || !snapshot || JSON.stringify(current) !== key || latestSave.current.fileBusy
      || latestSave.current.editing && latestSave.current.editing.id !== original.id) throw new Error("原申请详情已变化，保留输入 / Original application detail changed; keep input");
    fillApplicationEditor({ ...snapshot, source: "feedback", feedbackKey: key });
  };
  const currentApplicationInput = () => applicationInputSnapshot(Object.fromEntries(applicationFields.map(field => [field, form.getFieldValue(field)])));
  const freezeSave = (submit: boolean, validated?: ApplicationFormValues) => ({ identity: context.identity, locator, submit, editing, key: applicationEditingKey(editing), documentKey,
    documentVersion: agreement.data?.version, accepted, acceptedDocumentKey, application: validated === undefined ? currentApplicationInput() : applicationInputSnapshot(validated) });
  const capturedSave = useRef<{ value?: ReturnType<typeof freezeSave>; error?: Error } | undefined>(undefined);
  const captureSave = (submit: boolean) => {
    // SaveButton validates before onSave, and ConfirmAction invokes its latest callback.
    try { capturedSave.current = { value: freezeSave(submit) }; } catch (error) { capturedSave.current = { error: error instanceof Error ? error : new Error("申请输入不可核对 / Application input unavailable") }; }
  };
  const save = async (submit: boolean, validated?: ApplicationFormValues) => {
    const captured = capturedSave.current; capturedSave.current = undefined;
    if (captured?.error) throw captured.error;
    const original = captured?.value ?? freezeSave(submit, validated), application = original.application;
    if (original.identity !== context.identity || original.submit !== submit || validated && JSON.stringify(applicationInputSnapshot(validated)) !== JSON.stringify(application)) throw new Error("申请身份或输入已变化，保留原引用 / Application identity or input changed; keep original references");
    const assertOriginal = () => {
      operation.assertCurrent(); const latest = latestSave.current, applications = latestApplications.current, visible = latestFeedback.current;
      if (submit && !enterpriseApplicationRegionHasIdentityMapping(original.application.region)) throw new Error(en ? "This region has no registered identity mapping; online submission is unavailable. Original applications and receipts are retained." : "该地区缺少正式企业主档映射，当前不能在线提交；原申请和收据保留。");
      const current = original.editing?.source === "feedback" ? visible?.data : original.editing && applications.rows?.find(row => row.id === original.editing!.id);
      if (original.identity !== context.identity || latest.loading || latest.fileBusy || latest.editing !== original.editing || original.editing?.source !== "feedback" && !applications.readable
        || original.editing?.source === "feedback" && (original.locator !== latestLocator.current || !visible || visible.locator !== latestLocator.current || visible.identity !== context.identity || visible.busy || visible.error || visible.id !== original.editing.id || JSON.stringify(visible.data) !== original.editing.feedbackKey)
        || original.editing && (!current || current.applicantCustomerId !== context.session?.customer.customerId || applicationEditingKey(current) !== original.key)
        || applicationAgreementKey(latest.document, context.tenantCode) !== original.documentKey) throw new Error("原申请材料、修订或协议已变化，须重新核对 / Original application, revision or agreement changed");
      if (submit && (!original.documentKey || !original.accepted || original.acceptedDocumentKey !== original.documentKey || !latest.accepted || latest.acceptedDocumentKey !== original.documentKey
        || latest.agreementError || latest.agreementFetching || typeof latest.document?.body !== "string" || !latest.document.body.trim() || typeof latest.document.version !== "string" || !latest.document.version.trim())) throw new Error("须本人重新读取并同意当前商户协议 / Read and explicitly accept the merchant agreement");
    };
    await operation.run<Record<string, unknown>>(async () => {
      assertOriginal(); const validatedInput = applicationInputSnapshot(await form.validateFields()); assertOriginal();
      if (JSON.stringify(validatedInput) !== JSON.stringify(application)) throw new Error("申请输入已变化，保留表单 / Application input changed");
      if (original.editing?.source === "feedback") {
        const current = await readOriginalApplication(original.editing.id);
        if (JSON.stringify(current) !== original.editing.feedbackKey) throw new Error("原本人申请材料已变化，须重新核对 / Original own application material changed");
        assertOriginal();
      }
      if (JSON.stringify(currentApplicationInput()) !== JSON.stringify(application)) throw new Error("申请输入已变化，保留表单 / Application input changed");
      return { path: "/enterprise/applications", input: { requestId: original.editing?.id, expectedRevision: original.editing?.revision ?? 0,
        reason: submit ? "本人提交企业申请" : "本人保存企业申请草稿", submit, application: { ...application, evidenceFileIds: [...application.evidenceFileIds],
          agreementVersion: original.documentKey ? original.documentVersion ?? application.agreementVersion : application.agreementVersion, agreementAcknowledged: submit && original.accepted } } };
    }, async result => { recordSave(result); await refreshEditing(original.editing); if (latestSave.current.editing === original.editing) { setEditing(undefined); form.resetFields(); } }, () => refreshEditingRevision(original.editing));
  };
  return <section><h2>{en ? "Apply for enterprise membership" : "申请企业会员"}</h2>
    <Alert type="info" title={en ? "An application is not approval. The merchant verifies your authority." : "提交仅是申请，由商户核验企业及代表资格。"}/>
    <Alert type={regionMapped ? "info" : "warning"} title={en ? "Online submission and claiming currently use the registered CN corporate identity port only." : "在线提交与存量认领目前仅接通 CN 企业主档端口。"}
      description={en ? "Other regions have no registered mapping; an existing-company ID does not bypass this limit. Original records, draft rules, withdrawal and receipt recovery remain available under their own checks." : "其他地区尚无正式映射，填写存量企业引用也不能绕过；原记录、原草稿规则、本人撤回和原收据核对仍按各自门槛保留。"}/>
    {!validLocator && <Alert type="warning" title={en ? "Original application locator is invalid; reopen the registered task entry." : "原申请定位无效，请从登记待办入口重新打开。"} />}
    <EnterpriseMemberOperationRecovery english={en}/>
    <Form form={form} layout="vertical" disabled={unavailable}>
      {[["legalName", "企业法定名称 / Legal name"], ["region", "地区代码 / Region"], ["legalIdentifier", "主体标识 / Legal identifier"], ["contactName", "联系人 / Contact"], ["contactPhone", "联系电话 / Phone"], ["email", "邮箱 / Email"], ["existingCorporateCustomerId", "存量企业引用（仅商户提供） / Existing reference"], ["agreementVersion", "商户协议版本 / Agreement version"], ["authorityStatement", "代表资格说明 / Authority statement"], ["evidenceFileIds", "已归档授权附件引用（逗号分隔） / Evidence references"]].map(([name, label]) =>
        <Form.Item key={name} name={name} label={label} rules={!["email", "existingCorporateCustomerId", "evidenceFileIds"].includes(name) ? [{ required: true, whitespace: true }] : []}><Input maxLength={name === "authorityStatement" ? 2000 : 191}/></Form.Item>)}
      <Alert type="info" title={en ? "Only real archived authority files are accepted. If storage is unavailable, save a draft." : "提交只接受真实归档授权材料；存储未配置时可保存草稿，不能假归档。"}/>
    </Form>
    <AuthorityUpload english={en} disabled={unavailable} onBusy={setFileBusy} onFile={id => { const previous = form.getFieldValue("evidenceFileIds"); const ids = Array.isArray(previous) ? previous : String(previous ?? "").split(",").filter(Boolean); form.setFieldValue("evidenceFileIds", [...new Set([...ids, id])].join(",")); }} />
    {agreement.error ? <Alert type="error" title={en ? "Merchant agreement could not be read" : "商户协议读取失败，不能提交"} /> : documentKey && typeof agreement.data?.body === "string" && agreement.data.body ? <details><summary>{agreement.data.name} / {agreement.data.version}</summary><pre>{agreement.data.body}</pre></details> : <Alert type="warning" title={en ? "No in-app merchant agreement text; submission unavailable" : "商户协议正文未提供，暂不能提交；不打开未经核验的外部链接"} />}
    {editing && <p>{en ? "Editing original application" : "正在编辑原企业申请"}: {editing.id} / {editing.revision}</p>}
    {editing && (editing.source === "feedback" ? editing.feedbackKey !== JSON.stringify(feedback?.data) : applicationEditingKey(editing) !== applicationEditingKey(list.data?.find(row => row.id === editing.id))) && <Alert type="warning" title={en ? "Original application changed or detail unavailable. Old input is retained; explicitly edit again to review the new revision." : "原申请已变化或详情不可核对，保留旧输入；须明确重新编辑以审阅新修订。"} />}
    {editing && <Button disabled={operation.blocked || fileBusy} onClick={() => { operation.assertCurrent(); if (operation.blocked || latestSave.current.fileBusy) throw new Error("原操作未决，请保留编辑 / Keep the editor while the original operation is unresolved"); setEditing(undefined); setAccepted(false); setAcceptedDocumentKey(undefined); form.resetFields(); }}>{en ? "Close original editor" : "结束原编辑"}</Button>}
    <Checkbox checked={accepted && acceptedDocumentKey === documentKey} disabled={unavailable || !canAccept} onChange={event => {
      setAccepted(event.target.checked && canAccept); setAcceptedDocumentKey(event.target.checked && canAccept ? documentKey : undefined);
      if (canAccept && agreement.data?.version) form.setFieldValue("agreementVersion", agreement.data.version);
    }}>{en ? "I have read and accept the current merchant agreement" : "我已阅读并同意当前商户协议"}</Checkbox>
    <SaveButton form={form} disabled={unavailable} label={en ? "Save draft" : "保存草稿"} onClickCapture={() => captureSave(false)} onSave={values => save(false, values)} />
    <ConfirmAction disabled={unavailable || !regionMapped || !accepted || acceptedDocumentKey !== documentKey || !canAccept} label={en ? "Submit application" : "提交申请"}
      prompt={en ? "Submit this reviewed application for merchant verification? No membership or management authority is granted yet." : "提交已核对的本条企业申请供商户核验？尚不授企业会员或管理权限。"}
      onStateChange={state => { if (state === "confirming") captureSave(true); else if (state === "idle" || state === "done") capturedSave.current = undefined; }} onConfirm={() => save(true)} />
    {saved?.identity === context.identity && <Alert type="info" title={en ? "Original application save verified" : "原企业申请保存已核对"} description={`${saved.id} / ${saved.state} / ${saved.revision} / ${en ? "Historical result only; the merchant must separately verify membership and representative authority." : "仅为历史结果，企业会员和代表资格仍由商户另行核验。"}`} />}
    {withdrawal?.identity === context.identity && <Alert type="info" title={en ? "Original application withdrawal verified" : "原企业申请撤回已核对"} description={`${withdrawal.id} / ${withdrawal.revision} / ${en ? "Original request only; enterprise, membership and evidence remain." : "仅为原申请结果，企业、会员和材料保留。"}`} />}
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={(path, original) => {
      if (operation.applicationWithdrawalId && path === `/enterprise/applications/${encodeURIComponent(operation.applicationWithdrawalId)}/withdraw` && original?.state === "committed" && original.result) {
        return recoverWithdrawal(operation.applicationWithdrawalId, original.result);
      }
      if (path === "/enterprise/applications" && original?.state === "committed" && original.result) { recordSave(original.result); return; }
    }}/>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <ActionButton disabled={operation.blocked || list.isFetching} label={en ? "Refresh applications" : "重新读取申请"} intent="refresh" onAction={refresh}/>
    {feedback?.identity === context.identity && feedback.locator === locator && !context.loading && context.session && !context.signal.aborted && <section aria-label={en ? "Your application feedback" : "本人企业申请反馈"}>
      <h3>{feedback.id}</h3>
      {feedback.busy && <Alert type="info" title={en ? "Reading the original application" : "正在读取原申请"} />}
      {feedback.error && <Alert type="error" title={feedback.error} />}
      {feedback.data && <EnterpriseWorkflowReview row={feedback.data} english={en} />}
      {feedback.data && ["draft", "pending", "supplement_required"].includes(feedback.data.state) && withdrawalAction(feedback.data, "feedback")}
      {feedback.data && applicationEditingSnapshot(feedback.data) && <ActionButton disabled={baseUnavailable || feedback.busy || Boolean(feedback.error) || Boolean(editing && editing.id !== feedback.id)}
        intent="review" label={en ? "Edit this original application" : "编辑本条原企业申请"} onAction={editFeedback} />}
      {editing?.source === "feedback" && editing.id !== feedback.id && <Alert type="warning" title={en ? "Another application is open; close the original editor before editing it." : "当前反馈已切换申请；请明确结束原编辑后再编辑另一申请。"} />}
      <ActionButton disabled={feedback.busy} intent="review" label={en ? "Refresh this application feedback" : "重读本申请反馈"} onAction={() => readFeedback(feedback.id)} />
    </section>}
    <Table rowKey="id" dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refresh} columns={[
      { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Revision" : "修订", dataIndex: "revision" }, { title: en ? "Reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => <>
        {feedbackAction(row)}
        {["draft", "supplement_required"].includes(row.state) && <Button disabled={listUnavailable || !applicationEditingSnapshot(row)} onClick={() => editApplication(row)}>{en ? "Edit" : "编辑"}</Button>}
        {["draft", "pending", "supplement_required"].includes(row.state) && withdrawalAction(row)}
      </> }]}/>
  </section>;
}

export function EnterpriseJoinPage() {
  const context = useEnterprise(), { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("join");
  const [form] = Form.useForm<{ inviteCode: string; department?: string; employeeNo?: string; agreementVersion: string; acknowledged: boolean }>();
  const [preview, setPreview] = useState<{ code: string; value: EnterpriseInvitePreview }>(), [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState("");
  const [submission, setSubmission] = useState<{ identity: string; result: Record<string, unknown> }>();
  const latestJoin = useRef<{ preview: typeof preview; reading: boolean; readable: boolean }>({ preview, reading: false, readable: false });
  const [exitReview, setExitReview] = useState<ExitReview>();
  const [withdrawal, setWithdrawal] = useState<{ identity: string; id: string; revision: number }>();
  useEffect(() => { setExitReview(undefined); setWithdrawal(undefined); setSubmission(undefined); }, [context.identity]);
  const previewLock = useRef(false), previewOwner = useRef(context.identity); previewOwner.current = context.identity;
  const previewMounted = useRef(true);
  useEffect(() => { previewMounted.current = true; return () => { previewMounted.current = false; }; }, []);
  useEffect(() => {
    form.resetFields();
    setPreview(undefined); setPreviewError(""); setPreviewBusy(false);
    try { const code = readEnterpriseInvite(context.basePath); if (code) form.setFieldValue("inviteCode", code); }
    catch { setPreviewError(en ? "Reopen the original invitation after sign-in." : "请在登录后重新打开原邀请链接。"); }
  }, [context.identity]);
  const previewInvite = async () => {
    operation.assertCurrent(); if (previewLock.current || operation.blocked) return;
    previewLock.current = true; latestJoin.current.preview = undefined; latestJoin.current.reading = true;
    setPreview(undefined); form.setFieldValue("acknowledged", false); setPreviewBusy(true); setPreviewError("");
    try {
      const code = String(form.getFieldValue("inviteCode") ?? "").trim();
      const value = await context.write<EnterpriseInvitePreview>("/enterprise/invites/preview", { inviteCode: code }); operation.assertCurrent();
      if (form.getFieldValue("inviteCode") !== code) throw new Error("邀请已变化，请重新核对");
      const original = invitationSnapshot(value); if (!original) throw new Error("原邀请说明缺失或无效，不能加入 / Original invitation material unavailable");
      const snapshot = { code, value: original }; latestJoin.current.preview = snapshot;
      setPreview(snapshot); form.setFieldsValue({ agreementVersion: original.agreementVersion, acknowledged: false });
    } catch (e) { if (previewMounted.current && previewOwner.current === context.identity) setPreviewError(e instanceof Error ? e.message : "邀请不可用"); throw e; }
    finally { previewLock.current = false; if (previewMounted.current && previewOwner.current === context.identity) { latestJoin.current.reading = false; setPreviewBusy(false); } }
  };
  const mine = useQuery({ queryKey: ["enterprise-my-requests", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>("/enterprise/my-requests", signal) });
  const relations = useQuery({ queryKey: ["enterprise-own-relations", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseOwnRelation[]>("/enterprise/my-relations", signal) });
  const unavailable = context.loading || operation.blocked || mine.isFetching || Boolean(mine.error) || !mine.data;
  latestJoin.current = { preview, reading: previewBusy, readable: !context.loading && !mine.isFetching && !mine.error && Boolean(mine.data) };
  const recordSubmission = (result: Record<string, unknown>) => { operation.assertCurrent(); setSubmission({ identity: context.identity, result: { state: result.state, id: result.id, membershipId: result.membershipId, revision: result.revision } }); };
  const latestWithdrawals = useRef({ rows: mine.data, readable: false });
  latestWithdrawals.current = { rows: mine.data, readable: !context.loading && Boolean(context.session && mine.data) && !mine.isFetching && !mine.error };
  const recordedWithdrawal = (result: Record<string, unknown>) => {
    operation.assertCurrent();
    if (typeof result.id === "string" && result.state === "withdrawn" && typeof result.revision === "number") setWithdrawal({ identity: context.identity, id: result.id, revision: result.revision });
  };
  const refresh = async () => { await Promise.all([mine.refetch({ throwOnError: true }), relations.refetch({ throwOnError: true })]); operation.assertCurrent(); };
  const reviewedExit = exitReview?.identity === context.identity ? exitReview : undefined;
  const currentExit = reviewedExit && relations.data?.find(row => row.membershipId === reviewedExit.relation.membershipId && row.corporateCustomerId === reviewedExit.relation.corporateCustomerId);
  const currentExitKey = currentExit ? exitRelationKey(context.identity, currentExit) : undefined;
  const exitChanged = Boolean(reviewedExit && reviewedExit.key !== currentExitKey);
  const exitReadable = !context.loading && Boolean(context.session && relations.data) && !relations.isFetching && !relations.error;
  const latestExit = useRef({ reviewed: reviewedExit, key: currentExitKey, relations: relations.data, readable: exitReadable });
  latestExit.current = { reviewed: reviewedExit, key: currentExitKey, relations: relations.data, readable: exitReadable };
  const canExit = Boolean(exitReadable && !operation.blocked && reviewedExit && !exitChanged && currentExit?.status !== "exited" && reviewedExit.reason.trim() && reviewedExit.confirmed);
  return <section><h2>{en ? "Join an enterprise" : "申请加入企业"}</h2>
    <Form form={form} layout="vertical" disabled={unavailable}>
      <Form.Item name="inviteCode" label={en ? "Invite code" : "邀请码"} rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" maxLength={128} disabled={previewBusy} onChange={() => { latestJoin.current.preview = undefined; setPreview(undefined); form.setFieldValue("acknowledged", false); }}/></Form.Item>
      <ActionButton disabled={unavailable || previewBusy} intent="review" label={en ? "Read invitation details" : "核对邀请说明"} onAction={previewInvite}/>
      {preview && <Alert type="info" title={preview.value.corporateName} description={`${preview.value.noticeText} / ${preview.value.expiresAt}`} />}
      {previewError && <Alert type="error" title={previewError} />}
      <Form.Item name="department" label={en ? "Department" : "部门"}><Input maxLength={120}/></Form.Item>
      <Form.Item name="employeeNo" label={en ? "Employee number" : "工号"}><Input maxLength={80}/></Form.Item>
      <Form.Item name="agreementVersion" label={en ? "Notice version" : "企业告知版本"} rules={[{ required: true, whitespace: true }]}><Input maxLength={191} readOnly/></Form.Item>
      <Form.Item name="acknowledged" valuePropName="checked" rules={[{ validator: (_, v) => v ? Promise.resolve() : Promise.reject(new Error(en ? "Confirm enterprise order visibility." : "请确认企业身份订单可被受权管理员查看")) }]}>
        <Checkbox>{en ? "I understand enterprise identity orders, including personal payment with enterprise benefits, are visible to authorized administrators; personal orders remain private." : "我知悉企业身份订单（包括企业优惠个人付款）可被受权管理员查看，纯个人订单仍独立。"}</Checkbox>
      </Form.Item>
      <SaveButton form={form} disabled={unavailable || previewBusy || !preview} label={en ? "Request to join" : "提交加入申请"} onSave={async values => {
        const original = preview, frozen = { inviteCode: values.inviteCode, department: values.department, employeeNo: values.employeeNo, agreementVersion: values.agreementVersion, acknowledged: values.acknowledged };
        await operation.run<Record<string, unknown>>(() => {
          const latest = latestJoin.current;
          // validateFields and the original lock may yield; never dispatch a stale preview or mutated form object.
          if (!latest.readable || latest.reading || !original || latest.preview !== original || original.code !== frozen.inviteCode || original.value.agreementVersion !== frozen.agreementVersion
            || typeof frozen.inviteCode !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(frozen.inviteCode) || frozen.acknowledged !== true
            || ([["department", 120], ["employeeNo", 80]] as const).some(([field, max]) => frozen[field] !== undefined && (typeof frozen[field] !== "string" || frozen[field].length > max))
            || Object.keys(values).some(field => !["inviteCode", "department", "employeeNo", "agreementVersion", "acknowledged"].includes(field))
            || (["inviteCode", "department", "employeeNo", "agreementVersion", "acknowledged"] as const).some(field => form.getFieldValue(field) !== frozen[field])) throw new Error("原邀请、告知或输入已变化，须重新核对 / Original invitation, notice or input changed");
          return { path: "/enterprise/join", input: { ...frozen, noticeHash: original.value.noticeHash, expectedRevision: 0, reason: "本人确认加入企业" } };
        }, async result => {
          recordSubmission(result); await refresh();
          if (latestJoin.current.preview === original && form.getFieldValue("inviteCode") === frozen.inviteCode) {
            if (readEnterpriseInvite(context.basePath) === frozen.inviteCode) clearEnterpriseInvite(context.basePath);
            form.resetFields(); setPreview(undefined);
          }
        }, refresh);
        operation.assertCurrent(); context.reload();
      }}/>
    </Form>
    {submission?.identity === context.identity && <Alert type="info" title={en ? "Original join result verified" : "原加入结果已核对"}
      description={`${String(submission.result.state)} / ${String(submission.result.id ?? submission.result.membershipId ?? "")} / ${en ? "Historical result only; pending, prior membership and recorded refusal never grant current authority." : "仅为历史结果；待审、曾有关系及原拒绝均不授当前权限。"}`} />}
    {withdrawal?.identity === context.identity && <Alert type="info" title={en ? "Original join withdrawal verified" : "原加入申请撤回已核对"}
      description={`${withdrawal.id} / ${withdrawal.revision} / ${en ? "Original request only; no joined member or rental was removed." : "仅为原申请结果，未移除已加入成员或取消租赁。"}`} />}
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={(path, original) => {
      if (operation.joinWithdrawalId && path === `/enterprise/join-requests/${encodeURIComponent(operation.joinWithdrawalId)}/withdraw` && original?.state === "committed" && original.result) { recordedWithdrawal(original.result); return; }
      if (path === "/enterprise/join" && original?.state === "committed" && original.result) {
        // A recovered K has no raw-code link. Never consume a newly opened invitation by guessing that link.
        recordSubmission(original.result); context.reload(); return;
      }
      form.resetFields();
    }}
      onExitRecovered={() => { setExitReview(undefined); context.reload(); }} transferRow={mine.data?.find(row => row.id === operation.transferDecisionId && row.kind === "administrator_transfer")} transferUnavailable={context.loading || mine.isFetching || Boolean(mine.error) || !mine.data}/>
    {relations.error && <Alert type="error" title={en ? "Your enterprise relationships could not be read" : "本人企业关系读取失败"} />}
    <h3>{en ? "Your enterprise relationships" : "本人企业关系"}</h3>
    <Alert type="info" title={en ? "Exit ends new enterprise authority, not existing rental responsibilities" : "主动退出终止新企业消费权，不删除个人会员或已成立订单"}
      description={en ? "Contact the merchant for ongoing handover. The final administrator must arrange an accepted handoff first." : "有在途租赁请联系商户安排交接；最后管理员须先完成对方已接受的交接。"} />
    <EnterpriseMerchantContact english={en}/>
    <EnterpriseOwnRentalHandoffs english={en}/>
    <EnterpriseOwnRentalFulfillment english={en}/>
    <EnterpriseMemberOperationRecovery english={en}/>
    <Table rowKey="membershipId" sorting={false} pagination={false} dataSource={relations.error ? [] : relations.data ?? []} loading={relations.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Enterprise" : "企业", dataIndex: "corporateName" }, { title: en ? "Role" : "角色", dataIndex: "role" }, { title: en ? "State" : "关系状态", dataIndex: "status" },
      { title: en ? "Actions" : "操作", render: (_, relation: EnterpriseOwnRelation) => relation.status !== "exited" ? <ActionButton disabled={operation.blocked || !exitReadable} intent="review"
        label={en ? "Review this exit" : "核对本条退出"} onAction={async () => {
          operation.assertCurrent(); const latest = latestExit.current;
          const original = latest.relations?.find(row => row.corporateCustomerId === relation.corporateCustomerId && row.membershipId === relation.membershipId);
          if (!latest.readable || !original || original.status === "exited" || exitRelationKey(context.identity, original) !== exitRelationKey(context.identity, relation)) throw new Error("原退出关系已变化，请重新核对 / Original exit relationship changed");
          setExitReview({ identity: context.identity, key: exitRelationKey(context.identity, original), relation: exitRelationSnapshot(original), reason: "", confirmed: false });
        }} /> : null }
    ]} />
    {reviewedExit && <section aria-label={en ? "Review enterprise exit" : "核对企业退出"}>
      <h3>{reviewedExit.relation.corporateName}</h3>
      <dl><dt>{en ? "Original relationship" : "原关系"}</dt><dd>{reviewedExit.relation.membershipId}</dd>
        <dt>{en ? "Original revision" : "原修订"}</dt><dd>{reviewedExit.relation.updatedAt}</dd>
        <dt>{en ? "Role and state" : "角色与状态"}</dt><dd>{reviewedExit.relation.role} / {reviewedExit.relation.status}</dd></dl>
      <Alert type="warning" title={en ? "Exit ends new enterprise authority only. Personal membership, existing orders and original funding responsibilities remain." : "退出仅终止新企业授权；个人会员、已成立订单及原资金责任保留。"}
        description={en ? "Business handoff requests are not available here. Contact the merchant for ongoing rentals; no automatic user transfer, cancellation or refund." : "本端尚无业务交接请求来源。有在途租赁请联系商户，不自动改使用人、取消或退款。"}/>
      {exitChanged && <Alert type="warning" title={en ? "The original relationship changed. Review again; old input is not rebound." : "原关系已变化，须重新核对；旧输入不自动绑定新修订。"}/>}
      <Input.TextArea aria-label={en ? "Original enterprise exit reason" : "本条企业退出原因"} maxLength={500} disabled={!exitReadable || operation.blocked || exitChanged} value={reviewedExit.reason} onChange={event => setExitReview({ ...reviewedExit, reason: event.target.value })}/>
      <Checkbox disabled={!exitReadable || operation.blocked || exitChanged} checked={reviewedExit.confirmed} onChange={event => setExitReview({ ...reviewedExit, confirmed: event.target.checked })}>
        {en ? "I explicitly exit this original enterprise relationship. This is not completed business handoff or undoable cancellation." : "我明确退出本条原企业关系；这不是业务交接完成，也不是可撤销的订单取消。"}
      </Checkbox>
      <ConfirmAction disabled={!canExit} label={en ? "Confirm this exit" : "确认本条退出"} prompt={en ? "Exit this reviewed enterprise relationship? Original orders and funding sources remain unchanged." : "明确退出已核对的本条企业关系？原订单与资金来源不改变。"} onConfirm={async () => {
        const decision = reviewedExit;
        await operation.run(() => {
          operation.assertCurrent(); const latest = latestExit.current;
          if (!decision.confirmed || !decision.reason.trim() || decision.reason.length > 500 || !latest.readable || latest.key !== decision.key
            || latest.reviewed?.key !== decision.key || latest.reviewed.reason !== decision.reason || !latest.reviewed.confirmed) throw new Error("须重新核对并明确确认本条原退出 / Review and confirm the original exit");
          return { path: `/enterprise/corporates/${encodeURIComponent(decision.relation.corporateCustomerId)}/members/${encodeURIComponent(decision.relation.membershipId)}/exit`,
            input: { status: "exited", expectedRevision: 0, expectedUpdatedAt: decision.relation.updatedAt, reason: decision.reason.trim() } };
        }, refresh, refresh);
        operation.assertCurrent(); setExitReview(undefined); context.reload();
      }}/>
      <Button disabled={operation.busy} onClick={() => setExitReview(undefined)}>{en ? "Cancel review" : "取消核对"}</Button>
    </section>}
    {mine.error && <Alert type="error" title={String(mine.error)}/>}
    <Table rowKey="id" sorting={false} pagination={false} dataSource={mine.error ? [] : mine.data ?? []} loading={mine.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Kind" : "申请类型", dataIndex: "kind" }, { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Decision reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Original material" : "原申请材料", render: (_, row: EnterpriseWorkflowView) => <details><summary>{en ? "Read this original request" : "核对本条原申请"}</summary><EnterpriseWorkflowReview row={row} english={en} /></details> },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => row.state === "pending" ? <>
        {row.kind === "join_request" && <ConfirmAction disabled={unavailable} label={en ? "Withdraw request" : "撤回加入申请"}
          prompt={en ? "Withdraw this pending join request? Joined members and existing rentals remain unchanged." : "撤回本条待审核加入申请？已加入成员和已成立租赁不变。"}
          onConfirm={() => operation.run<Record<string, unknown>>(() => {
            operation.assertCurrent();
            const latest = latestWithdrawals.current, current = latest.rows?.find(item => item.id === row.id && item.kind === "join_request");
            // A confirmation may remain open while the list refreshes: never rebind it to a newer request.
            if (!latest.readable || !current || current.state !== "pending" || current.revision !== row.revision || current.updatedAt !== row.updatedAt
              || current.applicantCustomerId !== context.session?.customer.customerId) throw new Error("原本人加入申请已变化，须重新核对 / Review the original own join request again");
            return { path: `/enterprise/join-requests/${encodeURIComponent(row.id)}/withdraw`, input: { expectedRevision: row.revision, reason: "本人明确撤回加入申请" } };
          }, async result => { recordedWithdrawal(result); await refresh(); }, refresh)} />}
        {row.kind === "administrator_transfer" && <>
          <ActionButton disabled={unavailable || !readAdministratorTransferMaterial(row)} label={en ? "Accept transfer" : "接受管理员交接"} intent="confirm" onAction={async () => {
            // Presentation never grants authority, but an unreadable original must not even dispatch.
            if (!readAdministratorTransferMaterial(row)) throw new Error(en ? "The original handoff material is missing or unsupported; this request cannot be accepted." : "原交接材料缺失或不支持，不能接受本条请求。");
            await operation.run(() => ({ path: `/enterprise/transfers/${encodeURIComponent(row.id)}/decision`, input: { expectedRevision: row.revision, accept: true, reason: "本人明确接受管理员交接" } }), refresh, refresh);
            operation.assertCurrent(); context.reload();
          }}/>
          <ActionButton disabled={unavailable} label={en ? "Decline transfer" : "拒绝管理员交接"} intent="confirm" onAction={() => operation.run(() => ({ path: `/enterprise/transfers/${encodeURIComponent(row.id)}/decision`, input: { expectedRevision: row.revision, accept: false, reason: "本人明确拒绝管理员交接，原授权不改变" } }), refresh, refresh)} />
        </>}
      </> : null }]}/>
  </section>;
}

export function EnterpriseInvitesPage() {
  const context = useEnterprise(), id = context.selectedCorporateId, { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("invites");
  const [code, setCode] = useState<{ identity: string; value: string; inviteId: string }>(), [creation, setCreation] = useState<{ identity: string; inviteId: string }>();
  const [revocation, setRevocation] = useState<{ identity: string; inviteId: string; revision: number }>();
  const [form] = Form.useForm<{ lifetimeHours: number; maxUses: number }>();
  const list = useQuery({ queryKey: ["enterprise-invites", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseInviteView[]>(`/enterprise/corporates/${encodeURIComponent(id)}/invites`, signal), enabled: Boolean(id) });
  const unavailable = !id || context.loading || operation.blocked || list.isFetching || Boolean(list.error) || !list.data;
  useEffect(() => { setCode(undefined); setCreation(undefined); setRevocation(undefined); form.resetFields(); }, [context.identity, form]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const recordedRevocation = (result: Record<string, unknown>) => {
    if (typeof result.id !== "string" || result.status !== "revoked" || typeof result.revision !== "number") return;
    setRevocation({ identity: context.identity, inviteId: result.id, revision: result.revision });
    // Retire only a known code for this exact revoked invitation, not another one.
    setCode(current => current?.identity === context.identity && current.inviteId === result.id ? undefined : current);
  };
  return <section><h2>{en ? "Invitations" : "邀请管理"}</h2>
    <Form form={form} layout="vertical" disabled={unavailable}>
      <Form.Item name="lifetimeHours" label={en ? "Lifetime hours" : "有效小时数"} rules={[{ required: true }]}><Input type="number" min={1} max={8760} step={1}/></Form.Item>
      <Form.Item name="maxUses" label={en ? "Maximum uses" : "允许人数"} rules={[{ required: true }]}><Input type="number" min={1} max={1000} step={1}/></Form.Item>
      <SaveButton form={form} disabled={unavailable} label={en ? "Create invite" : "生成邀请"} onSave={v => operation.run<EnterpriseInviteCreated>(() => ({ path: `/enterprise/corporates/${encodeURIComponent(id)}/invites`, input: { lifetimeHours: Number(v.lifetimeHours), maxUses: Number(v.maxUses), expectedRevision: 0, reason: "管理员显式创建企业邀请" } }), async result => { operation.assertCurrent(); setCode(result.code ? { identity: context.identity, value: result.code, inviteId: result.invite.id } : undefined); setCreation({ identity: context.identity, inviteId: result.invite.id }); await refresh(); }, refresh)}/>
    </Form>
    {code?.identity === context.identity && <>
      <p>{en ? "Copy now; this code cannot be read again" : "请现在复制，原码不再回读"}：<code>{code.value}</code></p>
      <ActionButton intent="none" label={en ? "Copy invite code" : "复制邀请码"} onAction={async () => { operation.assertCurrent(); await navigator.clipboard.writeText(code.value); operation.assertCurrent(); }}/>
      <ActionButton intent="none" label={en ? "Copy registered invitation link" : "复制本商户邀请链接"} onAction={async () => {
        operation.assertCurrent(); const link = new URL(`${context.basePath}/join`, window.location.origin); link.hash = new URLSearchParams({ invite: code.value }).toString();
        await navigator.clipboard.writeText(link.href); operation.assertCurrent();
      }}/>
    </>}
    {creation?.identity === context.identity && !(code?.identity === context.identity && code.inviteId === creation.inviteId) && <Alert type="info"
      title={en ? "Original invitation created; its raw code is unavailable" : "原邀请已创建，原码已不可取得"}
      description={`${creation.inviteId} / ${en ? "Only creation is verified, not current availability; no new code or invitation was generated." : "仅核原创建，不代表今天可用；未补码或另建邀请。"}`} />}
    {revocation?.identity === context.identity && <Alert type="info" title={en ? "Original invitation revocation verified" : "原邀请停用已核对"}
      description={`${revocation.inviteId} / ${revocation.revision} / ${en ? "Original operation only, not today's state or member removal." : "仅为原操作结果，不代表今天状态或成员移除。"}`} />}
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={(path, original) => {
      const revoked = operation.inviteRevocationTarget;
      if (revoked && path === `/enterprise/corporates/${encodeURIComponent(revoked.corporateId)}/invites/${encodeURIComponent(revoked.inviteId)}/revoke` && original?.state === "committed" && original.result) {
        recordedRevocation(original.result); return;
      }
      if (path !== `/enterprise/corporates/${encodeURIComponent(id)}/invites` || original?.state !== "committed" || original.result?.codeRetrievableAgain !== false) return;
      const invite = original.result.invite as EnterpriseInviteView;
      // Preserve a still-known, same-invitation first-response code. Never fill it
      // from recovery (or bind another invitation's code to this original).
      setCode(current => current?.identity === context.identity && current.inviteId === invite.id ? current : undefined);
      setCreation({ identity: context.identity, inviteId: invite.id });
    }}/>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <Table rowKey="id" dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refresh} columns={[
      { title: en ? "State" : "状态", dataIndex: "status" }, { title: en ? "Expires" : "到期", dataIndex: "expiresAt" }, { title: en ? "Used" : "已占用", dataIndex: "used" }, { title: en ? "Limit" : "上限", dataIndex: "maxUses" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseInviteView) => row.status === "active" ? <ConfirmAction disabled={unavailable} label={en ? "Revoke" : "停用"}
        prompt={en ? "Revoke this invitation? Pending admissions are invalidated; already joined members remain." : "停用本邀请？未完成加入申请将失效；已加入成员保留。"}
        onConfirm={() => operation.run<Record<string, unknown>>(() => ({ path: `/enterprise/corporates/${encodeURIComponent(id)}/invites/${encodeURIComponent(row.id)}/revoke`, input: { expectedRevision: row.revision, reason: "管理员停用邀请" } }), async result => { recordedRevocation(result); await refresh(); }, refresh)}/> : null }]}/>
  </section>;
}

export function EnterpriseJoinReviewPage() {
  const context = useEnterprise(), id = context.selectedCorporateId, { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("join-review");
  const [selection, setSelection] = useState<{ identity: string; material: NonNullable<ReturnType<typeof readJoinReviewMaterial>>; reason: string }>();
  const [original, setOriginal] = useState<{ identity: string; id: string; state: string; revision: number }>();
  const selected = selection?.identity === context.identity ? selection : undefined;
  const list = useQuery({ queryKey: ["enterprise-join-review", context.identity], enabled: Boolean(id), queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>(`/enterprise/corporates/${encodeURIComponent(id)}/join-requests`, signal) });
  const readable = Boolean(id && list.data) && !context.loading && !list.isFetching && !list.error, unavailable = !readable || operation.blocked;
  const latestReview = useRef({ selected, readable, rows: list.data }); latestReview.current = { selected, readable, rows: list.data };
  useEffect(() => { setSelection(undefined); setOriginal(undefined); }, [context.identity]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const record = (result: Record<string, unknown>) => {
    operation.assertCurrent(); if (typeof result.id === "string" && typeof result.state === "string" && typeof result.revision === "number") setOriginal({ identity: context.identity, id: result.id, state: result.state, revision: result.revision });
  };
  const reviewRow = async (row: EnterpriseWorkflowView) => {
    operation.assertCurrent();
    const latest = latestReview.current, current = latest.rows?.find(item => item.id === row.id), material = current && readJoinReviewMaterial(current, id);
    if (!latest.readable || !material || material.key !== readJoinReviewMaterial(row, id)?.key) throw new Error("原加入申请不可审阅或已变化 / Original join request changed or is unavailable");
    setSelection({ identity: context.identity, material, reason: "" });
  };
  return <section><h2>{en ? "Join requests" : "加入审核"}</h2>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    {original?.identity === context.identity && <Alert type="info" title={en ? "Original join review verified" : "原加入审核已核对"} description={`${original.id} / ${original.state} / ${original.revision} / ${en ? "Historical result only, not today's membership authority." : "仅为历史结果，不代表今天成员权限。"}`} />}
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={(_, receipt) => { if (receipt?.state === "committed" && receipt.result) record(receipt.result); setSelection(undefined); }}/>
    <Table rowKey="id" sorting={false} pagination={false} dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Applicant" : "申请人", dataIndex: "applicantCustomerId" }, { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Decision reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => row.state === "pending" ? selected?.material.row.id === row.id && selected.material.row.revision === row.revision ? <>
        <EnterpriseWorkflowReview row={selected.material.row} english={en} />
        {selected.material.key !== readJoinReviewMaterial(row, id)?.key && <><Alert type="warning" title={en ? "Original material changed. Old input is retained, not rebound." : "原材料已变化，保留旧输入，不自动改绑。"} /><ActionButton disabled={unavailable} intent="review" label={en ? "Review current request" : "重新核对本条申请"} onAction={() => reviewRow(row)} /></>}
        {!selected.material.canApprove && <Alert type="warning" title={en ? "Original consent is missing or invalid; approval is unavailable. You may reject this pending request." : "原告知依据缺失或无效，不能批准；仍可拒绝本条待审申请。"} />}
        <Input.TextArea aria-label={en ? "Review reason for this request" : "本条加入申请审核原因"} value={selected.reason} disabled={unavailable} onChange={event => setSelection({ ...selected, reason: event.target.value })} maxLength={500} />
        {(["approve", "reject"] as const).map(decision => <ConfirmAction key={decision} disabled={unavailable || !selected.reason.trim() || selected.material.key !== readJoinReviewMaterial(row, id)?.key || decision === "approve" && !selected.material.canApprove}
          label={decision === "approve" ? (en ? "Approve" : "批准加入") : (en ? "Reject" : "拒绝")}
          prompt={decision === "approve" ? (en ? "Approve this reviewed original request? Current membership, invitation and consent are rechecked by the server." : "批准本条已审阅原申请？服务端仍复验当前会员、邀请及告知依据。") : (en ? "Reject this reviewed original request? No joined member is removed." : "拒绝本条已审阅原申请？不移除已加入成员。")}
          onConfirm={() => operation.run<Record<string, unknown>>(() => {
            operation.assertCurrent(); const latest = latestReview.current, current = latest.rows?.find(item => item.id === selected.material.row.id), material = current && readJoinReviewMaterial(current, id);
            // Confirmation and lock acquisition may yield. Recheck the frozen review and current reader, not its captured flags.
            if (!latest.readable || latest.selected !== selected || !material || material.key !== selected.material.key || typeof selected.reason !== "string" || !selected.reason.trim() || selected.reason.length > 500
              || decision === "approve" && !material.canApprove) throw new Error("原审核材料或原因已变化，须重新核对 / Original review material or reason changed");
            return { path: `/enterprise/corporates/${encodeURIComponent(id)}/join-requests/${encodeURIComponent(selected.material.row.id)}/decision`, input: { decision, expectedRevision: selected.material.row.revision, reason: selected.reason.trim() } };
          }, async result => { record(result); await refresh(); setSelection(undefined); }, refresh)} />)}
      </> : <ActionButton disabled={unavailable || !readJoinReviewMaterial(row, id)} intent="review" label={en ? "Review this request" : "核对本条加入申请"} onAction={() => reviewRow(row)} /> : <details><summary>{en ? "Read original feedback" : "核对原处理结果"}</summary><EnterpriseWorkflowReview row={row} english={en} /></details> }]}/>
  </section>;
}
