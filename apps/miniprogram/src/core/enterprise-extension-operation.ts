/** Original extension-command references only: no request body or credentials.
 * Unknown requests never dispatch again; session generations isolate late replies. */
import type { EnterpriseExtensionRecoveryResult, EnterpriseExtensionApprovalView, RequestEnterpriseExtensionApproval, SubmitEnterpriseExtensionApproval } from "@rental-os/shared";
import { enterpriseExtensionRequestMatches, enterpriseExtensionRequestClosureMatches } from "../vendor/shared-enterprise-expense/enterprise-expense";
import { fetchEnterpriseExtensionApprovals, readEnterpriseExtensionRequestOriginal, readEnterpriseExtensionResult, readEnterpriseOperation, requestEnterpriseExtensionApproval, submitEnterpriseExtensionApproval, closeEnterpriseExtensionExecution, closeEnterpriseExtensionRequest } from "../api/enterprise";
import { PUBLIC_CONFIG } from "../config/public";
import { newKey } from "./keys";
import { contextVersion, currentServiceCode, currentSession } from "./session";
import { STORAGE_KEYS, writeRequiredStorage } from "./storage";
interface Reference { key: string; orderId: string; approvalId?: string; closureKey?: string; kind: "request" | "submit" }
export function enterpriseExtensionOperation(orderId: string, assertView: () => void = () => {}) {
  const customerId = currentSession()?.customer.customerId, service = currentServiceCode(), version = contextVersion();
  if (!customerId || !service || !orderId) throw new Error("当前本人订单会话不可核验");
  const storageKey = `${STORAGE_KEYS.enterpriseOperations}:extension:${PUBLIC_CONFIG.tenantCode}:${customerId}:${service}:${orderId}`;
  const current = () => { assertView(); if (contextVersion() !== version || currentSession()?.customer.customerId !== customerId || currentServiceCode() !== service) throw new Error("客户或服务已变化，原续租已隔离"); };
  const read = (): Reference | undefined => {
    current(); const value = wx.getStorageSync(storageKey);
    if (value === "" || value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Object.keys(value).some(key => !["key", "orderId", "approvalId", "closureKey", "kind"].includes(key))
      || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key) || value.orderId !== orderId || !["request", "submit"].includes(value.kind)
      || value.closureKey !== undefined && (value.closureKey === value.key || typeof value.closureKey !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey))
      || value.kind === "submit" && typeof value.approvalId !== "string"
      || value.approvalId !== undefined && (typeof value.approvalId !== "string" || !value.approvalId || value.approvalId.length > 191)) throw new Error("原续租操作引用不可读取，不能重发");
    return value as Reference;
  };
  const clear = (reference: Reference) => {
    current(); const saved = read();
    if (saved && JSON.stringify(saved) !== JSON.stringify(reference)) throw new Error("原续租操作引用已变化，不能覆盖其他请求");
    wx.removeStorageSync(storageKey); if (wx.getStorageSync(storageKey)) throw new Error("原操作引用尚未清除，只能回读");
  };
  const result = async (id: string) => {
    current(); const value = await readEnterpriseExtensionResult(id); current();
    if (value.approval.id !== id || value.approval.orderId !== orderId || value.approval.applicantCustomerId !== customerId || value.retryable !== false || value.original.retryable !== false
      || value.original.state === "observed" && (value.approval.state !== "consumed" || !value.approval.extensionId || value.original.extensionId !== value.approval.extensionId)
      || value.approval.state === "consumed" && value.original.state !== "observed"
      || value.original.state === "closed" && (value.approval.state !== "closed" || !value.approval.closedOperationKey)) throw new Error("原续租批准结果引用不一致");
    return value;
  };
  const recover = async (): Promise<EnterpriseExtensionRecoveryResult | undefined> => {
    const original = read(); if (!original) return;
    if (original.kind === "request") {
      const recovered = await readEnterpriseExtensionRequestOriginal(orderId, original.key); current();
      if (!enterpriseExtensionRequestMatches(recovered, orderId, original.key, customerId, service)) throw new Error("原续租申请尚待精确核对，不能重发");
      if (original.closureKey) {
        const closed = await readEnterpriseOperation(original.closureKey); current();
        if (closed.state !== "committed" || !enterpriseExtensionRequestClosureMatches(recovered, closed.result, original.key, original.closureKey)) throw new Error("原申请结束收据尚待核对，不能重发");
      }
      if (recovered.state === "closed") { clear(original); return recovered; }
      if (recovered.state !== "observed") throw new Error("原申请仍待核对");
      const value = await result(recovered.approval.id);
      clear(original); return value;
    }
    const receipt = await readEnterpriseOperation(original.key); current();
    if (original.closureKey) {
      const closed = await readEnterpriseOperation(original.closureKey); current();
      if (closed.state !== "committed" || closed.result?.approvalId !== original.approvalId) throw new Error("原结束请求尚待核对，不能重新提交");
      const value = await result(original.approvalId!);
      if (value.original.state === "closed" && value.approval.closedOperationKey === original.key && closed.result?.closedOperationKey === original.key
        || value.original.state === "observed" && value.approval.extensionId === closed.result?.extensionId && closed.result?.originalOperationKey === original.key) { clear(original); return value; }
      throw new Error("原结束请求与业务结果不一致");
    }
    if (receipt.state !== "committed") throw new Error("未读到原收据不证明未执行；保留原请求，不能重发");
    const id = original.approvalId ?? (typeof receipt.result?.id === "string" ? receipt.result.id : undefined);
    if (original.kind === "submit" && receipt.result?.state === "closed" && receipt.result.approvalId === id && receipt.result.closedOperationKey === original.key && id) {
      const sealed = await result(id);
      if (sealed.approval.state !== "closed" || sealed.original.state !== "closed" || sealed.approval.closedOperationKey !== original.key) throw new Error("原续租结束证据不一致");
      clear(original); return sealed;
    }
    if (!id || original.kind === "submit" && (receipt.result?.approvalId !== id || typeof receipt.result?.extensionId !== "string" || !receipt.result.extensionId)) throw new Error("原续租批准引用缺失或不一致");
    const value = await result(id);
    if (original.kind === "submit" && receipt.result?.extensionId !== value.approval.extensionId) throw new Error("原续租收据与消费关联不一致");
    if (original.kind === "submit" && (value.approval.state !== "consumed" || value.original.state !== "observed" || value.original.extensionId !== value.approval.extensionId)) throw new Error("原续租消费仍待核对，不能重发");
    clear(original); return value;
  };
  const execute = async (kind: Reference["kind"], input: RequestEnterpriseExtensionApproval | SubmitEnterpriseExtensionApproval) => {
    current(); if (read()) throw new Error("请先核对原续租操作，不能重新提交");
    const reference: Reference = { key: input.operationKey, orderId, kind, ...(kind === "submit" ? { approvalId: (input as SubmitEnterpriseExtensionApproval).approvalId } : {}) };
    writeRequiredStorage(storageKey, reference); current();
    try {
      if (kind === "request") await requestEnterpriseExtensionApproval(input as RequestEnterpriseExtensionApproval);
      else await submitEnterpriseExtensionApproval(input as SubmitEnterpriseExtensionApproval);
    } catch (error) {
      // Only the typed pre-write CAS refusal proves this command did not write.
      if ((error as { status?: number; body?: { code?: string } }).status === 409 && (error as { body?: { code?: string } }).body?.code === "enterprise_revision_conflict") clear(reference);
      throw error;
    }
    current(); return recover();
  };
  return { current, pending: read, recover, result,
    async closeRequest(reason: string) {
      const original = read();
      if (!original || original.kind !== "request" || original.closureKey || !reason.trim()) throw new Error("仅本人原未决申请可明确请求结束");
      const reference = { ...original, closureKey: newKey("enterprise-request-close") };
      writeRequiredStorage(storageKey, reference); current();
      await closeEnterpriseExtensionRequest(orderId, original.key, { operationKey: reference.closureKey, expectedRevision: 0, reason, confirm: true });
      current(); return recover();
    },
    async close(approval: EnterpriseExtensionApprovalView, reason: string) {
      const original = read();
      if (!original || original.kind !== "submit" || original.approvalId !== approval.id || original.closureKey || !reason.trim()) throw new Error("仅本人原未决提交可明确请求结束");
      const reference = { ...original, closureKey: newKey("enterprise-extension-close") };
      writeRequiredStorage(storageKey, reference); current();
      try { await closeEnterpriseExtensionExecution(approval.id, { operationKey: reference.closureKey, originalOperationKey: original.key, expectedRevision: approval.revision, reason, confirm: true }); }
      catch (error) {
        if ((error as { status?: number; body?: { code?: string } }).status === 409 && (error as { body?: { code?: string } }).body?.code === "enterprise_revision_conflict") { current(); writeRequiredStorage(storageKey, original); }
        throw error;
      }
      current(); return recover();
    },
    async list() { current(); const rows = await fetchEnterpriseExtensionApprovals(); current(); return rows.filter(row => row.orderId === orderId); },
    request: (expectedOrderUpdatedAt: string, newEndAt: string, reason: string) => execute("request", { operationKey: newKey("enterprise-extension"), orderId, expectedOrderUpdatedAt, extension: { newEndAt }, expectedRevision: 0, reason }),
    submit: (approval: EnterpriseExtensionApprovalView, reason: string) => execute("submit", { operationKey: newKey("enterprise-extension-submit"), approvalId: approval.id, expectedRevision: approval.revision, confirm: true, reason }),
  };
}
