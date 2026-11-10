/** Dedicated image sources only, never preparation, consent or exchange execution.
 * Every write stage is sealed before dispatch; a restarted chain only observes its original key. */
import { useEffect, useRef, useState } from "react";
import type { ApiResult, CreateRentalExchangeInspectionMediaRequest, CreateRentalExchangeInspectionMediaResult, RentalExchangeInspectionMediaOriginal,
  RentalExchangeInspectionMediaRequirements, RentalExchangeInspectionMediaSource, RentalExchangeInspectionRequirementsRequest } from "@rental-os/shared";
import { http } from "@/api/http";
import { currentSessionSignal } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";
import { enterpriseOperatorIdentity } from "../membership/original-enterprise-operation";

type Declaration = Omit<CreateRentalExchangeInspectionMediaRequest, "operationKey">;
type Phase = "create_attempted" | "put_attempted" | "complete_attempted" | "completed";
type Reference = { key: string; orderId: string; requirementsHash: string; fieldHash: string; bindingHash: string; phase: Phase; sourceHash?: string };
const hashPattern = /^[a-f0-9]{64}$/u, keyPattern = /^[A-Za-z0-9_-]{1,128}$/u;
// This is a local retention bound, not a business quota. Full history must not be silently evicted.
const referenceLimit = 64;
const phases: Phase[] = ["create_attempted", "put_attempted", "complete_attempted", "completed"];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function declaration(value: Declaration): Declaration {
  return { expectedOrderUpdatedAt: value.expectedOrderUpdatedAt, exchange: { orderLineId: value.exchange.orderLineId, allocationId: value.exchange.allocationId,
    replacementItemGroupId: value.exchange.replacementItemGroupId, replacementAssetId: value.exchange.replacementAssetId,
    replacementPricingGroupId: value.exchange.replacementPricingGroupId, priceBasis: value.exchange.priceBasis, originalDisposition: value.exchange.originalDisposition },
    requirementsHash: value.requirementsHash, side: value.side, templateId: value.templateId, templateVersion: value.templateVersion,
    fieldCode: value.fieldCode, fileName: value.fileName, mimeType: value.mimeType, sizeBytes: value.sizeBytes };
}
function fieldBinding(value: Declaration) { return { requirementsHash: value.requirementsHash, side: value.side, templateId: value.templateId, templateVersion: value.templateVersion, fieldCode: value.fieldCode }; }
/** The authenticated API owns provider/config authority. These checks restrict browser transport,
 * not DNS or cryptographic signature validity; presignS3/Cos/OSS currently sign only Content-Type. */
