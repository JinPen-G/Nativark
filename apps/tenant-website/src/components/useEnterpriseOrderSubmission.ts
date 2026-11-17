/** Customer enterprise submission and merchant delegation share the original
 * owner lock. Delegation keeps its quote/key until a server original is terminal. */
import { useEffect, useRef, useState } from 'react';
import { clientGoalTextHash, enterpriseOrderDelegationMatches } from '@rental-os/shared';
import type { EnterpriseBookingApprovalView, EnterpriseOrderDelegationRequestReference, EnterpriseOrderDelegationView, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
type Original = { quoteId: string; key: string; kind?: 'order' } | {
  quoteId: string; key: string; kind: 'delegation'; tenantId: string; corporateCustomerId: string;
  requestReference: EnterpriseOrderDelegationRequestReference; expectedRevision: number;
  revocationKey?: string; revocationRevision?: number;
};
const storageKey = (scope: string) => `rental-os:enterprise-order:${scope}`;
export function useEnterpriseOrderSubmission(onOrder: (id: string) => void) {
  const host = captureEnterpriseHostSession(), identity = host?.identity;
  const mounted = useRef(true), latest = useRef(identity); latest.current = identity;
  const busy = useRef(false), [, render] = useState(0);
  const [pending, setPending] = useState<Original>(), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const [delegation, setDelegation] = useState<EnterpriseOrderDelegationView>();
  const currentDelegation = useRef<EnterpriseOrderDelegationView | undefined>(undefined);
  currentDelegation.current = delegation;
  const current = (requireVisible = false) => {
    if (!mounted.current || latest.current !== identity || !host?.current()) throw new Error('客户身份或空间已变化，原提交已隔离');
    if (requireVisible && typeof document !== 'undefined' && document.visibilityState !== 'visible') throw new Error('客户页面已隐藏，保留原操作供再次核对');
  };
  const read = (): Original | undefined => {
    current();
    const ownerKey = storageKey(host!.operationScope);
    let raw = localStorage.getItem(ownerKey), indexedKey: string | undefined;
    if (!raw) {
      const prefix = `${ownerKey}:delegation:`;
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) {
          raw = localStorage.getItem(key);
          indexedKey = key;
          break;
        }
      }
    }
    if (indexedKey && !raw) throw new Error('原委托索引不可读，不能重新派发');
    if (!raw) return;
    const value = JSON.parse(raw) as Original;
    if (typeof value.quoteId !== 'string' || !value.quoteId || typeof value.key !== 'string' || !value.key) throw new Error('原企业提交引用不可读，不能重新派发');
    if (value.kind !== undefined && value.kind !== 'order' && value.kind !== 'delegation') throw new Error('原企业提交类型不可读');
    if (value.kind === 'delegation') {
      const reference = value.requestReference;
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value.key) || typeof value.tenantId !== 'string' || !value.tenantId
        || typeof value.corporateCustomerId !== 'string' || !value.corporateCustomerId || !Number.isSafeInteger(value.expectedRevision)
        || value.expectedRevision < 0 || !reference || typeof reference !== 'object' || Array.isArray(reference) || Object.keys(reference).length !== 1
        || !('quoteId' in reference ? reference.quoteId === value.quoteId
          : typeof reference.approvalId === 'string' && /^[A-Za-z0-9._:-]{1,191}$/u.test(reference.approvalId))
        || value.revocationKey !== undefined && (!/^[A-Za-z0-9_-]{1,128}$/u.test(value.revocationKey)
          || !Number.isSafeInteger(value.revocationRevision) || value.revocationRevision! < 1)) throw new Error('原委托引用不可读，不能重新派发');
    }
    if (indexedKey) {
      if (value.kind !== 'delegation' || indexedKey !== `${ownerKey}:delegation:${value.key}`) throw new Error('原委托索引不匹配，不能重新派发');
      if (localStorage.getItem(ownerKey)) throw new Error('当前原企业操作已变化，请核对当前引用');
      localStorage.setItem(ownerKey, raw);
      if (localStorage.getItem(ownerKey) !== raw) throw new Error('原委托引用无法恢复，不能重新派发');
    }
    return value;
  };
  useEffect(() => {
    currentDelegation.current = undefined;
    mounted.current = true; setReady(false); setPending(undefined); setDelegation(undefined); setError('');
    try { if (host) { setPending(read()); setReady(true); } }
    catch (e) { setError(e instanceof Error ? e.message : '原提交引用不可用'); }
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => {
      if (!host.current() && mounted.current && latest.current === identity) { currentDelegation.current = undefined; setReady(false); setPending(undefined); setDelegation(undefined); }
    }) : () => {};
    return () => { mounted.current = false; unsubscribe(); };
  }, [identity]);
  const assertOriginal = (original: Original) => {
    current();
    if (JSON.stringify(read()) !== JSON.stringify(original)) throw new Error('原企业提交引用已变化，须核对当前原操作');
  };
  const remember = (original: Original) => {
    current(); const serialized = JSON.stringify(original);
    if (original.kind === 'delegation') {
      // The per-key locator remains available even if another page replaces the
      // owner's recent pointer. Only opaque original identifiers are retained.
      const originalKey = `${storageKey(host!.operationScope)}:delegation:${original.key}`;
      localStorage.setItem(originalKey, serialized);
      if (localStorage.getItem(originalKey) !== serialized) throw new Error('无法保留原委托编号，未派发');
    }
    localStorage.setItem(storageKey(host!.operationScope), serialized);
    if (localStorage.getItem(storageKey(host!.operationScope)) !== serialized) throw new Error('无法保留原键，未派发企业请求');
    setPending(original);
  };
  const clear = (original: Original) => {
    assertOriginal(original);
    if (original.kind === 'delegation') {
      const key = `${storageKey(host!.operationScope)}:delegation:${original.key}`;
      const indexed = localStorage.getItem(key);
      if (indexed && indexed !== JSON.stringify(original)) throw new Error('原委托索引已变化，保留当前引用');
      localStorage.removeItem(key);
      assertOriginal(original);
    }
    localStorage.removeItem(storageKey(host!.operationScope));
    const replacement = read(); setPending(replacement);
    if (replacement) { currentDelegation.current = undefined; setDelegation(undefined); throw new Error('当前原企业操作已变化，保留其引用并继续锁定'); }
  };
  const observe = async (original: Original) => {
    if (original.kind === 'delegation') {
      if (original.revocationKey) {
        const receipt = await sessionApi.enterpriseOperation(original.revocationKey); assertOriginal(original);
        if (receipt.state !== 'committed' || receipt.result?.delegationKey !== original.key
          || !['revoked', 'consumed'].includes(receipt.result.state as string)) throw new Error('原委托撤销结果待核对，不能重新派发');
      }
      const result = await sessionApi.enterpriseOrderDelegation(original.key); assertOriginal(original);
      if (!enterpriseOrderDelegationMatches(result, { ...original, delegationKey: original.key, personalCustomerId: host!.customerId })) throw new Error('原委托结果尚未精确核对，保留原编号');
      currentDelegation.current = result; setDelegation(result);
      if (result.state === 'consumed' && result.original.state === 'consumed') { clear(original); onOrder(result.original.orderId); }
      else if (result.state === 'revoked') clear(original);
      return result;
    }
    const result = await sessionApi.enterpriseOrderOriginal(original.quoteId, original.key); current();
    if (result.state !== 'observed' || !result.orderId) throw new Error('原提交结果尚未证实；没有订单不代表可以重发');
    clear(original); onOrder(result.orderId);
  };
  const recover = async () => {
    current(); if (busy.current || !ready) return; busy.current = true; render(n => n + 1);
    try { const original = read(); if (original) await observe(original); setError(''); }
    catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原结果待核对'); }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  const submit = async (quoteId: string) => {
    current(); if (!ready || busy.current || read()) throw new Error('须先核对原企业提交，不能重新派发');
    if (currentDelegation.current?.quoteId === quoteId && currentDelegation.current.state === 'revoked') throw new Error('原委托已撤销，请重新获取报价及适用批准');
    busy.current = true; render(n => n + 1); setError('');
    try {
      const original: Original = { quoteId, key: crypto.randomUUID() };
      remember(original); current();
      await sessionApi.createOrder({ quoteId }, original.key); current();
      // Even a successful HTTP response is checked through the original Core receipt.
      await observe(original);
    } catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原企业结果待核对'); throw e; }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  const delegate = async (quote: RentalQuoteSnapshotV1, approval: EnterpriseBookingApprovalView | undefined, assertView: () => void) => {
    current(); assertView(); if (!ready || busy.current || read()) throw new Error('须先核对原企业提交，不能重新派发');
    if (currentDelegation.current?.quoteId === quote.id && currentDelegation.current.state === 'revoked') throw new Error('原委托已撤销，请重新获取报价及适用批准');
    const membership = quote.membershipSnapshot;
    if (quote.request.customerId !== host!.customerId || membership?.bookingIdentity !== 'enterprise_employee'
      || membership.personalCustomerId !== host!.customerId || !membership.corporateCustomerId
      || approval && (approval.quoteId !== quote.id || approval.state !== 'approved')) throw new Error('请核对本人的原企业报价与批准');
    busy.current = true; render(n => n + 1); setError(''); currentDelegation.current = undefined; setDelegation(undefined);
    try {
      // One original quote has one D, including two pages confirming concurrently.
      // The server still checks its immutable source, current policy and command.
      const key = `delegate-${await clientGoalTextHash(JSON.stringify(['enterprise-order-delegation-1', host!.tenantCode, host!.workspaceCode, host!.customerId, quote.id]))}`;
      current(); assertView(); if (read()) throw new Error('已有原企业操作待核对，未派发新的委托');
      const original: Original = { kind: 'delegation', key, quoteId: quote.id, tenantId: quote.tenantId,
        corporateCustomerId: membership.corporateCustomerId, requestReference: approval ? { approvalId: approval.id } : { quoteId: quote.id },
        expectedRevision: approval?.revision ?? 0 };
      remember(original); current(); assertView();
      await sessionApi.issueEnterpriseOrderDelegation({ operationKey: key, requestReference: original.requestReference,
        expectedRevision: original.expectedRevision, reason: '本人确认商户代办本次原企业身份预约', confirm: true });
      current(); await observe(original);
    } catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原委托结果待核对'); throw e; }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  const revokeDelegation = async () => {
    current(true); if (!ready || busy.current) return; const original = read();
    if (original?.kind !== 'delegation' || original.revocationKey) throw new Error('须核对本人的原委托');
    busy.current = true; render(n => n + 1); setError('');
    try {
      const result = await observe(original);
      current(true);
      if (!result || !['issued', 'expired'].includes(result.state)) return;
      assertOriginal(original);
      const revocationKey = `revoke-${await clientGoalTextHash(JSON.stringify(['enterprise-order-delegation-1', 'revoke',
        host!.tenantCode, host!.workspaceCode, host!.customerId, original.key, result.revision]))}`;
      assertOriginal(original); current(true);
      const revocation: Original = { ...original, revocationKey, revocationRevision: result.revision };
      remember(revocation); current(true);
      await sessionApi.revokeEnterpriseOrderDelegation({ operationKey: revocation.revocationKey!, delegationKey: original.key,
        expectedRevision: result.revision, reason: '本人明确撤销本次原商户委托', confirm: true });
      current(true); await observe(revocation);
    } catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原委托撤销待核对'); throw e; }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  return { submit, delegate, revokeDelegation, delegation, recover, pending, busy: busy.current, blocked: Boolean(pending || busy.current), ready, error };
}
