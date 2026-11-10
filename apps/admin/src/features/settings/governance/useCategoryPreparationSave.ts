import { useEffect, useRef, useState } from "react";
import type { CategoryPreparationSaveResult, SaveCategoryPreparationBatchRequest } from "@rental-os/shared";
import { categoryPreparationApi } from "@/api/categoryPreparation";

type SavePhase = "idle" | "sending" | "unknown" | "saved_unread";
interface PendingBatch {
  targetId: string;
  request: SaveCategoryPreparationBatchRequest;
  onSaved: (result: CategoryPreparationSaveResult) => Promise<void>;
  receipt?: CategoryPreparationSaveResult;
}
export function preparationErrorMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === "string").join("；");
  return error instanceof Error ? error.message : "保存失败，输入已保留";
}

/** One original batch stays frozen until its receipt or a definite first-attempt
 * rejection is known. A missing read result never creates a replacement key. */
export function useCategoryPreparationSave(isCurrent: () => boolean) {
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const busy = useRef(false);
  const pending = useRef<PendingBatch | undefined>(undefined);
  const current = useRef(isCurrent);
  current.current = isCurrent;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = () => mounted.current && current.current();
  const requireCurrent = () => { if (!available()) throw new Error("会话或经营空间已变化，请重新进入"); };

  async function accept(batch: PendingBatch, receipt: CategoryPreparationSaveResult) {
    if (receipt.batchId !== batch.request.batchId || receipt.targetVersionId !== batch.targetId ||
        receipt.sourceRevision !== batch.request.expectedSourceRevision || receipt.revision !== batch.request.expectedPreparationRevision + 1 ||
        receipt.preparedOnly !== true || !receipt.id) throw new Error("保存回执与当前批次不一致，请核对原请求");
    batch.receipt = receipt;
    requireCurrent();
    try {
      await batch.onSaved(receipt);
      if (available()) { pending.current = undefined; setPhase("idle"); setError(""); }
    } catch {
      if (available()) { setPhase("saved_unread"); setError("预备资料已保存，但刷新失败，请重新读取"); }
    }
    return receipt;
  }

  async function send(batch: PendingBatch, originalWasUnknown: boolean) {
    requireCurrent();
    if (busy.current) throw new Error("当前批次仍在处理中");
    busy.current = true; setPhase("sending"); setError("");
    try {
      const receipt = await categoryPreparationApi.saveBatch(batch.targetId, batch.request);
      return await accept(batch, receipt);
    } catch (failure) {
      const status = (failure as { response?: { status?: number } })?.response?.status;
      const rejected = !originalWasUnknown && status !== undefined && [400, 401, 403, 404, 409, 422].includes(status);
      if (available()) {
        if (rejected) pending.current = undefined;
        setPhase(rejected ? "idle" : "unknown"); setError(preparationErrorMessage(failure));
      }
      throw failure;
    } finally { busy.current = false; }
  }

  async function start(targetId: string, request: SaveCategoryPreparationBatchRequest, onSaved: PendingBatch["onSaved"]) {
    requireCurrent();
    if (pending.current || busy.current) throw new Error("请先核对上一批保存结果");
    const batch: PendingBatch = { targetId, request: structuredClone(request), onSaved };
    pending.current = batch;
    return send(batch, false);
  }

  async function retry() {
    requireCurrent();
    if (!pending.current || pending.current.receipt) throw new Error("没有需要重试的原请求");
    return send(pending.current, true);
  }

  async function reconcile() {
    requireCurrent();
    const batch = pending.current;
    if (!batch || busy.current) throw new Error("当前没有可核对的批次");
    busy.current = true; setPhase("sending"); setError("");
    try {
      if (batch.receipt) return await accept(batch, batch.receipt);
      const result = await categoryPreparationApi.readBatch(batch.targetId, batch.request.batchId);
      if (result.outcome !== "saved") throw new Error("尚未查到原批次结果，请稍后核对或重试原请求");
      return await accept(batch, result.result);
    } catch (failure) {
      if (available()) { setPhase(batch.receipt ? "saved_unread" : "unknown"); setError(preparationErrorMessage(failure)); }
      throw failure;
    } finally { busy.current = false; }
  }
  function clearSettled() {
    if (busy.current || (pending.current && !pending.current.receipt)) throw new Error("请先核对上一批保存结果");
    pending.current = undefined; setPhase("idle"); setError("");
  }
  return { phase, error, start, retry, reconcile, clearSettled, clearError: () => setError("") };
}
