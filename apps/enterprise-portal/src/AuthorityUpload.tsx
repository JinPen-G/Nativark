/** One explicit upload; durable references carry no file bytes, URL or credentials.
 * Lost PUT responses can be observed, never retransmitted. Completion has its own dispatch point. */
import { useEffect, useRef, useState } from "react";
import type { EnterprisePaymentProofBasis } from "@rental-os/shared";
import { createEnterpriseEvidenceUploadClient, readEnterpriseEvidenceReference, type EnterpriseEvidenceUploadObservation as Observation, type EnterpriseEvidenceUploadReference as Reference } from "@rental-os/rental-core/clients/enterprise";
import { ActionButton, Alert, Button } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
function readReference(storageKey: string): Reference | undefined {
  return readEnterpriseEvidenceReference(localStorage.getItem(storageKey));
}
export function AuthorityUpload({ english, disabled, onFile, onBusy, purpose = "authority", paymentProof }: { english: boolean; disabled: boolean; onFile: (id: string) => void; onBusy: (busy: boolean) => void; purpose?: "authority" | "payment_proof"; paymentProof?: EnterprisePaymentProofBasis }) {
  const context = useEnterprise(), latest = useRef(context); latest.current = context;
  const proofMode = purpose === "payment_proof", proofKey = JSON.stringify(paymentProof), proofRef = useRef(proofKey); proofRef.current = proofKey;
  const [file, setFile] = useState<File>(), [pending, setPending] = useState<Reference>(), [observed, setObserved] = useState<Observation>(), [error, setError] = useState(""), [working, setWorking] = useState(false);
  const busy = useRef(false), key = useRef<Reference | undefined>(undefined), mounted = useRef(true);
  const evidence = createEnterpriseEvidenceUploadClient({ english, purpose, paymentProof, owner: context }, {
    read: context.read, write: context.write,
    assertLifetime: () => {
      if (!mounted.current || latest.current.identity !== context.identity || context.signal.aborted) throw new Error("身份或页面已变化，请回到原申请核对 / Identity or page changed");
    },
    currentOwner: () => latest.current, currentProofKey: () => proofRef.current, reference: () => key.current,
    remember: value => remember(value), observed: setObserved, finish: fileId => finish(fileId), clearError: () => setError(""),
    newKey: () => crypto.randomUUID(), parseTarget: value => new URL(value),
    putFile: (target: URL, body: File, headers) => fetch(target, { method: "PUT", body, headers, credentials: "omit", redirect: "error", signal: context.signal }),
  });
  const storageKey = evidence.storageKey, current = evidence.current;
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
  const observe = () => run(evidence.observe);
  const completeObserved = () => run(evidence.completeObserved);
  const upload = () => run(() => evidence.upload(file, disabled));
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
