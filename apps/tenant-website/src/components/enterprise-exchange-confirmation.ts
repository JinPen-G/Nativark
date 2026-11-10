/** Original employee expense consent only. Web Locks coordinate this scope; durable
 * opaque references survive reload, not form input. Unknown dispatches only read. */
import type { EnterpriseExchangeApprovalView } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi } from '../data/authClient';
type Host = NonNullable<ReturnType<typeof captureEnterpriseHostSession>>;
type Reference = { key: string; orderId: string; approvalId: string; workspaceId: string };
export function exchangeExpenseConfirmation(orderId: string, host: Host, assertView: () => void) {
  const storageKey = `rental-os:enterprise-exchange-consent:${JSON.stringify([host.operationScope, orderId])}`;
  const current = () => { assertView(); if (!host.current()) throw new Error('客户或空间已变化，原确认已隔离 / Identity changed'); };
  const pending = (): Reference | undefined => {
    current(); const raw = localStorage.getItem(storageKey); if (!raw) return;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['key', 'orderId', 'approvalId', 'workspaceId'].includes(key))
      || value.orderId !== orderId || typeof value.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
      || [value.approvalId, value.workspaceId].some(id => typeof id !== 'string' || !id || id.length > 191)) throw new Error('原费用确认引用不可读取，不能重发');
    return value;
  };
  const clear = (value: Reference) => {
    current(); const latest = pending();
    if (!latest || latest.key !== value.key || latest.orderId !== value.orderId || latest.approvalId !== value.approvalId || latest.workspaceId !== value.workspaceId) throw new Error('原确认引用已变化，不能覆盖');
    localStorage.removeItem(storageKey); if (localStorage.getItem(storageKey) !== null) throw new Error('原确认引用尚未清除，仅可回读');
  };
  const original = async (value: Reference) => {
    current(); const receipt = await sessionApi.enterpriseOperation(value.key); current();
    if (receipt.state !== 'committed') throw new Error('原收据尚未读到，不证明未提交；只能回读');
    const result = await sessionApi.enterpriseExchangeConfirmation(value.approvalId); current();
    const consent = result.approval.employeeConfirmation, recorded = receipt.result;
    if (result.original.state !== 'observed' || result.original.retryable !== false || result.original.operationKey !== value.key
      || result.approval.id !== value.approvalId || result.approval.orderId !== orderId || result.approval.workspaceId !== value.workspaceId || result.approval.applicantCustomerId !== host.customerId
      || consent?.operationKey !== value.key || consent.scope !== 'expense_only_not_inspection_or_execution'
      || recorded?.id !== value.approvalId || recorded.orderId !== orderId || recorded.workspaceId !== value.workspaceId || recorded.applicantCustomerId !== host.customerId
      || recorded.operationKey !== value.key || recorded.confirmedAt !== consent.confirmedAt || recorded.scope !== consent.scope) throw new Error('原确认与本人订单收据不一致，不能重发');
    clear(value); return result;
  };
  const locked = async <T,>(fn: () => Promise<T>) => {
    current(); if (!navigator.locks?.request) throw new Error('缺少原操作协调能力，不能确认');
    return navigator.locks.request(`${storageKey}:dispatch`, async () => { current(); return fn(); });
  };
  return { pending, current,
    recover: () => locked(async () => { const value = pending(); return value ? original(value) : undefined; }),
    confirm: (row: EnterpriseExchangeApprovalView, reason: string) => locked(async () => {
      if (pending()) throw new Error('请先核对原确认，不能重新派发');
      if (row.orderId !== orderId || row.applicantCustomerId !== host.customerId || !row.workspaceId || row.state !== 'approved' || row.employeeConfirmation
        || !Number.isSafeInteger(row.revision) || row.revision < 1 || !reason.trim() || reason.length > 500) throw new Error('须本人核对已批准的本单费用');
      const value: Reference = { key: crypto.randomUUID(), orderId, approvalId: row.id, workspaceId: row.workspaceId }, raw = JSON.stringify(value);
      localStorage.setItem(storageKey, raw); if (localStorage.getItem(storageKey) !== raw) throw new Error('原确认引用未可靠保存，未派发');
      current();
      try { await sessionApi.confirmEnterpriseExchangeExpense(row.id, { operationKey: value.key, expectedRevision: row.revision, confirm: true, reason: reason.trim() }); }
      catch (error) {
        if ((error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === 'enterprise_revision_conflict') clear(value);
        throw error;
      }
      current(); return original(value);
    }) };
}