function putTarget(url: string, headers: Record<string, string>, mimeType: string) {
  const target = new URL(url), host = target.hostname.toLowerCase(), params = target.searchParams;
  if (target.protocol !== "https:" || target.username || target.password || target.hash || target.port && target.port !== "443"
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u.test(host)
    || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/u.test(host) || target.pathname === "/") throw new Error("影像上传地址不符合原签发约束");
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) throw new Error("影像上传签名参数重复");
  const exactly = (keys: string[]) => keys.length === names.length && names.every(name => keys.includes(name));
  const date = (name: string) => /^\d{8}T\d{6}Z$/u.test(params.get(name) ?? "");
  const expiry = (name: string) => { const value = params.get(name) ?? ""; return /^[1-9]\d*$/u.test(value) && Number(value) <= 604800; };
  const s3 = exactly(["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"])
    && params.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" && params.get("X-Amz-SignedHeaders") === "content-type;host"
    && /^[^/]+\/\d{8}\/[^/]+\/s3\/aws4_request$/u.test(params.get("X-Amz-Credential") ?? "") && date("X-Amz-Date") && expiry("X-Amz-Expires") && hashPattern.test(params.get("X-Amz-Signature") ?? "");
  const oss = exactly(["x-oss-additional-headers", "x-oss-credential", "x-oss-date", "x-oss-expires", "x-oss-signature-version", "x-oss-signature"])
    && params.get("x-oss-signature-version") === "OSS4-HMAC-SHA256" && params.get("x-oss-additional-headers") === "content-type;host"
    && /^[^/]+\/\d{8}\/[^/]+\/oss\/aliyun_v4_request$/u.test(params.get("x-oss-credential") ?? "") && date("x-oss-date") && expiry("x-oss-expires") && hashPattern.test(params.get("x-oss-signature") ?? "");
  const cos = exactly(["q-sign-algorithm", "q-ak", "q-sign-time", "q-key-time", "q-header-list", "q-url-param-list", "q-signature"])
    && params.get("q-sign-algorithm") === "sha1" && params.get("q-header-list") === "host" && params.get("q-url-param-list") === "" && Boolean(params.get("q-ak"))
    && /^\d+;\d+$/u.test(params.get("q-sign-time") ?? "") && params.get("q-sign-time") === params.get("q-key-time") && /^[a-f0-9]{40}$/u.test(params.get("q-signature") ?? "");
  if ([s3, oss, cos].filter(Boolean).length !== 1 || !headers || Object.keys(headers).length !== 1 || headers["Content-Type"] !== mimeType) throw new Error("影像上传签名或请求头不符合原契约");
  return { url: target.href, headers: { "Content-Type": mimeType } };
}
export function useOriginalExchangeInspectionMedia(orderId: string, operationToken?: string, viewKey = "") {
  const auth = useAuthStore(), base = enterpriseOperatorIdentity(), context = JSON.stringify([base, orderId, operationToken, viewKey]);
  // Returning to the same selection cannot revive a suspended earlier chain (A→B→A).
  const generation = useRef({ context, value: 0 });
  if (generation.current.context !== context) generation.current = { context, value: generation.current.value + 1 };
  const version = generation.current.value, identity = JSON.stringify([context, version]);
  const latest = useRef(identity); latest.current = identity;
  const mounted = useRef(true), busy = useRef(false), controller = useRef(new AbortController()), [, render] = useState(0);
  const storageKey = `rental-os:exchange-inspection-media:${JSON.stringify([auth.tenant?.tenantId, auth.user?.id, auth.currentWorkspaceId, orderId])}`;
  const permitted = Boolean(auth.sessionVerified && auth.token && auth.currentWorkspaceId && auth.user && !auth.user.isSaasAdmin && auth.hasPermission("rental-os:order:operate"));
  const current = () => {
    const state = useAuthStore.getState();
    if (!mounted.current || generation.current.value !== version || latest.current !== identity || enterpriseOperatorIdentity() !== base || !state.sessionVerified || !state.token
      || !state.currentWorkspaceId || state.user?.isSaasAdmin || !state.hasPermission("rental-os:order:operate")) throw new Error("订单或当前权限已变化，原影像请求已隔离");
  };
  const publish = () => { if (mounted.current && latest.current === identity && enterpriseOperatorIdentity() === base) render(n => n + 1); };
  const read = (): Reference[] => {
    const raw = localStorage.getItem(storageKey); if (raw === null) return [];
    const values = JSON.parse(raw);
    if (!Array.isArray(values) || !values.length || values.length > referenceLimit || new Set(values.map(row => row?.key)).size !== values.length
      || new Set(values.map(row => row?.fieldHash)).size !== values.length || values.some(row => !row || Object.keys(row).some(key => !["key", "orderId", "requirementsHash", "fieldHash", "bindingHash", "phase", "sourceHash"].includes(key))
        || row.orderId !== orderId || typeof row.key !== "string" || !keyPattern.test(row.key) || !phases.includes(row.phase)
        || [row.requirementsHash, row.fieldHash, row.bindingHash].some(value => typeof value !== "string" || !hashPattern.test(value))
        || row.sourceHash !== undefined && (typeof row.sourceHash !== "string" || !hashPattern.test(row.sourceHash))
        || row.phase !== "create_attempted" && row.sourceHash === undefined)) throw new Error("原影像引用不可读取，不能重新上传");
    return values;
  };
  const remember = (rows: Reference[]) => { const raw = JSON.stringify(rows); localStorage.setItem(storageKey, raw); if (localStorage.getItem(storageKey) !== raw) throw new Error("原影像引用未可靠保存，未派发下一请求"); publish(); };
  const advance = (reference: Reference, patch: Partial<Reference>) => {
    current(); const rows = read(), index = rows.findIndex(row => row.key === reference.key);
    if (index < 0 || JSON.stringify(rows[index]) !== JSON.stringify(reference)) throw new Error("原影像引用已变化，不能继续派发");
    const next = { ...reference, ...patch }; rows[index] = next; remember(rows); current(); return next;
  };
  let references: Reference[] = [], storageError = "";
  if (permitted) { try { references = read(); } catch { storageError = "原影像引用不可读取，不能重新上传"; } }
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    const unsubscribe = useAuthStore.subscribe(() => {
      if (enterpriseOperatorIdentity() !== base) { generation.current.value++; controller.current.abort(); if (mounted.current) render(n => n + 1); }
    });
    return () => { unsubscribe(); controller.current.abort(); mounted.current = false; };
  }, [identity]);
  const signal = () => AbortSignal.any([currentSessionSignal(), controller.current.signal]);
  const path = `/rental/v1/orders/${encodeURIComponent(orderId)}/exchange-inspection/media`;
  const transport = async <T,>(url: string, method: "get" | "post", data?: object) => {
    current(); const response = await http.request<ApiResult<T>>({ url, method, data, _authRetry: true,
      headers: operationToken ? { "X-Operation-Token": operationToken } : undefined, signal: signal() } as Parameters<typeof http.request<ApiResult<T>>>[0]);
    current(); return response.data.data;
  };
  const sourceFor = async (value: RentalExchangeInspectionMediaSource, reference: Reference) => {
    const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 191;
    if (!value || value.orderId !== orderId || value.workspaceId !== auth.currentWorkspaceId || value.actorUserId !== auth.user?.id || value.operationKey !== reference.key
      || value.requirementsHash !== reference.requirementsHash || value.preparationUse !== "not_connected" || value.retryable !== false || !hashPattern.test(value.requestHash)
      || ![value.id, value.sessionId, value.fileAssetId].every(id) || !["pending_upload", "completion_unknown", "completed"].includes(value.state)
      || !Number.isFinite(Date.parse(value.expectedOrderUpdatedAt)) || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt))
      || !value.exchange || !["original_return", "replacement_pickup"].includes(value.side)) throw new Error("原影像来源与本单身份或原键不匹配");
    const bindingHash = await fingerprint(declaration(value)), fieldHash = await fingerprint(fieldBinding(value)); current();
    if (bindingHash !== reference.bindingHash || fieldHash !== reference.fieldHash) throw new Error("原影像声明或照片字段不匹配");
    const sourceHash = await fingerprint({ declaration: declaration(value), id: value.id, sessionId: value.sessionId, fileAssetId: value.fileAssetId,
      requestHash: value.requestHash, createdAt: value.createdAt, expiresAt: value.expiresAt, orderId, actorUserId: value.actorUserId, workspaceId: value.workspaceId, operationKey: value.operationKey }); current();
    if (reference.sourceHash && reference.sourceHash !== sourceHash) throw new Error("原影像文件关联已变化");
    if (value.state === "completed") {
      const proof = value.completion;
      if (!proof || !hashPattern.test(proof.contentHash) || proof.mimeType !== value.mimeType || proof.sizeBytes !== value.sizeBytes
        || !Number.isFinite(Date.parse(proof.completedAt)) || !Number.isSafeInteger(proof.width) || !Number.isSafeInteger(proof.height)
        || proof.width < 1 || proof.height < 1 || proof.width > 16384 || proof.height > 16384 || proof.width * proof.height > 40000000) throw new Error("原影像完成证据不可核对");
    } else if (value.completion !== undefined) throw new Error("原影像完成状态不一致");
    return { value, sourceHash };
  };
  const original = async (reference: Reference) => {
    const result = await transport<RentalExchangeInspectionMediaOriginal>(`${path}/operations/${encodeURIComponent(reference.key)}`, "get");
    if (result?.state !== "observed" || result.retryable !== false) throw new Error("尚未读到原影像来源，不代表未上传，不能重发");
    const source = await sourceFor(result.source, reference); current();
    if (source.value.state === "completed") advance(reference, { phase: "completed", sourceHash: source.sourceHash });
    return source.value;
  };
  const exclusive = async <T,>(fn: () => Promise<T>): Promise<T> => {
    current(); if (busy.current) throw new Error("原影像操作仍在处理中"); busy.current = true; publish();
    try { if (!navigator.locks?.request) throw new Error("缺少跨页面协调能力，不能上传影像"); return await navigator.locks.request(`${storageKey}:dispatch`, async () => { current(); return fn(); }); }
    finally { busy.current = false; publish(); }
  };
  return { identity, permitted, workspaceId: auth.currentWorkspaceId, references, storageError, busy: busy.current, current,
    requirements: (input: RentalExchangeInspectionRequirementsRequest) => transport<RentalExchangeInspectionMediaRequirements>(`${path}/requirements`, "post", input),
    recover: (key: string) => exclusive(async () => { const reference = read().find(row => row.key === key); if (!reference) throw new Error("没有可核对的原影像引用"); return original(reference); }),
    run: (input: Declaration, file: File) => exclusive(async () => {
      // Validate before sealing; these checks are transport constraints, never server authorization.
      if (!input || Object.keys(input).some(key => !["expectedOrderUpdatedAt", "exchange", "requirementsHash", "side", "templateId", "templateVersion", "fieldCode", "fileName", "mimeType", "sizeBytes"].includes(key))
        || !input.exchange || Object.keys(input.exchange).some(key => !["orderLineId", "allocationId", "replacementItemGroupId", "replacementAssetId", "replacementPricingGroupId", "priceBasis", "originalDisposition"].includes(key))
        || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt))
        || [input.exchange.orderLineId, input.exchange.allocationId, input.exchange.replacementItemGroupId].some(value => typeof value !== "string" || !value.trim() || value.length > 191)
        || [input.exchange.replacementAssetId, input.exchange.replacementPricingGroupId].some(value => value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 191))
        || !["original_order_price", "replacement_current_price"].includes(input.exchange.priceBasis) || !["return_to_warehouse", "off_shelf"].includes(input.exchange.originalDisposition)
        || !hashPattern.test(input.requirementsHash) || !["original_return", "replacement_pickup"].includes(input.side)
        || ![input.templateId, input.templateVersion, input.fieldCode, input.fileName].every(value => typeof value === "string" && value.trim() && value.length <= 180)
        || !keyPattern.test(input.fieldCode) || ["__proto__", "constructor", "prototype"].includes(input.fieldCode)
        || !["image/jpeg", "image/png"].includes(input.mimeType) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 20 * 1024 * 1024
        || !file || file.name.trim() !== input.fileName || file.type !== input.mimeType || file.size !== input.sizeBytes) throw new Error("请核对 JPEG/PNG 文件声明，大小须为 1 字节至 20 MiB");
      const body = declaration(structuredClone(input)), fieldHash = await fingerprint(fieldBinding(body)), bindingHash = await fingerprint(body); current();
      let rows = read();
      if (rows.length >= referenceLimit) throw new Error("本机原影像引用已达保留上限，不能新增");
      if (rows.some(row => row.fieldHash === fieldHash)) throw new Error("该原照片字段已有上传引用，只能核对原来源");
      // A cached completed flag is not authority. Re-read every old source before admitting a new field.
      for (const reference of rows) { const source = await original(reference); current(); if (source.state !== "completed") throw new Error("请先核对原影像结果，不能换文件重新上传"); }
      rows = read(); let reference: Reference = { key: crypto.randomUUID(), orderId, requirementsHash: body.requirementsHash, fieldHash, bindingHash, phase: "create_attempted" };
      remember([...rows, reference]); current();
      const result = await transport<CreateRentalExchangeInspectionMediaResult>(`${path}/uploads`, "post", { ...body, operationKey: reference.key });
      if (!result || "state" in result) throw new Error("原上传仅可观察，没有新的上传凭据，不能继续发送");
      const source = await sourceFor(result.source, reference); current();
      if (source.value.state !== "pending_upload" || Date.parse(source.value.expiresAt) <= Date.now()) throw new Error("原上传凭据已失效，只能核对原来源");
      const target = putTarget(result.uploadUrl, result.uploadHeaders, body.mimeType);
      reference = advance(reference, { phase: "put_attempted", sourceHash: source.sourceHash }); current();
      let ok = false;
      try { const response = await fetch(target.url, { method: "PUT", headers: target.headers, body: file, credentials: "omit", redirect: "error", signal: signal() }); current(); ok = response.ok; }
      catch { throw new Error("原影像上传结果待核对，不能再次发送"); }
      if (!ok) throw new Error("原影像上传结果待核对，不能再次发送");
      reference = advance(reference, { phase: "complete_attempted" });
      await transport<RentalExchangeInspectionMediaOriginal>(`${path}/operations/${encodeURIComponent(reference.key)}/complete`, "post");
      const value = await original(reference);
      if (value.state !== "completed") throw new Error("原影像完成结果待核对，不能重新上传或完成");
      return value;
    }) };
}
