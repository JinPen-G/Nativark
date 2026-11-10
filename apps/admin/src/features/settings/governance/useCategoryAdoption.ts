import { useEffect, useRef, useState } from "react";
import type { AdoptRentalCategoryRequest, CategoryAdoptionResult } from "@rental-os/shared";
import { categoryPreparationApi } from "@/api/categoryPreparation";
import { assertCategoryAdoptionReceipt, forgetCategoryAdoption, readPendingCategoryAdoption, rememberCategoryAdoption, type PendingCategoryAdoption } from "./categoryAdoptionPending";
import { preparationErrorMessage } from "./useCategoryPreparationSave";

type Phase = "idle" | "sending" | "unknown" | "adopted_unread";
/** One confirmed original intent. Recovery performs reads only, including after
 * remount; a missing receipt never clears the key or authorizes another write. */
export function useCategoryAdoption(scope: string, isCurrent: () => boolean, onAdopted: (result: CategoryAdoptionResult) => Promise<void>) {
  const [phase, setPhase] = useState<Phase>("idle"), [error, setError] = useState("");
  const pending = useRef<PendingCategoryAdoption | undefined>(undefined), receipt = useRef<CategoryAdoptionResult | undefined>(undefined);
  const mounted = useRef(true), busy = useRef(false);
  const latest = useRef({ isCurrent, onAdopted }); latest.current = { isCurrent, onAdopted };
  const available = () => mounted.current && latest.current.isCurrent();
  const requireCurrent = () => { if (!available()) throw new Error("会话或经营空间已变化，请重新进入核对原结果"); };
  useEffect(() => {
    mounted.current = true;
    try {
      pending.current = readPendingCategoryAdoption(window.sessionStorage, scope);
      if (pending.current) { setPhase("unknown"); setError("原采用结果待核对，请读取服务端原收据"); }
    } catch (failure) { setPhase("unknown"); setError(preparationErrorMessage(failure)); }
    return () => { mounted.current = false; };
  }, [scope]);

  async function accept(result: CategoryAdoptionResult) {
    if (!pending.current) throw new Error("缺少原采用标识，不能确认结果");
    assertCategoryAdoptionReceipt(pending.current, result);
    requireCurrent(); receipt.current = structuredClone(result);
    try {
      await latest.current.onAdopted(result);
      requireCurrent();
      forgetCategoryAdoption(window.sessionStorage, scope);
      pending.current = undefined; receipt.current = undefined; setPhase("idle"); setError("");
    } catch (failure) {
      if (available()) { setPhase("adopted_unread"); setError("采用已确认，但当前资料刷新失败，请重新读取"); }
      throw failure;
    }
    return result;
  }
  async function start(targetId: string, body: AdoptRentalCategoryRequest) {
    requireCurrent();
    if (busy.current || pending.current || readPendingCategoryAdoption(window.sessionStorage, scope)) throw new Error("请先核对上一笔采用结果");
    // Persist safe basis before dispatch, so a reload cannot invent a new intent.
    pending.current = rememberCategoryAdoption(window.sessionStorage, scope, targetId, body);
    busy.current = true; setPhase("sending"); setError("");
    let received = false;
    try {
      const result = await categoryPreparationApi.adopt(targetId, structuredClone(body));
      received = true;
      return await accept(result);
    } catch (failure) {
      if (available() && !receipt.current) {
        const status = (failure as { response?: { status?: number } })?.response?.status;
        const rejected = !received && status !== undefined && [400, 401, 403, 404, 409, 422].includes(status);
        if (rejected) { forgetCategoryAdoption(window.sessionStorage, scope); pending.current = undefined; }
        setPhase(rejected ? "idle" : "unknown"); setError(preparationErrorMessage(failure));
      }
      throw failure;
    } finally { busy.current = false; }
  }
  async function reconcile() {
    requireCurrent();
    if (busy.current || !pending.current) throw new Error("缺少可核对的原采用标识，请核对原采用记录");
    busy.current = true; setPhase("sending"); setError("");
    try {
      if (receipt.current) return await accept(receipt.current);
      const original = await categoryPreparationApi.readOriginal(pending.current.idempotencyKey);
      if (original.outcome !== "adopted") throw new Error("尚未查到原采用收据，请稍后核对；原操作标识已保留");
      return await accept(original.result);
    } catch (failure) {
      if (available()) { setPhase(receipt.current ? "adopted_unread" : "unknown"); setError(preparationErrorMessage(failure)); }
      throw failure;
    } finally { busy.current = false; }
  }
  return { phase, error, start, reconcile, locked: phase !== "idle" };
}
