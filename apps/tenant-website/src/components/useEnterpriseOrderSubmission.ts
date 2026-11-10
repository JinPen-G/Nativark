/** Regular enterprise submission: keep the original quote/key before the sole write. */
import { useEffect, useRef, useState } from 'react';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
type Original = { quoteId: string; key: string };
const storageKey = (scope: string) => `rental-os:enterprise-order:${scope}`;
export function useEnterpriseOrderSubmission(onOrder: (id: string) => void) {
  const host = captureEnterpriseHostSession(), identity = host?.identity;
  const mounted = useRef(true), latest = useRef(identity); latest.current = identity;
  const busy = useRef(false), [, render] = useState(0);
  const [pending, setPending] = useState<Original>(), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const current = () => { if (!mounted.current || latest.current !== identity || !host?.current()) throw new Error('客户身份或空间已变化，原提交已隔离'); };
  const read = (): Original | undefined => {
    current(); const raw = localStorage.getItem(storageKey(host!.operationScope));
    if (!raw) return;
    const value = JSON.parse(raw) as Original;
    if (typeof value.quoteId !== 'string' || !value.quoteId || typeof value.key !== 'string' || !value.key) throw new Error('原企业提交引用不可读，不能重新派发');
    return value;
  };
  useEffect(() => {
    mounted.current = true; setReady(false); setPending(undefined); setError('');
    try { if (host) { setPending(read()); setReady(true); } }
    catch (e) { setError(e instanceof Error ? e.message : '原提交引用不可用'); }
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => {
      if (!host.current() && mounted.current && latest.current === identity) { setReady(false); setPending(undefined); }
    }) : () => {};
    return () => { mounted.current = false; unsubscribe(); };
  }, [identity]);
  const observe = async (original: Original) => {
    const result = await sessionApi.enterpriseOrderOriginal(original.quoteId, original.key); current();
    if (result.state !== 'observed' || !result.orderId) throw new Error('原提交结果尚未证实；没有订单不代表可以重发');
    localStorage.removeItem(storageKey(host!.operationScope)); setPending(undefined); onOrder(result.orderId);
  };
  const recover = async () => {
    current(); if (busy.current || !ready) return; busy.current = true; render(n => n + 1);
    try { const original = read(); if (original) await observe(original); setError(''); }
    catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原结果待核对'); }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  const submit = async (quoteId: string) => {
    current(); if (!ready || busy.current || read()) throw new Error('须先核对原企业提交，不能重新派发');
    busy.current = true; render(n => n + 1); setError('');
    try {
      const original: Original = { quoteId, key: crypto.randomUUID() }, serialized = JSON.stringify(original);
      localStorage.setItem(storageKey(host!.operationScope), serialized);
      if (localStorage.getItem(storageKey(host!.operationScope)) !== serialized) throw new Error('无法保留原键，未派发企业下单');
      setPending(original); current();
      await sessionApi.createOrder({ quoteId }, original.key); current();
      // Even a successful HTTP response is checked through the original Core receipt.
      await observe(original);
    } catch (e) { if (mounted.current && latest.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原企业结果待核对'); throw e; }
    finally { busy.current = false; if (mounted.current && latest.current === identity && host?.current()) render(n => n + 1); }
  };
  return { submit, recover, pending, busy: busy.current, blocked: Boolean(pending || busy.current), ready, error };
}
