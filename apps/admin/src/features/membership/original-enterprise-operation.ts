/** Operator workflows dispatch once using the original HTTP/auth pipeline, without
 * 401 write replay. Durable recovery holds only key/path/state, never input/token. */
import { useEffect, useRef, useState } from "react";
import type { AxiosRequestConfig } from "axios";
import type { ApiResult, EnterpriseOperationResult } from "@rental-os/shared";
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
  const segment = "[a-zA-Z0-9_%-]+";
  const registered = new RegExp(`^/membership/(?:enterprise-portal/settings|corporate/${segment}/enterprise-portal|enterprise-workflows/(?:invite-policy|applications/${segment}/decision|management-requests/${segment}/decision|corporates/${segment}/policy))$`, "u");
  if (!registered.test(path)) return false;
  try { return path.split("/").every(part => !/[/.\\\\?#]/u.test(decodeURIComponent(part))); }
  catch { return false; }
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
    if (!auth.hasTenantMembershipPermission("rental-os:corporate:manage")) throw new Error("需要当前商户授权");
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
      const pending: Pending = { key: crypto.randomUUID(), path: command.path, body: JSON.stringify(command.input), state: "unknown" };
      rememberReference(storageKey, pending);
      slot.pending = pending; publish();
      let value: T;
      try {
        assertCurrent();
        const config: AxiosRequestConfig & { _authRetry: boolean } = { url: pending.path, method: command.method,
          data: { ...JSON.parse(pending.body), operationKey: pending.key }, _authRetry: true,
          signal: AbortSignal.any([currentSessionSignal(), controller.current.signal]) };
        const response = await http.request<ApiResult<T>>(config);
        pending.state = "committed"; value = response.data.data;
      } catch (error) {
        if (isWorkflowRevisionConflict(error)) {
          assertCurrent(); finish();
          if (onRevisionConflict) { await onRevisionConflict(); assertCurrent(); }
        }
        throw error;
      }
      assertCurrent(); rememberReference(storageKey, pending); publish();
      try { await afterCommit(value); assertCurrent(); }
      catch (error) { assertCurrent(); throw new Error(`已提交，后续读取失败；只可刷新已提交结果：${errorMessage(error)}`); }
      finish(); report(); return value;
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; if (!slot.pending) unresolved.delete(identity); publish(); }
  };
  const recover = async (afterCommit: (path: string) => Promise<void>) => {
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
      const saved = readReference(storageKey);
      if (saved && saved.key !== pending.key) throw new Error("原操作引用已变化，不能覆盖当前请求");
      if (pending.state !== "committed" || !pending.body) {
        const receipt = await read<EnterpriseOperationResult>(`${receiptPath}/${encodeURIComponent(pending.key)}`);
        if (receipt.state !== "committed") throw new Error("尚未读到原收据，不代表未写入；请保留原请求，不能重发");
        pending.state = "committed"; publish();
      }
      rememberReference(storageKey, pending);
      await afterCommit(pending.path); assertCurrent();
      forgetReference(storageKey); active.pending = undefined; unresolved.delete(identity); report();
      });
    } catch (error) {
      const failure = active.pending?.state === "committed" ? new Error(`已提交，后续读取失败；只可刷新已提交结果：${errorMessage(error)}`) : error;
      report(failure); throw failure;
    } finally { active.busy = false; publish(); }
  };
  return { identity, pending: slot.pending, busy: slot.busy, blocked: Boolean(storageError || slot.pending || slot.busy),
    error: storageError || (failure?.identity === identity ? failure.message : ""), read, run, recover, assertCurrent };
}
