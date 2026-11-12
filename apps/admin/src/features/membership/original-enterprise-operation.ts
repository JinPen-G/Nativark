/** Operator workflows dispatch once using the original HTTP/auth pipeline, without
 * 401 write replay. Durable recovery holds only key/path/state, never input/token. */
import { useEffect, useRef, useState } from "react";
import type { AxiosRequestConfig } from "axios";
import { ENTERPRISE_REVIEW_REQUEST_TYPES, type ApiResult, type EnterpriseOperationResult } from "@rental-os/shared";
import { http } from "@/api/http";
import { currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";

type Command = { path: string; input: object; method: "post" | "put" };
type Pending = { key: string; path: string; body: string; state: "unknown" | "committed" };
type Slot = { pending?: Pending; busy: boolean };
const unresolved = new Map<string, Slot>();
// Only registered merchant workflow commands can become durable recovery targets.
// Decode one path segment so encoded slashes/traversal never widen this list.
function isCommandPath(path: string) {
  if (path.length > 600) return false;
  if (/^\/rental\/v1\/enterprise-handoff-requests\/[a-zA-Z0-9_-]{1,191}\/review$/u.test(path)) return true;
  const segment = "[a-zA-Z0-9_%-]+";
  const registered = new RegExp(`^/membership/(?:enterprise-portal/settings|corporate/${segment}/enterprise-portal|enterprise-workflows/(?:invite-policy|applications/${segment}/decision|management-requests/${segment}/decision|corporates/${segment}/policy))$`, "u");
  if (!registered.test(path)) return false;
  try { return path.split("/").every(part => !/[/.\\\\?#]/u.test(decodeURIComponent(part))); }
  catch { return false; }
}
function merchantPolicyTarget(path: string) {
  const match = /^\/membership\/enterprise-workflows\/corporates\/([a-zA-Z0-9_%-]+)\/policy$/u.exec(path);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new Error("原商户政策对象不可读取，保留原引用");
  return id;
}
function merchantPolicyResultMatches(value: unknown, corporateId: string, originalRead = false) {
  const row = value as { corporateCustomerId?: unknown; scopeKey?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && row.scopeKey === "merchant"
    && (originalRead ? row.corporateCustomerId === corporateId : row.corporateCustomerId === undefined || row.corporateCustomerId === corporateId)
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1;
}
function merchantManagementTarget(path: string) {
  const match = /^\/membership\/enterprise-workflows\/management-requests\/([a-zA-Z0-9_%-]+)\/decision$/u.exec(path);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new Error("原商户审核申请无法精确核对，保留原引用");
  return id;
}
function merchantManagementResultMatches(value: unknown, id: string, originalRead = false) {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown; effect?: unknown; corporateCustomerId?: unknown; requestType?: unknown } | null;
  return row && !Array.isArray(row) && row.id === id && (row.state === "approved" || row.state === "rejected" || row.state === "supplement_required")
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 2 && row.effect === "review_only_no_business_change"
    && (!originalRead || typeof row.corporateCustomerId === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.corporateCustomerId)
      && ENTERPRISE_REVIEW_REQUEST_TYPES.some(type => type === row.requestType));
}
function merchantApplicationTarget(path: string) {
  const match = /^\/membership\/enterprise-workflows\/applications\/([a-zA-Z0-9_%-]+)\/decision$/u.exec(path);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new Error("原企业审核申请无法精确核对，保留原引用");
  return id;
}
function merchantApplicationResultMatches(value: unknown, id: string) {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown; corporateCustomerId?: unknown } | null;
  return row && !Array.isArray(row) && Object.keys(row).length === 4 && row.id === id
    && (row.state === "approved" || row.state === "rejected" || row.state === "supplement_required")
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 2
    && (row.corporateCustomerId === null || typeof row.corporateCustomerId === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.corporateCustomerId))
    && (row.state !== "approved" || row.corporateCustomerId !== null);
}
function merchantDecisionInputMatches(value: unknown, body: string) {
  const row = value as { state?: unknown; revision?: unknown } | null;
  let input: { expectedRevision?: unknown; decision?: unknown };
  try { input = JSON.parse(body); } catch { return false; }
  return row && input && !Array.isArray(input) && typeof input.expectedRevision === "number" && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 1
    && row.revision === input.expectedRevision + 1 && row.state === (input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : input.decision === "supplement" ? "supplement_required" : undefined);
}
function merchantHandoffTarget(path: string) {
  const match = /^\/rental\/v1\/enterprise-handoff-requests\/([a-zA-Z0-9_-]{1,191})\/review$/u.exec(path);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new Error("原交接处理引用不可核对，保留原键");
  return id;
}
function merchantHandoffResultMatches(value: unknown, id: string, body?: string) {
  const row = value as { id?: unknown; orderId?: unknown; state?: unknown; revision?: unknown; effect?: unknown } | null;
  if (!row || Array.isArray(row) || Object.keys(row).length !== 5 || row.id !== id || typeof row.orderId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.orderId) || row.state !== "reviewed" || row.revision !== 2 || row.effect !== "request_only_no_business_change") return false;
  if (!body) return true;
  try { const input = JSON.parse(body); return input.expectedRevision === 1 && input.confirm === true; } catch { return false; }
}
function readReference(key: string): Pending | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const value = JSON.parse(raw);
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
    || typeof value.path !== "string" || !isCommandPath(value.path)
    || !["unknown", "committed"].includes(value.state)) throw new Error("原商户操作引用不可读取，不能重新派发");
  return { key: value.key, path: value.path, state: value.state, body: "" };
}
function rememberReference(key: string, pending: Pending) {
  const value = JSON.stringify({ key: pending.key, path: pending.path, state: pending.state });
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error("原商户操作引用未可靠保存，未发送新命令");
}
function forgetReference(key: string) {
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null) throw new Error("原操作已完成但引用尚未清除，仅可继续回读");
}
export function enterpriseOperatorIdentity() {
  const auth = useAuthStore.getState(), user = auth.user;
  return JSON.stringify([currentSessionEpoch(), auth.sessionVerified, Boolean(auth.token), auth.tenant?.tenantId,
    auth.currentWorkspaceId, user?.id, user?.tenantId, user?.scope, user?.dataScope, user?.organizationId,
    user?.locationScope, user?.isPlatformAdmin, user?.isSaasAdmin, user?.permissions, user?.tenantMembership]);
}
const errorMessage = (error: unknown) => {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  return Array.isArray(data?.message) ? data.message.join("；") : data?.message ?? (error instanceof Error ? error.message : "操作失败");
};
export function isWorkflowRevisionConflict(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return response?.status === 409 && response.data?.code === "enterprise_revision_conflict";
}
// The current service names this precise 409; all other GET failures remain failures, not an empty policy.
export function isInvitePolicyUnconfigured(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { message?: string; code?: string } } })?.response;
  return response?.status === 409 && (response.data?.code === "enterprise_invite_policy_unconfigured"
    || response.data?.message === "商户尚未配置邀请期限、限额和告知条款");
}
export function useOriginalEnterpriseOperation(scope = "enterprise-applications", receiptPath = "/membership/enterprise-workflows/operations") {
  const auth = useAuthStore(), baseIdentity = enterpriseOperatorIdentity();
  const identity = JSON.stringify([baseIdentity, scope, receiptPath]);
  const latest = useRef(identity); latest.current = identity;
  const mounted = useRef(true), controller = useRef(new AbortController());
  const [, render] = useState(0), [failure, setFailure] = useState<{ identity: string; message: string }>();
  const operationRef = useRef<Slot>({ busy: false });
  operationRef.current = unresolved.get(identity) ?? { busy: false };
  const slot = operationRef.current;
  const storageKey = `rental-os:enterprise-operator-workflow:${JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId, scope, receiptPath])}`;
  let storageError = "";
  if (!slot.pending && auth.sessionVerified && auth.token) {
    try { const saved = readReference(storageKey); if (saved) { slot.pending = saved; unresolved.set(identity, slot); } }
    catch (error) { storageError = errorMessage(error); }
  }
  const assertCurrent = () => {
    if (!mounted.current || baseIdentity !== enterpriseOperatorIdentity() || latest.current !== identity
      || !useAuthStore.getState().sessionVerified || !useAuthStore.getState().token) throw new Error("身份或权限已变化，原请求已隔离，不能在新身份继续操作");
  };
  const assertApplicationReviewPermission = () => {
    assertCurrent(); const current = useAuthStore.getState();
    if (!current.hasTenantMembershipPermission("rental-os:corporate:manage") || !current.hasTenantMembershipPermission("rental-os:corporate:employee-manage")) throw new Error("原企业审核读取须当前商户和员工管理权");
  };
  const assertHandoffPermission = (write = false) => {
    assertCurrent(); const current = useAuthStore.getState();
    if (!current.currentWorkspaceId || !current.hasPermission("rental-os:corporate:manage") || !current.hasPermission("rental-os:order:view")
      || write && !current.hasPermission("rental-os:order:operate") || !current.user?.isPlatformAdmin && current.user?.dataScope !== "all") throw new Error("交接核对须当前空间订单范围与对应商户权限");
  };
  const publish = () => { if (mounted.current && baseIdentity === enterpriseOperatorIdentity() && latest.current === identity) render(n => n + 1); };
  const report = (error?: unknown) => {
    if (mounted.current && baseIdentity === enterpriseOperatorIdentity() && latest.current === identity) setFailure(error === undefined ? undefined : { identity, message: errorMessage(error) });
  };
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    const cancel = () => {
      if (enterpriseOperatorIdentity() !== baseIdentity) controller.current.abort();
      const current = useAuthStore.getState();
      // Clear sensitive original inputs on logout; cancellation still does not prove no commit.
      if (!current.token || !current.sessionVerified) unresolved.clear();
    };
    const unsubscribe = useAuthStore.subscribe(cancel);
    return () => { unsubscribe(); controller.current.abort(); mounted.current = false; };
  }, [identity]);
  const read = async <T,>(path: string, signal?: AbortSignal) => {
    assertCurrent();
    const response = await http.request<ApiResult<T>>({ url: path, method: "get", signal: AbortSignal.any([currentSessionSignal(), controller.current.signal, ...(signal ? [signal] : [])]) });
    assertCurrent(); return response.data.data;
  };
  const finish = () => { forgetReference(storageKey); slot.pending = undefined; };
  const run = async <T,>(prepare: () => Command | Promise<Command>, afterCommit: (value: T) => Promise<void>, onRevisionConflict?: () => Promise<void>) => {
    assertCurrent();
    if (scope === "enterprise-rental-handoff") assertHandoffPermission(true);
    else if (!auth.hasTenantMembershipPermission("rental-os:corporate:manage")) throw new Error("需要当前商户授权");
    const saved = readReference(storageKey);
    if (saved && !slot.pending) { slot.pending = saved; unresolved.set(identity, slot); }
    if (storageError) throw new Error(storageError);
    const active = unresolved.get(identity);
    if (active?.busy || active?.pending) throw new Error("请先核对原操作；不能重新发送业务写入");
    slot.busy = true; unresolved.set(identity, slot); publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少跨页面原操作协调能力，不能提交");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const latestReference = readReference(storageKey);
      if (latestReference) { slot.pending = latestReference; publish(); throw new Error("请先核对原操作；不能重新发送业务写入"); }
      const command = await prepare(); assertCurrent();
      if (!isCommandPath(command.path)) throw new Error("商户命令路径未登记，未发送新命令");
      const policyCorporateId = merchantPolicyTarget(command.path), managementRequestId = merchantManagementTarget(command.path), applicationRequestId = merchantApplicationTarget(command.path), handoffId = merchantHandoffTarget(command.path);
      if (Boolean(handoffId) !== (scope === "enterprise-rental-handoff")) throw new Error("交接命令路径与原scope不匹配，未创建原键");
      if (handoffId) assertHandoffPermission(true);
      if ((managementRequestId || applicationRequestId || handoffId) && command.method !== "post") throw new Error("原商户审核只支持登记 POST，未发送新命令");
      if (applicationRequestId) assertApplicationReviewPermission();
      if (policyCorporateId && command.method !== "put") throw new Error("商户政策只支持登记 PUT，未发送新命令");
      const pending: Pending = { key: crypto.randomUUID(), path: command.path, body: JSON.stringify(command.input), state: "unknown" };
      rememberReference(storageKey, pending);
      slot.pending = pending; publish();
      const sameOriginalReference = () => { const current = readReference(storageKey); return current && current.key === pending.key && current.path === pending.path; };
      let value: T;
      try {
        assertCurrent();
        const config: AxiosRequestConfig & { _authRetry: boolean } = { url: pending.path, method: command.method,
          data: { ...JSON.parse(pending.body), operationKey: pending.key }, _authRetry: true,
          signal: AbortSignal.any([currentSessionSignal(), controller.current.signal]) };
        const response = await http.request<ApiResult<T>>(config);
        value = response.data.data;
        if (applicationRequestId) {
          assertApplicationReviewPermission();
          if (!merchantApplicationResultMatches(value, applicationRequestId) || !merchantDecisionInputMatches(value, pending.body)) throw new Error("原企业审核结果缺少精确申请、决策或修订，保留原引用");
        }
        if (policyCorporateId && !merchantPolicyResultMatches(value, policyCorporateId)) throw new Error("原商户政策结果缺少 scope 或修订，保留原引用");
        if (managementRequestId && (!merchantManagementResultMatches(value, managementRequestId) || !merchantDecisionInputMatches(value, pending.body))) throw new Error("原商户审核结果缺少精确申请、决策或修订，保留原引用");
        if (handoffId && !merchantHandoffResultMatches(value, handoffId, pending.body)) throw new Error("原交接处理结果不可核对，保留原键");
        pending.state = "committed";
      } catch (error) {
        if (isWorkflowRevisionConflict(error)) {
          assertCurrent();
          if ((policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原商户政策引用已变化，不因冲突清除其他请求");
          finish();
          if (onRevisionConflict) { await onRevisionConflict(); assertCurrent(); }
        }
        throw error;
      }
      assertCurrent();
      if ((policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原商户政策引用已变化，不能覆盖其他请求");
      rememberReference(storageKey, pending); publish();
      try { await afterCommit(value); assertCurrent(); if (applicationRequestId) assertApplicationReviewPermission(); }
      catch (error) { assertCurrent(); throw new Error(`已提交，后续读取失败；只可刷新已提交结果：${errorMessage(error)}`); }
      if ((policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原商户政策引用已变化，不能清除其他请求");
      finish(); report(); return value;
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; if (!slot.pending) unresolved.delete(identity); publish(); }
  };
  const recover = async (afterCommit: (path: string, original?: EnterpriseOperationResult) => Promise<void>) => {
    assertCurrent();
    const active = unresolved.get(identity);
    if (!active?.pending) return;
    if (active.busy) throw new Error("原操作仍在处理中");
    active.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少原操作协调能力，只能保留引用");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const pending = active.pending;
      if (!pending) return;
      const policyCorporateId = merchantPolicyTarget(pending.path), managementRequestId = merchantManagementTarget(pending.path), applicationRequestId = merchantApplicationTarget(pending.path), handoffId = merchantHandoffTarget(pending.path);
      if (Boolean(handoffId) !== (scope === "enterprise-rental-handoff")) throw new Error("原交接路径与scope不匹配，保留原键");
      if (handoffId) assertHandoffPermission();
      if (applicationRequestId) assertApplicationReviewPermission();
      if (managementRequestId && !useAuthStore.getState().hasTenantMembershipPermission("rental-os:corporate:manage")) throw new Error("原审核读取须当前商户管理权");
      const sameOriginalReference = () => { const current = readReference(storageKey); return current && current.key === pending.key && current.path === pending.path; };
      const saved = readReference(storageKey);
      if (saved && saved.key !== pending.key || (policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原操作引用已变化，不能覆盖当前请求");
      let receipt: EnterpriseOperationResult | undefined;
      if (pending.state !== "committed" || !pending.body || policyCorporateId || managementRequestId || applicationRequestId || handoffId) {
        // Local committed and an in-memory input are not proof of this original application decision.
        const originalPath = handoffId ? `/rental/v1/enterprise-handoff-requests/${encodeURIComponent(handoffId)}/review-operations/${encodeURIComponent(pending.key)}` : applicationRequestId ? `/membership/enterprise-workflows/applications/${encodeURIComponent(applicationRequestId)}/decision-operations/${encodeURIComponent(pending.key)}` : managementRequestId ? `/membership/enterprise-workflows/management-requests/${encodeURIComponent(managementRequestId)}/decision-operations/${encodeURIComponent(pending.key)}` : policyCorporateId ? `/membership/enterprise-workflows/corporates/${encodeURIComponent(policyCorporateId)}/policy/save-operations/${encodeURIComponent(pending.key)}` : `${receiptPath}/${encodeURIComponent(pending.key)}`;
        receipt = await read<EnterpriseOperationResult>(originalPath);
        if (applicationRequestId) {
          assertApplicationReviewPermission();
          if (!receipt || !merchantApplicationResultMatches(receipt.result, applicationRequestId) || pending.body && !merchantDecisionInputMatches(receipt.result, pending.body)) throw new Error("原企业审核收据缺少精确绑定，保留原引用");
        }
        if (handoffId) { assertHandoffPermission(); if (!merchantHandoffResultMatches(receipt?.result, handoffId, pending.body)) throw new Error("原交接处理收据不可核对，保留原键"); }
        if (receipt.state !== "committed") throw new Error("尚未读到原收据，不代表未写入；请保留原请求，不能重发");
        if (policyCorporateId && !merchantPolicyResultMatches(receipt.result, policyCorporateId, true)) throw new Error("原商户政策收据缺少精确企业、scope 或修订，保留原引用");
        if (managementRequestId && (!merchantManagementResultMatches(receipt.result, managementRequestId, true) || pending.body && !merchantDecisionInputMatches(receipt.result, pending.body))) throw new Error("原商户审核收据缺少精确绑定，保留原引用");
        if (managementRequestId && (receipt.result?.requestType === "credit_change" || receipt.result?.requestType === "payment_proof") && !useAuthStore.getState().hasTenantMembershipPermission("rental-os:finance:manage")) throw new Error("原财务审核读取须当前财务管理权");
        if ((policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原商户政策引用已变化，不能覆盖其他请求");
        pending.state = "committed"; publish();
      }
      rememberReference(storageKey, pending);
      await afterCommit(pending.path, receipt); assertCurrent();
      if (applicationRequestId) assertApplicationReviewPermission();
      if ((policyCorporateId || managementRequestId || applicationRequestId || handoffId) && !sameOriginalReference()) throw new Error("原商户政策引用已变化，不能清除其他请求");
      forgetReference(storageKey); active.pending = undefined; unresolved.delete(identity); report();
      return receipt;
      });
    } catch (error) {
      const failure = active.pending?.state === "committed" ? new Error(`已提交，后续读取失败；只可刷新已提交结果：${errorMessage(error)}`) : error;
      report(failure); throw failure;
    } finally { active.busy = false; publish(); }
  };
  return { identity, pending: slot.pending, busy: slot.busy, blocked: Boolean(storageError || slot.pending || slot.busy),
    error: storageError || (failure?.identity === identity ? failure.message : ""), read, run, recover, assertCurrent };
}
