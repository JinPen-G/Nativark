/** Customer workflow writes are single-dispatch. Durable recovery stores only the
 * original key/path/state, never input or credentials; cancellation is not rollback. */
import { useEffect, useRef, useState } from "react";
import type { EnterpriseOperationResult } from "@rental-os/shared";
import { customerSessionGeneration } from "@rental-os/web-client";
import { useEnterprise } from "./enterprise-session";

type Command = { path: string; input: object; method?: "POST" | "PUT"; originalTarget?: string };
type Pending = { key: string; path: string; body: string; state: "unknown" | "committed"; originalTarget?: string };
type Slot = { pending?: Pending; busy: boolean; tenantCode: string; generation: string };
// In-memory input freezes dispatch; durable storage holds no application/invitation body.
const unresolved = new Map<string, Slot>();
const storedReference = (pending: Pending) => ({ key: pending.key, path: pending.path, state: pending.state, ...(pending.originalTarget ? { originalTarget: pending.originalTarget } : {}) });
function readReference(key: string): Pending | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const value = JSON.parse(raw);
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
    || typeof value.path !== "string" || !/^\/enterprise\/[a-zA-Z0-9_/%-]+$/u.test(value.path) || value.path.length > 600
    || value.originalTarget !== undefined && (!["/enterprise/extension-approvals/submit", "/enterprise/extension-approvals"].includes(value.path) || typeof value.originalTarget !== "string" || !value.originalTarget || value.originalTarget.length > 191)
    || !["unknown", "committed"].includes(value.state)) throw new Error("原操作引用不可读取，不能重新派发 / Original reference unavailable");
  return { key: value.key, path: value.path, state: value.state, body: "", originalTarget: value.originalTarget };
}
function rememberReference(key: string, pending: Pending) {
  const value = JSON.stringify(storedReference(pending));
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error("原操作引用未可靠保存，未发送新命令 / Original reference was not saved");
}
function forgetReference(key: string) {
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null) throw new Error("原操作已完成但引用尚未清除，仅可继续回读 / Original reference still retained");
}
const sessionChanged = () => new Error("身份已变化，原操作已隔离；不能在新身份重发 / Identity changed; the original operation is isolated");
export function workflowError(error: unknown) { return error instanceof Error ? error.message : "操作失败 / Operation failed"; }

