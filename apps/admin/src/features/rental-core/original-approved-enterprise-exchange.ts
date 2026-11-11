/** Merchant execution retains an opaque original K before its single dispatch.
 * Core receipts and the refreshed original change retire that reference. */
import { useEffect, useRef, useState } from "react";
import type { ApiResult, ExecuteApprovedRentalExchangeRequest, RentalApprovedExchangeOriginal, RentalApprovedExchangeReceipt } from "@rental-os/shared";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";
import { enterpriseOperatorIdentity } from "../membership/original-enterprise-operation";

type Reference = { key: string; orderId: string; approvalId: string };
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const validKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const validHash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export function useOriginalApprovedEnterpriseExchange(orderId: string, operationToken?: string) {
  const auth = useAuthStore(), base = enterpriseOperatorIdentity(), identity = JSON.stringify([base, orderId, operationToken]);
  const latest = useRef(identity); latest.current = identity;
  const mounted = useRef(true), busy = useRef(false), controller = useRef(new AbortController());
  const [, render] = useState(0);
  const storageKey = `rental-os:approved-exchange:${JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId, orderId])}`;
  const allowed = () => {
    const state = useAuthStore.getState();
    return Boolean(state.sessionVerified && state.token && state.tenant?.tenantId && state.currentWorkspaceId && state.user
      && !state.user.isSaasAdmin && state.hasPermission("rental-os:corporate:manage") && state.hasPermission("rental-os:order:operate"));
  };
  const permitted = allowed();
  const current = () => {
    if (!mounted.current || latest.current !== identity || enterpriseOperatorIdentity() !== base || !allowed()) throw new Error("当前商户、订单或执行权限已变化");
  };
  const publish = () => { if (mounted.current && latest.current === identity && enterpriseOperatorIdentity() === base) render(value => value + 1); };
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    const unsubscribe = useAuthStore.subscribe(() => { if (enterpriseOperatorIdentity() !== base) controller.current.abort(); });
    return () => { unsubscribe(); controller.current.abort(); mounted.current = false; };
  }, [identity]);
  const readReference = (): Reference | undefined => {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return;
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).some(key => !["key", "orderId", "approvalId"].includes(key)) || value.orderId !== orderId
      || !validKey(value.key) || !validId(value.approvalId)) throw new Error("原换货执行引用不可读取，请保留原键");
    return value;
  };
  let pending: Reference | undefined, storageError = "";
  if (permitted) { try { pending = readReference(); } catch { storageError = "原换货执行引用不可读取，请保留原键"; } }
  const transport = async <T,>(reference: Reference, method: "get" | "post", input?: object): Promise<T> => {
    current();
    const root = `/membership/enterprise-workflows/orders/${encodeURIComponent(orderId)}/exchange-approvals/${encodeURIComponent(reference.approvalId)}`;
    const response = await http.request<ApiResult<T>>({ method, url: method === "post" ? `${root}/execute` : `${root}/execution-operations/${encodeURIComponent(reference.key)}`,
      data: input, _authRetry: true, headers: operationToken ? { "X-Operation-Token": operationToken } : undefined,
      signal: AbortSignal.any([currentSessionSignal(), controller.current.signal]) } as Parameters<typeof http.request<ApiResult<T>>>[0]);
    current(); return response.data.data;
  };
  const receipt = (value: RentalApprovedExchangeReceipt, reference: Reference, input?: Omit<ExecuteApprovedRentalExchangeRequest, "operationKey">) => {
    if (!value || value.state !== "applied" || value.retryable !== false || value.orderId !== orderId || value.approvalId !== reference.approvalId
      || value.operationKey !== reference.key || value.workspaceId !== auth.currentWorkspaceId || value.actorUserId !== auth.user?.id
      || ![value.changeId, value.preparationId, value.consentId].every(validId) || !validKey(value.consentOperationKey)
      || value.consentOperationKey === reference.key || ![value.preparationHash, value.consentHash, value.requestHash, value.changeHash].every(validHash)
      || !/^approved-exchange:[a-f0-9]{64}$/u.test(value.coreIdempotencyKey) || !Number.isFinite(Date.parse(value.appliedAt))
      || input && (value.preparationId !== input.preparationId || value.preparationHash !== input.preparationHash
        || value.consentId !== input.consentId || value.consentOperationKey !== input.consentOperationKey)) throw new Error("原换货收据与订单、批准或独立确认引用不一致");
    return structuredClone(value);
  };
  const finish = async (reference: Reference, afterRead: (value: RentalApprovedExchangeReceipt) => Promise<void>, input?: Omit<ExecuteApprovedRentalExchangeRequest, "operationKey">) => {
    const original = await transport<RentalApprovedExchangeOriginal>(reference, "get");
    if (original?.state !== "observed" || original.retryable !== false) throw new Error("原换货执行仍待核对，请保留原键");
    const value = receipt(original.receipt, reference, input);
    await afterRead(value); current();
    const saved = readReference();
    if (!saved || saved.key !== reference.key || saved.approvalId !== reference.approvalId || saved.orderId !== reference.orderId) throw new Error("原换货执行引用已变化");
    localStorage.removeItem(storageKey);
    if (localStorage.getItem(storageKey) !== null) throw new Error("原换货执行引用仍在，请继续核原收据");
    return value;
  };
  const exclusive = async <T,>(action: () => Promise<T>) => {
    current(); if (busy.current) throw new Error("原换货执行正在处理中");
    busy.current = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("原执行键协调能力不可用");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => { current(); return action(); });
    } finally { busy.current = false; publish(); }
  };
  return { identity, permitted, pending, busy: busy.current, storageError, current,
    run: (prepare: () => Promise<Omit<ExecuteApprovedRentalExchangeRequest, "operationKey">>, afterRead: (value: RentalApprovedExchangeReceipt) => Promise<void>) => exclusive(async () => {
      if (readReference()) throw new Error("请先核对原换货执行键");
      const input = structuredClone(await prepare()); current();
      if (!validId(orderId) || ![input.approvalId, input.preparationId, input.consentId].every(validId) || !validKey(input.consentOperationKey)
        || !validHash(input.preparationHash) || !Number.isSafeInteger(input.expectedApprovalRevision) || input.expectedApprovalRevision < 3
        || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt)) || typeof input.reason !== "string" || !input.reason.trim()
        || input.reason.length > 500 || input.confirm !== true) throw new Error("原换货执行引用、修订或确认无效");
      const reference: Reference = { key: crypto.randomUUID(), orderId, approvalId: input.approvalId };
      if (!validKey(reference.key) || reference.key === input.consentOperationKey) throw new Error("执行键须与检查确认键独立");
      const raw = JSON.stringify(reference); localStorage.setItem(storageKey, raw);
      if (localStorage.getItem(storageKey) !== raw) throw new Error("原执行键未可靠保存，无法派发");
      current(); const value = await transport<RentalApprovedExchangeReceipt>(reference, "post", { ...input, operationKey: reference.key });
      receipt(value, reference, input); return finish(reference, afterRead, input);
    }),
    recover: (afterRead: (value: RentalApprovedExchangeReceipt) => Promise<void>) => exclusive(async () => {
      const reference = readReference(); return reference ? finish(reference, afterRead) : undefined;
    }) };
}
