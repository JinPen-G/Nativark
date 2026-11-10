/** Exchange expense request only. Opaque original references survive logout;
 * missing receipts/expiry never permit redispatch or physical execution. */
import { enterpriseExpenseRequestMatches, enterpriseExpenseRequestClosureMatches, type RequestEnterpriseExchangeApproval } from "@rental-os/shared";
import { readEnterpriseExchangeRequestOriginal, closeEnterpriseExchangeRequest, requestEnterpriseExchangeApproval, readEnterpriseOperation } from "../api/enterprise";
import { fetchOrder } from "../api/orders";
import { PUBLIC_CONFIG } from "../config/public";
import { newKey } from "./keys";
import { contextVersion, currentServiceCode, currentSession } from "./session";
import { STORAGE_KEYS, writeRequiredStorage } from "./storage";
type Reference = { key: string; orderId: string; closureKey?: string };
const working = new Set<string>();
export function enterpriseExchangeRequest(orderId: string, assertView: () => void) {
  const customerId = currentSession()?.customer.customerId, service = currentServiceCode(), version = contextVersion();
  if (!customerId || !service || !orderId || currentSession()?.customer.customerType !== "personal") throw new Error("本人原订单会话不可核验");
  const storageKey = `${STORAGE_KEYS.enterpriseOperations}:exchange-request:${PUBLIC_CONFIG.tenantCode}:${customerId}:${service}:${orderId}`;
  const current = () => { assertView(); if (version !== contextVersion() || customerId !== currentSession()?.customer.customerId || service !== currentServiceCode() || currentSession()?.customer.customerType !== "personal") throw new Error("客户或服务已变化，原申请已隔离"); };
  const pending = (): Reference | undefined => {
    current(); const value = wx.getStorageSync(storageKey);
    if (value === "" || value === null || value === undefined) return;
    if (!value || typeof value !== "object" || Object.keys(value).some(key => !["key", "orderId", "closureKey"].includes(key)) || value.orderId !== orderId
      || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
      || value.closureKey !== undefined && (typeof value.closureKey !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey) || value.closureKey === value.key)) throw new Error("原申请引用不可读取，不能重发");
    return value as Reference;
  };
  const clear = (value: Reference) => {
    current(); const latest = pending();
    if (!latest || latest.orderId !== value.orderId || latest.key !== value.key || latest.closureKey !== value.closureKey) throw new Error("原申请引用已变化，不能覆盖");
    wx.removeStorageSync(storageKey); if (wx.getStorageSync(storageKey)) throw new Error("原引用尚未清除，只能回读");
  };
  const original = async (value: Reference) => {
    current(); const result = await readEnterpriseExchangeRequestOriginal(orderId, value.key); current();
    if (!enterpriseExpenseRequestMatches(result, orderId, value.key, customerId, service)) throw new Error("原申请仍待精确核对，不能重新发送");
    if (value.closureKey) {
      const receipt = await readEnterpriseOperation(value.closureKey); current();
      if (receipt.state !== "committed" || !enterpriseExpenseRequestClosureMatches(result, receipt.result, value.key, value.closureKey)) throw new Error("原结束收据尚待核对，不能重发");
    }
    clear(value); return result;
  };
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    current(); if (working.has(storageKey)) throw new Error("原申请仍在处理中");
    working.add(storageKey); try { return await fn(); } finally { working.delete(storageKey); }
  };
  return { current, pending,
    recover: () => exclusive(async () => { const value = pending(); return value ? original(value) : undefined; }),
    request: (input: Omit<RequestEnterpriseExchangeApproval, "operationKey">) => exclusive(async () => {
      if (pending()) throw new Error("请先核对原申请，不可再次提交");
      if (input.orderId !== orderId || input.expectedRevision !== 0 || !input.reason.trim() || input.reason.length > 500) throw new Error("原订单与申请原因不一致");
      const body = JSON.parse(JSON.stringify(input)) as typeof input;
      const order = await fetchOrder(orderId); current();
      if (order.id !== orderId || order.updatedAt !== body.expectedOrderUpdatedAt) throw new Error("原订单已变化，请重新读取候选");
      const value: Reference = { key: newKey("enterprise-exchange-request"), orderId };
      writeRequiredStorage(storageKey, value); current();
      try { await requestEnterpriseExchangeApproval({ ...body, operationKey: value.key }); }
      catch (error) {
        // Only a named pre-write CAS refusal proves this operation made no mutation.
        if ((error as { status?: number; body?: { code?: string } }).status === 409 && (error as { body?: { code?: string } }).body?.code === "enterprise_revision_conflict") clear(value);
        throw error;
      }
      current(); return original(value);
    }),
    close: (reason: string) => exclusive(async () => {
      const value = pending(); if (!value || value.closureKey || !reason.trim() || reason.length > 500) throw new Error("须独立确认结束原申请及原因");
      const closing = { ...value, closureKey: newKey("enterprise-exchange-close") };
      writeRequiredStorage(storageKey, closing); current();
      await closeEnterpriseExchangeRequest(orderId, value.key, { operationKey: closing.closureKey, expectedRevision: 0, reason: reason.trim(), confirm: true });
      current(); return original(closing);
    }) };
}
