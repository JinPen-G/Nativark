/** Coordinates one customer delegation's source, explicit execution and Core result.
 * The original D and its observation state stay scoped to the current operator.
 * Core and the private source owner supply the authority and durable receipts. */
import { useEffect, useRef, useState } from "react";
import type { ApiResult, EnterpriseMerchantOrderDelegationResult, EnterpriseOrderDelegationView } from "@rental-os/shared";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";
import { enterpriseOperatorIdentity } from "../membership/original-enterprise-operation";

type SourceReference = { delegationKey: string; state: "source" | "unknown" | "observed" };
const validKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const sourceFields = new Set(["delegationKey", "personalCustomerId", "corporateCustomerId", "quoteId", "workspaceId", "requestReference", "state", "revision", "expiresAt", "confirmedAt", "purpose", "original", "retryable"]);
const receiptFields = new Set(["state", "delegationKey", "sourceHash", "tenantId", "workspaceId", "personalCustomerId", "corporateCustomerId", "quoteId", "requestHash", "coreIdempotencyKey", "actorUserId", "orderId", "consumedAt", "retryable"]);

export function useMerchantOrderDelegationSource(active: boolean) {
  const auth = useAuthStore(), actorIdentity = enterpriseOperatorIdentity();
  const identity = JSON.stringify([actorIdentity, active]);
  const latest = useRef(identity); latest.current = identity;
  const mounted = useRef(true), controller = useRef(new AbortController()), busy = useRef<AbortSignal | undefined>(undefined);
  const [, render] = useState(0);
  const storageKey = `rental-os:merchant-order-delegation-source:${JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId])}`;
  const permitted = Boolean(active && auth.sessionVerified && auth.token && auth.tenant?.tenantId && auth.currentWorkspaceId
    && auth.user && !auth.user.isSaasAdmin && auth.hasPermission("rental-os:corporate:manage") && auth.hasPermission("rental-os:order:operate"));
  const readReference = (): SourceReference | undefined => {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return;
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).some(key => !["delegationKey", "state"].includes(key))
      || !validKey(value.delegationKey) || !["source", "unknown", "observed"].includes(value.state)) throw new Error("原委托来源引用不可读取 / Original source reference unavailable");
    return value;
  };
  const remember = (reference: SourceReference) => {
    const encoded = JSON.stringify(reference); localStorage.setItem(storageKey, encoded);
    if (localStorage.getItem(storageKey) !== encoded) throw new Error("原 D 未可靠保存 / Original D was not retained");
  };
  let saved: SourceReference | undefined, storageError = "";
  if (permitted) {
    try { saved = readReference(); }
    catch (error) { storageError = error instanceof Error ? error.message : "原委托来源引用不可读取"; }
  }
  const current = () => {
    const state = useAuthStore.getState();
    if (!active || !mounted.current || latest.current !== identity || actorIdentity !== enterpriseOperatorIdentity()
      || !state.sessionVerified || !state.token || !state.currentWorkspaceId || state.user?.isSaasAdmin
      || !state.hasPermission("rental-os:corporate:manage") || !state.hasPermission("rental-os:order:operate")) {
      throw new Error("商户身份、空间或权限已变化 / Operator scope changed");
    }
  };
  const publish = () => { if (mounted.current && latest.current === identity) render(value => value + 1); };
  useEffect(() => {
    mounted.current = true;
    const ownedController = new AbortController(); controller.current = ownedController;
    const unsubscribe = useAuthStore.subscribe(() => { if (enterpriseOperatorIdentity() !== actorIdentity) ownedController.abort(); });
    return () => { unsubscribe(); ownedController.abort(); mounted.current = false; };
  }, [identity]);

  const read = async (delegationKey: string): Promise<EnterpriseOrderDelegationView> => {
    current();
    const ownedSignal = controller.current.signal;
    if (!validKey(delegationKey)) throw new Error("原委托键无效 / Invalid original delegation key");
    if (storageError) throw new Error(storageError);
    if (busy.current === ownedSignal) throw new Error("原来源仍在读取 / Original source is still being read");
    busy.current = ownedSignal; publish();
    try {
      if (!navigator.locks?.request) throw new Error("原引用协调能力不可用 / Original reference coordination unavailable");
      return await navigator.locks.request(`${storageKey}:lookup`, async () => {
        current();
        if (ownedSignal.aborted) throw new Error("原来源读取已取消 / Original source read was cancelled");
        const previous = readReference();
        if (previous?.state === "unknown" && previous.delegationKey !== delegationKey) throw new Error("须先核对原 D 的未决提交 / Read the unresolved original D first");
        remember({ delegationKey, state: previous?.delegationKey === delegationKey ? previous.state : "source" });
        const response = await http.request<ApiResult<EnterpriseOrderDelegationView>>({
          url: `/membership/enterprise-workflows/order-delegations/${encodeURIComponent(delegationKey)}`,
          method: "get", _authRetry: true,
          signal: AbortSignal.any([currentSessionSignal(), ownedSignal]),
        } as Parameters<typeof http.request<ApiResult<EnterpriseOrderDelegationView>>>[0]);
        current();
        if (ownedSignal.aborted) throw new Error("原来源读取已取消 / Original source read was cancelled");
        const value = response.data.data, original = value?.original, requestReference = value?.requestReference;
        if (!value || Object.keys(value).some(key => !sourceFields.has(key)) || value.delegationKey !== delegationKey
          || value.retryable !== false || value.purpose !== "merchant_operator" || !Number.isSafeInteger(value.revision) || value.revision < 1
          || !["issued", "expired", "revoked", "consumed"].includes(value.state)
          || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.confirmedAt))
          || !requestReference || Object.keys(requestReference).length !== 1
          || !("approvalId" in requestReference ? validId(requestReference.approvalId) : validId(requestReference.quoteId))
          || [value.personalCustomerId, value.corporateCustomerId, value.quoteId, value.workspaceId].some(id => id !== undefined && !validId(id))
          || value.workspaceId !== undefined && value.workspaceId !== auth.currentWorkspaceId
          || !original || original.retryable !== false) throw new Error("原委托来源或空间无法核对 / Original delegation source mismatch");
        if (value.state === "consumed") {
          if (original.state !== "consumed" || Object.keys(original).some(key => !receiptFields.has(key))
            || original.delegationKey !== delegationKey || original.coreIdempotencyKey !== delegationKey
            || original.tenantId !== auth.tenant?.tenantId || original.workspaceId !== auth.currentWorkspaceId
            || ![original.personalCustomerId, original.corporateCustomerId, original.quoteId, original.actorUserId, original.orderId].every(validId)
            || !/^[a-f0-9]{64}$/u.test(original.sourceHash) || !/^[a-f0-9]{64}$/u.test(original.requestHash)
            || !Number.isFinite(Date.parse(original.consumedAt))
            || value.personalCustomerId !== undefined && value.personalCustomerId !== original.personalCustomerId
            || value.corporateCustomerId !== undefined && value.corporateCustomerId !== original.corporateCustomerId
            || value.quoteId !== undefined && value.quoteId !== original.quoteId) throw new Error("原委托消费关联无法核对 / Original consumption receipt mismatch");
        } else if (original.state !== (value.state === "revoked" ? "revoked" : "not_submitted")
          || Object.keys(original).some(key => !["state", "retryable"].includes(key))) {
          throw new Error("原委托状态与收据无法核对 / Original source state mismatch");
        }
        const retained = readReference();
        if (retained?.delegationKey !== delegationKey) throw new Error("原 D 引用已变化 / Original D reference changed");
        return structuredClone(value);
      });
    } finally {
      if (busy.current === ownedSignal) busy.current = undefined;
      publish();
    }
  };

  const originalResult = async (delegationKey: string, source?: EnterpriseOrderDelegationView, reviewed?: () => void): Promise<EnterpriseMerchantOrderDelegationResult> => {
    current();
    const ownedSignal = controller.current.signal;
    if (!validKey(delegationKey) || storageError) throw new Error(storageError || "原委托键无效 / Invalid original delegation key");
    if (busy.current === ownedSignal) throw new Error("原委托仍在核对 / Original delegation is still pending");
    busy.current = ownedSignal; publish();
    try {
      if (!navigator.locks?.request) throw new Error("原引用协调能力不可用 / Original reference coordination unavailable");
      return await navigator.locks.request(`${storageKey}:lookup`, async () => {
        current();
        if (ownedSignal.aborted) throw new Error("原委托操作已隔离 / Original delegation operation was isolated");
        const previous = readReference();
        if (previous?.state === "unknown" && previous.delegationKey !== delegationKey) throw new Error("须先核对原 D 的未决提交 / Read the unresolved original D first");
        if (source) {
          reviewed?.();
          if (previous?.delegationKey !== delegationKey || previous.state !== "source" || source.state !== "issued" || source.revision !== 1
            || source.workspaceId !== auth.currentWorkspaceId || !source.personalCustomerId || !source.corporateCustomerId || !source.quoteId
            || Date.parse(source.expiresAt) <= Date.now()) throw new Error("须重新核对原委托或读取原结果 / Recheck the original delegation or read its result");
        }
        remember({ delegationKey, state: source ? "unknown" : previous?.delegationKey === delegationKey ? previous.state : "source" });
        current();
        const response = await http.request<ApiResult<EnterpriseMerchantOrderDelegationResult>>({
          url: `/membership/enterprise-workflows/order-delegations/${encodeURIComponent(delegationKey)}/${source ? "execute" : "result"}`,
          method: source ? "post" : "get", _authRetry: true,
          ...(source ? { data: { delegationKey, expectedRevision: 1, confirm: true,
            ...("approvalId" in source.requestReference ? { approvalId: source.requestReference.approvalId } : {}) } } : {}),
          signal: AbortSignal.any([currentSessionSignal(), ownedSignal]),
        } as Parameters<typeof http.request<ApiResult<EnterpriseMerchantOrderDelegationResult>>>[0]);
        current();
        if (ownedSignal.aborted) throw new Error("原委托操作已隔离 / Original delegation operation was isolated");
        reviewed?.();
        const value = response.data.data;
        if (!value || Object.keys(value).some(key => !["delegationKey", "state", "orderId", "retryable"].includes(key))
          || value.delegationKey !== delegationKey || value.retryable !== false
          || !(value.state === "observed" && validId(value.orderId) || value.state === "unknown" && value.orderId === null)
          || readReference()?.delegationKey !== delegationKey) throw new Error("原 D 与 Core 结果无法核对 / Original D and Core result mismatch");
        remember({ delegationKey, state: value.state === "observed" ? "observed" : source || previous?.state === "unknown" ? "unknown" : "source" });
        return structuredClone(value);
      });
    } finally {
      if (busy.current === ownedSignal) busy.current = undefined;
      publish();
    }
  };
  const execute = async (source: EnterpriseOrderDelegationView, reviewed: () => void) => {
    current(); reviewed();
    const original = structuredClone(source), previous = readReference();
    if (previous?.state === "unknown" || previous?.state === "observed") throw new Error("须读取原 Core 结果 / Read the original Core result");
    const latestSource = await read(original.delegationKey);
    current(); reviewed();
    if (JSON.stringify(latestSource) !== JSON.stringify(original)) throw new Error("原委托明细已变化，须重新核对 / Original delegation changed, review it again");
    return originalResult(original.delegationKey, latestSource, reviewed);
  };
  return { actorIdentity, identity, permitted, savedKey: saved?.delegationKey, savedState: saved?.state, storageError,
    busy: busy.current === controller.current.signal, current, read, execute, readOriginal: (delegationKey: string) => originalResult(delegationKey) };
}
