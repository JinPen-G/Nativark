/** One registered order inspection command, not enterprise management or fulfillment.
 * Durable opaque references coordinate realms; missing original evidence never permits replay. */
import { useEffect, useRef, useState } from "react";
import type { ApiResult, PrepareRentalExchangeInspectionRequest, RentalExchangeInspectionPreparation, RentalExchangeInspectionPreparationOriginal, RentalExchangeInspectionRequirements, RentalExchangeInspectionRequirementsRequest } from "@rental-os/shared";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";
import { enterpriseOperatorIdentity } from "../membership/original-enterprise-operation";

type Reference = { key: string; orderId: string; requirementsHash: string };
const messageOf = (error: unknown) => error instanceof Error ? error.message : "原检查结果不可核对";
export function useOriginalExchangeInspection(orderId: string, operationToken?: string, viewKey = "") {
  const auth = useAuthStore(), base = enterpriseOperatorIdentity(), identity = JSON.stringify([base, orderId, operationToken, viewKey]);
  const latest = useRef(identity); latest.current = identity;
  const mounted = useRef(true), busy = useRef(false), controller = useRef(new AbortController());
  const [, render] = useState(0);
  const storageKey = `rental-os:exchange-inspection:${JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId, orderId])}`;
  const permitted = Boolean(auth.sessionVerified && auth.token && auth.currentWorkspaceId && auth.user && !auth.user.isSaasAdmin && auth.hasPermission("rental-os:order:operate"));
  const readReference = (): Reference | undefined => {
    const raw = localStorage.getItem(storageKey); if (raw === null) return;
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).some(key => !["key", "orderId", "requirementsHash"].includes(key)) || value.orderId !== orderId
      || typeof value.key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.key) || typeof value.requirementsHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.requirementsHash)) throw new Error("原检查引用不可读取，不能重新保存");
    return value;
  };
  let pending: Reference | undefined, storageError = "";
  if (permitted) { try { pending = readReference(); } catch (error) { storageError = messageOf(error); } }
  const current = () => {
    const state = useAuthStore.getState();
    if (!mounted.current || latest.current !== identity || enterpriseOperatorIdentity() !== base || !state.sessionVerified || !state.token
      || !state.currentWorkspaceId || state.user?.isSaasAdmin || !state.hasPermission("rental-os:order:operate")) throw new Error("订单或当前权限已变化，原检查请求已隔离");
  };
  const publish = () => { if (mounted.current && latest.current === identity && enterpriseOperatorIdentity() === base) render(value => value + 1); };
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    const unsubscribe = useAuthStore.subscribe(() => { if (enterpriseOperatorIdentity() !== base) controller.current.abort(); });
    return () => { unsubscribe(); controller.current.abort(); mounted.current = false; };
  }, [identity]);
  const path = `/rental/v1/orders/${encodeURIComponent(orderId)}/exchange-inspection`;
  const transport = async <T,>(url: string, method: "get" | "post", data?: object): Promise<T> => {
    current();
    const response = await http.request<ApiResult<T>>({ url, method, data, _authRetry: true,
      headers: operationToken ? { "X-Operation-Token": operationToken } : undefined,
      signal: AbortSignal.any([currentSessionSignal(), controller.current.signal]) } as Parameters<typeof http.request<ApiResult<T>>>[0]);
    current(); return response.data.data;
  };
  const matches = (value: RentalExchangeInspectionPreparation, reference: Reference) => {
    if (!value || !value.id || value.orderId !== orderId || value.workspaceId !== auth.currentWorkspaceId || value.actorUserId !== auth.user?.id
      || value.operationKey !== reference.key || value.requirementsHash !== reference.requirementsHash || !/^[a-f0-9]{64}$/u.test(value.requestHash)
      || value.state !== "prepared" || value.revision !== 1 || value.customerConsent !== "not_connected" || value.execution !== "not_connected"
      || value.media !== "unavailable" || value.reservation !== "not_reserved" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("原检查准备与本单原键不匹配，不能清除未决引用");
    return value;
  };
  const original = async (reference: Reference) => {
    const result = await transport<RentalExchangeInspectionPreparationOriginal>(`${path}/operations/${encodeURIComponent(reference.key)}`, "get");
    if (result.state !== "observed" || result.retryable !== false) throw new Error("尚未读到原检查结果，不代表未保存，不能重发");
    const value = matches(result.preparation, reference); current();
    const latestReference = readReference();
    if (!latestReference || latestReference.key !== reference.key || latestReference.orderId !== reference.orderId || latestReference.requirementsHash !== reference.requirementsHash) throw new Error("原检查引用已变化，不能覆盖");
    localStorage.removeItem(storageKey); if (localStorage.getItem(storageKey) !== null) throw new Error("原检查引用未清除，只能继续回读");
    return value;
  };
  const exclusive = async <T,>(fn: () => Promise<T>): Promise<T> => {
    current(); if (busy.current) throw new Error("原检查操作仍在处理中");
    busy.current = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少跨页面原键协调能力，不能保存检查");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => { current(); return fn(); });
    } finally { busy.current = false; publish(); }
  };
  return { identity, permitted, workspaceId: auth.currentWorkspaceId, pending, busy: busy.current, storageError, current,
    requirements: (input: RentalExchangeInspectionRequirementsRequest) => transport<RentalExchangeInspectionRequirements>(`${path}/requirements`, "post", input),
    run: (input: Omit<PrepareRentalExchangeInspectionRequest, "operationKey">) => exclusive(async () => {
      if (readReference()) throw new Error("请先核对原检查结果，不可再次保存");
      const body = structuredClone(input), reference: Reference = { key: crypto.randomUUID(), orderId, requirementsHash: body.requirementsHash };
      const raw = JSON.stringify(reference); localStorage.setItem(storageKey, raw);
      if (localStorage.getItem(storageKey) !== raw) throw new Error("无法可靠保存原检查引用，未派发请求");
      current(); await transport<RentalExchangeInspectionPreparation>(`${path}/preparations`, "post", { ...body, operationKey: reference.key });
      return original(reference);
    }),
    recover: () => exclusive(async () => { const reference = readReference(); return reference ? original(reference) : undefined; }) };
}
