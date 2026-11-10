/** Original exchange application and independent permanent-key closure.
 * No stock, inspection or expense execution; unknown requests never dispatch again. */
import { enterpriseExpenseRequestMatches, enterpriseExpenseRequestClosureMatches, type RequestEnterpriseExchangeApproval } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi } from '../data/authClient';
type Host = NonNullable<ReturnType<typeof captureEnterpriseHostSession>>;
type Reference = { key: string; orderId: string; closureKey?: string };
export function exchangeRequestOperation(orderId: string, host: Host, assertView: () => void) {
  const storageKey = `rental-os:enterprise-exchange-request:${JSON.stringify([host.operationScope, orderId])}`;
  const current = () => { assertView(); if (!host.current()) throw new Error('客户或空间已变化，原申请已隔离'); };
  const pending = (): Reference | undefined => {
    current(); const raw = localStorage.getItem(storageKey); if (!raw) return;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['key', 'orderId', 'closureKey'].includes(key)) || value.orderId !== orderId
      || typeof value.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
      || value.closureKey !== undefined && (typeof value.closureKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey) || value.closureKey === value.key)) throw new Error('原申请引用不可读取，不能重新申请');
    return value;
  };
  const remember = (value: Reference) => { current(); const raw = JSON.stringify(value); localStorage.setItem(storageKey, raw); if (localStorage.getItem(storageKey) !== raw) throw new Error('原申请引用未可靠保存，未派发'); };
  const clear = (value: Reference) => {
    current(); const latest = pending();
    if (!latest || latest.orderId !== value.orderId || latest.key !== value.key || latest.closureKey !== value.closureKey) throw new Error('原申请引用已变化，不能覆盖');
    localStorage.removeItem(storageKey); if (localStorage.getItem(storageKey) !== null) throw new Error('原引用尚未清除，仅可回读');
  };
  const original = async (value: Reference) => {
    current(); const result = await sessionApi.enterpriseExchangeRequestOriginal(orderId, value.key); current();
    if (!enterpriseExpenseRequestMatches(result, orderId, value.key, host.customerId, host.workspaceCode)) throw new Error('原换货申请仍待精确核对，不能重发');
    if (value.closureKey) {
      const receipt = await sessionApi.enterpriseOperation(value.closureKey); current();
      if (receipt.state !== 'committed' || !enterpriseExpenseRequestClosureMatches(result, receipt.result, value.key, value.closureKey)) throw new Error('原申请结束收据仍待核对，不能重发');
    }
    clear(value); return result;
  };
  const locked = async <T,>(fn: () => Promise<T>) => {
    current(); if (!navigator.locks?.request) throw new Error('缺少原申请协调能力，不能提交');
    return navigator.locks.request(`${storageKey}:dispatch`, async () => { current(); return fn(); });
  };
  return { pending, current,
    recover: () => locked(async () => { const value = pending(); return value ? original(value) : undefined; }),
    request: (input: Omit<RequestEnterpriseExchangeApproval, 'operationKey'>) => locked(async () => {
      if (pending()) throw new Error('请先核对原申请，不可再次派发');
      if (input.orderId !== orderId || input.expectedRevision !== 0 || !input.reason.trim() || input.reason.length > 500) throw new Error('原订单与本次原因不可核对');
      const body = JSON.parse(JSON.stringify(input)) as typeof input;
      const order = await sessionApi.originalExchangeOrder(orderId); current();
      if (order.id !== orderId || order.updatedAt !== body.expectedOrderUpdatedAt) throw new Error('原订单已变化，请重新读取候选');
      const value: Reference = { orderId, key: crypto.randomUUID() }; remember(value); current();
      try { await sessionApi.requestEnterpriseExchangeApproval({ ...body, operationKey: value.key }); }
      catch (error) {
        if ((error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === 'enterprise_revision_conflict') clear(value);
        throw error;
      }
      current(); return original(value);
    }),
    close: (reason: string) => locked(async () => {
      const value = pending(); if (!value || value.closureKey || !reason.trim() || reason.length > 500) throw new Error('须独立确认原申请及结束原因');
      const closing = { ...value, closureKey: crypto.randomUUID() }; remember(closing); current();
      await sessionApi.closeEnterpriseExchangeRequest(orderId, value.key, { operationKey: closing.closureKey, expectedRevision: 0, reason: reason.trim(), confirm: true });
      current(); return original(closing);
    }) };
}