export function useOriginalWorkflowOperation(scope: string) {
  const context = useEnterprise();
  const owner = useRef(context); owner.current = context;
  const mounted = useRef(true);
  const [, render] = useState(0);
  const [failure, setFailure] = useState<{ scopeKey: string; message: string }>();
  const report = (error?: unknown) => {
    if (mounted.current && latestSlotKey.current === slotKey && owner.current.identity === context.identity) setFailure(error === undefined ? undefined : { scopeKey: slotKey, message: workflowError(error) });
  };
  const generation = customerSessionGeneration(context.tenantCode);
  // Permission revisions invalidate running callbacks, not the original receipt
  // reference. The same customer can re-read a committed command after losing grants.
  const slotKey = JSON.stringify([scope, context.tenantCode, context.session?.customer.customerId, generation, context.selectedCorporateId]);
  const latestSlotKey = useRef(slotKey); latestSlotKey.current = slotKey;
  // Logout/new login discards visible material, without asserting the old operation rolled back.
  for (const [key, old] of unresolved) if (old.tenantCode === context.tenantCode && old.generation !== generation) unresolved.delete(key);
  const storageKey = `rental-os:enterprise-workflow:${JSON.stringify([scope, context.tenantCode, context.session?.customer.customerId, context.session?.workspace?.workspaceCode, context.selectedCorporateId])}`;
  const operationRef = useRef<Slot>({ busy: false, tenantCode: context.tenantCode, generation });
  let storageError = "";
  operationRef.current = unresolved.get(slotKey) ?? { busy: false, tenantCode: context.tenantCode, generation };
  const slot = operationRef.current;
  if (!slot.pending && context.session) {
    try { const saved = readReference(storageKey); if (saved) { slot.pending = saved; unresolved.set(slotKey, slot); } }
    catch (error) { storageError = workflowError(error); }
  }
  const assertCurrent = () => {
    if (!mounted.current || latestSlotKey.current !== slotKey || owner.current.identity !== context.identity || context.signal.aborted
      || customerSessionGeneration(context.tenantCode) !== generation || !context.session) throw sessionChanged();
  };
  const publish = () => { if (mounted.current && latestSlotKey.current === slotKey && owner.current.identity === context.identity) render(n => n + 1); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = async <T,>(path: string, signal?: AbortSignal) => {
    assertCurrent();
    const result = await context.read<T>(path, signal ? AbortSignal.any([signal, context.signal]) : context.signal);
    assertCurrent(); return result;
  };
  const finish = () => { forgetReference(storageKey); slot.pending = undefined; };
  const reserve = () => {
    assertCurrent();
    // Another page/realm may have retained the same original scope since render.
    const saved = readReference(storageKey);
    if (saved && !slot.pending) { slot.pending = saved; unresolved.set(slotKey, slot); }
    if (storageError) throw new Error(storageError);
    const active = unresolved.get(slotKey);
    if (active?.busy || active?.pending) throw new Error("请先核对原操作，不能重新发送业务写入 / Read the original result before another write");
    slot.busy = true; unresolved.set(slotKey, slot); publish();
  };
  const run = async <T,>(prepare: () => Command | Promise<Command>, afterCommit: (value: T) => Promise<void>, onRevisionConflict?: () => Promise<void>) => {
    reserve();
    try {
      if (!navigator.locks?.request) throw new Error("缺少跨页面原操作协调能力，请勿提交 / Original operation coordination unavailable");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const saved = readReference(storageKey);
      if (saved) { slot.pending = saved; publish(); throw new Error("请先核对原操作，不能重新发送业务写入 / Read the original result before another write"); }
      const command = await prepare(); assertCurrent();
      const pending: Pending = { key: crypto.randomUUID(), path: command.path, body: JSON.stringify(command.input), state: "unknown", originalTarget: command.originalTarget };
      if (pending.originalTarget !== undefined && (!["/enterprise/extension-approvals/submit", "/enterprise/extension-approvals"].includes(pending.path) || typeof pending.originalTarget !== "string" || !pending.originalTarget || pending.originalTarget.length > 191)) throw new Error("原续租目标引用无效");
      rememberReference(storageKey, pending);
      slot.pending = pending; publish();
      let value: T;
      try {
        assertCurrent();
        // Dispatch the frozen body once, never the form's later values or a pending operation again.
        value = await context.write<T>(pending.path, { ...JSON.parse(pending.body), operationKey: pending.key }, command.method);
        pending.state = "committed";
      } catch (error) {
        // This named 409 is the service's known pre-write CAS refusal, not a missing receipt inference.
        if ((error as { status?: number; code?: string })?.status === 409
          && (error as { code?: string }).code === "enterprise_revision_conflict") {
          assertCurrent(); finish();
          if (onRevisionConflict) { await onRevisionConflict(); assertCurrent(); }
        }
        throw error;
      }
      assertCurrent(); rememberReference(storageKey, pending); publish();
      try { await afterCommit(value); assertCurrent(); }
      catch (error) { assertCurrent(); throw new Error(`已提交，后续读取失败；仅可刷新已提交结果 / Committed; refresh failed: ${workflowError(error)}`); }
      finish(); report(); return value;
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; if (!slot.pending) unresolved.delete(slotKey); publish(); }
  };
  const recover = async (afterCommit: (original?: EnterpriseOperationResult, path?: string) => Promise<void>) => {
    assertCurrent();
    const active = unresolved.get(slotKey);
    if (!active?.pending) return;
    if (active.busy) throw new Error("原操作仍在处理中 / Original operation is still in flight");
    active.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少原操作协调能力，只能保留引用 / Original coordination unavailable");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const pending = active.pending;
      if (!pending) return;
      const saved = readReference(storageKey);
      if (saved && saved.key !== pending.key) throw new Error("原操作引用已变化，不能覆盖当前请求 / Original reference changed");
      let receipt: EnterpriseOperationResult | undefined;
      // A reloaded local marker is not proof that the server committed.
      if (pending.state !== "committed" || !pending.body) {
        receipt = await read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(pending.key)}`);
        if (receipt.state !== "committed") throw new Error("尚未读到原收据，不代表未写入；保留原请求，不能重发 / No receipt yet is not proof of no write");
        pending.state = "committed"; publish();
      }
      rememberReference(storageKey, pending);
      await afterCommit(receipt, pending.path); assertCurrent();
      forgetReference(storageKey); active.pending = undefined; unresolved.delete(slotKey); report();
      });
    } catch (error) {
      const failure = active.pending?.state === "committed"
        ? new Error(`已提交，后续读取失败；仅可刷新已提交结果 / Committed; refresh failed: ${workflowError(error)}`) : error;
      report(failure); throw failure;
    } finally { active.busy = false; publish(); }
  };
  return { pending: slot.pending, busy: slot.busy, blocked: Boolean(storageError || slot.pending || slot.busy),
    error: storageError || (failure?.scopeKey === slotKey ? failure.message : ""), run, recover, read, assertCurrent };
}
