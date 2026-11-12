/** One explicit upload; durable references carry no file bytes, URL or credentials.
 * Lost PUT responses can be observed, never retransmitted. Completion has its own dispatch point. */
import { useEffect, useRef, useState } from "react";
import type { EnterprisePaymentProofBasis, FileAssetSummary, FileUploadSessionSummary } from "@rental-os/shared";
import { ActionButton, Alert, Button } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
type Observation = { state: "not_recorded" | "observed"; session?: Omit<FileUploadSessionSummary, "uploadUrl" | "uploadHeaders">; file?: Pick<FileAssetSummary, "id" | "fileName" | "status"> };
type Reference = { key: string; stage: "session" | "upload" | "complete"; objectRevision?: string };
function readReference(storageKey: string): Reference | undefined {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  const value = JSON.parse(raw);
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key) || !["session", "upload", "complete"].includes(value.stage)) throw new Error("原文件引用不可读，不能重新上传");
  if (value.objectRevision !== undefined && (typeof value.objectRevision !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.objectRevision))) throw new Error("原文件对象修订不可核对");
  return { key: value.key, stage: value.stage, ...(value.objectRevision ? { objectRevision: value.objectRevision } : {}) };
}
export function AuthorityUpload({ english, disabled, onFile, onBusy, purpose = "authority", paymentProof }: { english: boolean; disabled: boolean; onFile: (id: string) => void; onBusy: (busy: boolean) => void; purpose?: "authority" | "payment_proof"; paymentProof?: EnterprisePaymentProofBasis }) {
  const context = useEnterprise(), latest = useRef(context); latest.current = context;
  const proofMode = purpose === "payment_proof", proofKey = JSON.stringify(paymentProof), proofRef = useRef(proofKey); proofRef.current = proofKey;
  const endpoint = proofMode && paymentProof ? `/enterprise/corporates/${encodeURIComponent(paymentProof.corporateCustomerId)}/orders/${encodeURIComponent(paymentProof.orderId)}/payment-proof` : "/enterprise/authority";
  const storageKey = proofMode ? `rental-os:enterprise-payment-proof:${JSON.stringify([context.tenantCode, context.session?.customer.customerId, context.selectedCorporateId, context.session?.workspace?.workspaceCode, paymentProof?.orderId ?? "unselected"])}`
    : `rental-os:enterprise-authority:${JSON.stringify([context.tenantCode, context.session?.customer.customerId])}`;
  const [file, setFile] = useState<File>(), [pending, setPending] = useState<Reference>(), [observed, setObserved] = useState<Observation>(), [error, setError] = useState(""), [working, setWorking] = useState(false);
  const busy = useRef(false), key = useRef<Reference | undefined>(undefined), mounted = useRef(true);
  const current = () => {
    if (!mounted.current || latest.current.identity !== context.identity || context.signal.aborted) throw new Error("身份或页面已变化，请回到原申请核对 / Identity or page changed");
    if (proofMode) {
      const corporate = latest.current.entry?.corporates.find(row => row.corporateCustomerId === paymentProof?.corporateCustomerId);
      if (!paymentProof || proofRef.current !== proofKey || latest.current.selectedCorporateId !== paymentProof.corporateCustomerId
        || latest.current.session?.workspace?.workspaceCode !== paymentProof.workspaceCode || corporate?.permissionRevision !== paymentProof.permissionRevision
        || !["requests:manage", "orders:read", "finance:read"].every(action => corporate?.actions.some(permission => permission === action))
        || key.current && key.current.objectRevision !== paymentProof.objectRevision) throw new Error("原费用回款凭证对象或权限已变化，请保留原引用 / Original payment-evidence scope changed");
    }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    key.current = undefined; setFile(undefined); setObserved(undefined); setError(""); setWorking(false);
    try { const saved = readReference(storageKey); key.current = saved; setPending(saved); onBusy(Boolean(saved)); }
    catch { setPending(undefined); setError(english ? "Original file reference unavailable; do not upload again." : "原文件引用不可读，不能重新上传。"); onBusy(true); }
  }, [context.identity, storageKey]);
  const remember = (value: Reference) => {
    const raw = JSON.stringify(value); localStorage.setItem(storageKey, raw);
    if (localStorage.getItem(storageKey) !== raw) throw new Error("原文件引用未可靠保存，不能继续发送 / Original file reference was not saved");
    key.current = value; setPending(value);
  };
  const finish = (fileId: string) => {
    current(); onFile(fileId);
    localStorage.removeItem(storageKey);
    if (localStorage.getItem(storageKey) !== null) throw new Error("文件已归档，原引用尚未清除；仅可回读");
    key.current = undefined; setPending(undefined); setObserved(undefined); setFile(undefined); setError("");
  };
  const run = async (action: () => Promise<void>) => {
    current(); if (busy.current) throw new Error("上传仍在处理中 / Upload is in flight");
    busy.current = true; setWorking(true); onBusy(true);
    try {
      if (!navigator.locks?.request) throw new Error("缺少原上传协调能力，不能发送 / Upload coordination unavailable");
      await navigator.locks.request(`${storageKey}:dispatch`, async () => {
        current(); key.current = readReference(storageKey); setPending(key.current); await action();
      });
    } catch (e) { if (mounted.current && latest.current.identity === context.identity) setError(e instanceof Error ? e.message : "文件结果待核对"); throw e; }
    finally { busy.current = false; if (mounted.current && latest.current.identity === context.identity) { setWorking(false); onBusy(Boolean(key.current)); } }
  };
  const readOriginal = async () => {
    const original = key.current; if (!original) throw new Error("缺少原上传引用");
    const result = await context.read<Observation>(`${endpoint}/upload-operations/${encodeURIComponent(original.key)}`); current();
    setObserved(result);
    if (result.state === "observed" && result.session?.mode === "provider" && result.session.status === "completed" && result.file?.status === "active") finish(result.file.id);
    return result;
  };
  const observe = () => run(async () => {
    const result = await readOriginal();
    if (key.current && (result.state !== "observed" || result.session?.status !== "pending_upload")) throw new Error(english ? "No completed original receipt; keep the reference and contact the merchant." : "尚无原归档完成收据；保留原引用并联系商户，不能重传。");
  });
  const completeOriginal = async (sessionId: string) => {
    const original = key.current; if (!original || original.stage !== "upload") throw new Error("原归档命令可能已发出，只能回读");
    // Persist before completion dispatch. Failure thereafter can never enable another completion POST.
    remember({ ...original, stage: "complete" }); current();
    const asset = await context.write<FileAssetSummary>(`${endpoint}/upload-sessions/${encodeURIComponent(sessionId)}/complete`, {}); current();
    if (asset.status !== "active") throw new Error("原文件尚未归档");
    finish(asset.id);
  };
  const completeObserved = () => run(async () => {
    const result = await readOriginal();
    if (!key.current) return;
    if (result.state !== "observed" || result.session?.mode !== "provider" || result.session.status !== "pending_upload") throw new Error("原会话尚不可核验归档");
    await completeOriginal(result.session.sessionId);
  });
  const upload = () => run(async () => {
    if (!file || key.current || disabled) throw new Error("请先选择文件并核对原操作");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error(english ? "Use PDF, PNG or JPEG, up to 20 MiB." : "请选择20MiB以内的PDF、PNG或JPEG。");
    const original: Reference = { key: crypto.randomUUID(), stage: "session", ...(proofMode ? { objectRevision: paymentProof!.objectRevision } : {}) }; remember(original); setError(""); current();
    const session = await context.write<FileUploadSessionSummary>(`${endpoint}/upload-sessions`, { fileName: file.name, mimeType: file.type, sizeBytes: file.size, idempotencyKey: original.key,
      ...(proofMode ? { objectRevision: original.objectRevision } : {}) }); current();
    if (session.mode !== "provider" || session.status !== "pending_upload" || !session.uploadUrl) throw new Error("未取得真实上传能力，请查原会话");
    const target = new URL(session.uploadUrl);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("文件地址不可用");
    remember({ ...original, stage: "upload" }); current();
    const response = await fetch(target, { method: "PUT", body: file, headers: session.uploadHeaders, credentials: "omit", redirect: "error", signal: context.signal }); current();
    if (!response.ok) throw new Error("原对象上传结果待核对，不能重传");
    await completeOriginal(session.sessionId);
  });
  return <section><label>{proofMode ? english ? "Rental-fee payment evidence file" : "费用回款凭证附件" : english ? "Authority evidence file" : "代表资格证明附件"}<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={disabled || working || Boolean(pending) || Boolean(error)} onChange={event => setFile(event.target.files?.[0])} /></label>
    <ActionButton disabled={disabled || working || Boolean(pending) || Boolean(error) || !file} intent="forward" label={proofMode ? english ? "Upload payment evidence" : "上传回款凭证" : english ? "Upload evidence" : "上传授权证明"} onAction={upload} />
    {pending && <><Alert type="warning" title={english ? "Keep the original upload; unknown never permits retransmission" : "保留原上传；未知结果不能换键重传"} />
      <ActionButton disabled={working} intent="review" label={english ? "Read original file result" : "核对原文件结果"} onAction={observe} />
      {pending.stage === "upload" && observed?.session?.mode === "provider" && observed.session.status === "pending_upload" && <ActionButton disabled={working} intent="confirm" label={english ? "Verify and archive the original object" : "核验原对象并归档"} onAction={completeObserved} />}
    </>}
    {error && <Alert type="error" title={error} />}
    {!pending && file && <Button disabled={working} onClick={() => { setFile(undefined); setError(""); }}>{english ? "Clear selection" : "清除选择"}</Button>}
  </section>;
}
