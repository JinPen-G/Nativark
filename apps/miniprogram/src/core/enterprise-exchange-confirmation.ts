/** Single-dispatch employee expense consent. Durable references hold opaque IDs,
 * never input or credentials; missing evidence cannot authorize another dispatch. */
import type { EnterpriseExchangeApprovalView, EnterpriseExchangeConfirmationResult } from "@rental-os/shared";
import { confirmEnterpriseExchangeExpense, readEnterpriseExchangeConfirmation, readEnterpriseOperation } from "../api/enterprise";
import { PUBLIC_CONFIG } from "../config/public";
import { newKey } from "./keys";
import { contextVersion, currentServiceCode, currentSession } from "./session";
import { STORAGE_KEYS, writeRequiredStorage } from "./storage";
interface Reference { key: string; orderId: string; approvalId: string; workspaceId: string }
const working = new Set<string>();
export function enterpriseExchangeConfirmation(orderId: string, assertView: () => void) {
  const customerId = currentSession()?.customer.customerId, service = currentServiceCode(), version = contextVersion();
  if (!orderId || !customerId || !service || currentSession()?.customer.customerType !== "personal") throw new Error("本人订单会话不可核验");
  const storageKey = `${STORAGE_KEYS.enterpriseOperations}:exchange-confirmation:${PUBLIC_CONFIG.tenantCode}:${customerId}:${service}:${orderId}`;
  const current = () => { assertView(); if (contextVersion() !== version || currentSession()?.customer.customerId !== customerId || currentSession()?.customer.customerType !== "personal" || currentServiceCode() !== service) throw new Error("客户或服务已变化，原确认已隔离"); };
  const pending = (): Reference | undefined => {
    current(); const value = wx.getStorageSync(storageKey);
    if (value === "" || value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Object.keys(value).some(key => !["key", "orderId", "approvalId", "workspaceId"].includes(key))
      || value.orderId !== orderId || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
      || [value.approvalId, value.workspaceId].some(id => typeof id !== "string" || !id || id.length > 191)) throw new Error("原费用确认引用不可核对，不能重发");
    return value as Reference;
  };
  const clear = (value: Reference) => {
    current(); const latest = pending();
    if (!latest || latest.key !== value.key || latest.orderId !== value.orderId || latest.approvalId !== value.approvalId || latest.workspaceId !== value.workspaceId) throw new Error("原确认引用已变化，不能覆盖");
    wx.removeStorageSync(storageKey); if (wx.getStorageSync(storageKey)) throw new Error("原确认引用尚未清除，仅可回读");
  };
  const readOriginal = async (value: Reference): Promise<EnterpriseExchangeConfirmationResult> => {
    current(); const receipt = await readEnterpriseOperation(value.key); current();
    if (receipt.state !== "committed") throw new Error("未读到原确认收据，不证明未提交；只能回读");
    const result = await readEnterpriseExchangeConfirmation(value.approvalId); current();
    const consent = result.approval.employeeConfirmation, recorded = receipt.result;
    if (result.original.state !== "observed" || result.original.retryable !== false || result.original.operationKey !== value.key
      || result.approval.id !== value.approvalId || result.approval.orderId !== orderId || result.approval.workspaceId !== value.workspaceId || result.approval.applicantCustomerId !== customerId
      || consent?.operationKey !== value.key || consent.scope !== "expense_only_not_inspection_or_execution"
      || recorded?.id !== value.approvalId || recorded.orderId !== orderId || recorded.workspaceId !== value.workspaceId || recorded.applicantCustomerId !== customerId
      || recorded.operationKey !== value.key || recorded.confirmedAt !== consent.confirmedAt || recorded.scope !== consent.scope) throw new Error("原确认与本人订单收据不一致，不能重新确认");
    clear(value); return result;
  };
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    current(); if (working.has(storageKey)) throw new Error("原费用确认仍在处理中");
    working.add(storageKey); try { return await fn(); } finally { working.delete(storageKey); }
  };
  return { current, pending,
    recover: () => exclusive(async () => { const value = pending(); return value ? readOriginal(value) : undefined; }),
    confirm: (row: EnterpriseExchangeApprovalView, reason: string) => exclusive(async () => {
      if (pending()) throw new Error("请先核对原确认，不可重新派发");
      if (row.orderId !== orderId || row.applicantCustomerId !== customerId || !row.workspaceId || row.state !== "approved" || row.employeeConfirmation
        || !Number.isSafeInteger(row.revision) || row.revision < 1 || !reason.trim() || reason.length > 500) throw new Error("须本人核对已批准的本单费用后独立确认");
      const value: Reference = { key: newKey("enterprise-exchange-consent"), orderId, approvalId: row.id, workspaceId: row.workspaceId };
      writeRequiredStorage(storageKey, value); current();
      try { await confirmEnterpriseExchangeExpense(row.id, { operationKey: value.key, expectedRevision: row.revision, reason: reason.trim(), confirm: true }); }
      catch (error) {
        // Only the named pre-write CAS refusal proves no mutation occurred.
        if ((error as { status?: number; body?: { code?: string } }).status === 409 && (error as { body?: { code?: string } }).body?.code === "enterprise_revision_conflict") clear(value);
        throw error;
      }
      current(); return readOriginal(value);
    }) };
}
