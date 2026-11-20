/** 原换货费用申请的恢复编排。只保存不透明引用，unknown 沿原申请与结束收据核对，
 * 宿主持有会话和存储，缺收据或过期不能授权重发或实物执行。 */
import type { RequestEnterpriseExchangeApproval } from "@rental-os/shared";
import type { RentalMiniProgramEnterpriseApi, RentalMiniProgramEnterpriseOperationPorts } from "./enterprise-operation-ports";
import type { createRentalMiniProgramOrdersApi } from "./orders";

export interface RentalMiniProgramExchangeRequestPorts extends RentalMiniProgramEnterpriseOperationPorts {
  api: Pick<RentalMiniProgramEnterpriseApi,
    | "readEnterpriseExchangeRequestOriginal"
    | "closeEnterpriseExchangeRequest"
    | "requestEnterpriseExchangeApproval"
    | "readEnterpriseOperation">;
  contracts: Pick<typeof import("@rental-os/shared"),
    | "enterpriseExpenseRequestMatches"
    | "enterpriseExpenseRequestClosureMatches">;
  orders: Pick<ReturnType<typeof createRentalMiniProgramOrdersApi>, "fetchOrder">;
}

type Reference = { key: string; orderId: string; closureKey?: string };

export function createRentalMiniProgramExchangeRequest(ports: RentalMiniProgramExchangeRequestPorts) {
  const { currentSession, currentServiceCode, contextVersion, publicConfig: PUBLIC_CONFIG,
    enterpriseOperationsKey, newKey, storage } = ports;
  const { readEnterpriseExchangeRequestOriginal, closeEnterpriseExchangeRequest, requestEnterpriseExchangeApproval, readEnterpriseOperation } = ports.api;
  const { enterpriseExpenseRequestMatches, enterpriseExpenseRequestClosureMatches } = ports.contracts;
  const { fetchOrder } = ports.orders;
  const working = new Set<string>();
  function enterpriseExchangeRequest(orderId: string, assertView: () => void) {
    const customerId = currentSession()?.customer.customerId, service = currentServiceCode(), version = contextVersion();
    if (!customerId || !service || !orderId || currentSession()?.customer.customerType !== "personal") throw new Error("本人原订单会话不可核验");
    const storageKey = `${enterpriseOperationsKey}:exchange-request:${PUBLIC_CONFIG.tenantCode}:${customerId}:${service}:${orderId}`;
    const current = () => { assertView(); if (version !== contextVersion() || customerId !== currentSession()?.customer.customerId || service !== currentServiceCode() || currentSession()?.customer.customerType !== "personal") throw new Error("客户或服务已变化，原申请已隔离"); };
    const pending = (): Reference | undefined => {
      current(); const value = storage.read(storageKey) as Partial<Record<keyof Reference, unknown>> | "" | null | undefined;
      if (value === "" || value === null || value === undefined) return;
      if (!value || typeof value !== "object" || Object.keys(value).some(key => !["key", "orderId", "closureKey"].includes(key)) || value.orderId !== orderId
        || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
        || value.closureKey !== undefined && (typeof value.closureKey !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey) || value.closureKey === value.key)) throw new Error("原申请引用不可读取，不能重发");
      return value as Reference;
    };
    const clear = (value: Reference) => {
      current(); const latest = pending();
      if (!latest || latest.orderId !== value.orderId || latest.key !== value.key || latest.closureKey !== value.closureKey) throw new Error("原申请引用已变化，不能覆盖");
      storage.remove(storageKey); if (storage.read(storageKey)) throw new Error("原引用尚未清除，只能回读");
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
        storage.writeRequired(storageKey, value); current();
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
        storage.writeRequired(storageKey, closing); current();
        await closeEnterpriseExchangeRequest(orderId, value.key, { operationKey: closing.closureKey, expectedRevision: 0, reason: reason.trim(), confirm: true });
        current(); return original(closing);
      }) };
  }
  return enterpriseExchangeRequest;
}
