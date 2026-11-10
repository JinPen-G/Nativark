/** Original quote approval consumer. Persist references before dispatch; unknown writes are read-only. */
import { useEffect, useRef, useState } from 'react';
import type { EnterpriseApprovalOriginalResult, EnterpriseBookingApprovalView } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../data/authClient';
type Pending = { key: string; quoteId: string; approvalId?: string; kind: 'request' | 'submit'; state: 'unknown' | 'committed' };
const pendingOperations = new Map<string, Pending>();
const storageKey = (identity: string) => `rental-os:enterprise-operation:${identity}`;
function readPending(identity: string): Pending | undefined {
  const raw = localStorage.getItem(storageKey(identity));
  if (!raw) return pendingOperations.get(identity);
  const value = JSON.parse(raw) as Pending;
  if (!value.key || !value.quoteId || !['request', 'submit'].includes(value.kind) || !['unknown', 'committed'].includes(value.state)) throw new Error('原企业操作引用不可读，不能重新派发');
  pendingOperations.set(identity, value); return value;
}
function remember(identity: string, pending: Pending) {
  const serialized = JSON.stringify(pending);
  localStorage.setItem(storageKey(identity), serialized);
  if (localStorage.getItem(storageKey(identity)) !== serialized) throw new Error('无法保留原企业操作引用，未派发请求');
  pendingOperations.set(identity, pending);
}
function clear(identity: string) {
  localStorage.removeItem(storageKey(identity)); pendingOperations.delete(identity);
}

export function EnterpriseBookingApproval({ quoteId, identity, english, onOrder, onNewQuote }: { quoteId: string; identity: string; english: boolean; onOrder: (id: string) => void; onNewQuote?: () => void }) {
  const host = captureEnterpriseHostSession(), hostIdentity = host?.operationScope;
  const owner = useRef(identity); owner.current = identity;
  const mounted = useRef(true), inFlight = useRef(false);
  const [purpose, setPurpose] = useState(''), [approval, setApproval] = useState<EnterpriseBookingApprovalView>(), [error, setError] = useState('');
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending>(), [storageReady, setStorageReady] = useState(false), [sealed, setSealed] = useState(false);
  const current = () => { if (!mounted.current || owner.current !== identity || !host?.current()) throw new Error('客户身份或空间已变化，原请求已隔离 / Identity changed'); };
  useEffect(() => {
    mounted.current = true; setApproval(undefined); setChecked(false); setStorageReady(false); setSealed(false);
    try { if (!hostIdentity) throw new Error('当前客户会话不可核验'); setPending(readPending(hostIdentity)); setStorageReady(true); }
    catch (e) { setError(e instanceof Error ? e.message : '原操作引用不可用'); }
    const unsubscribe = host ? subscribeCustomerSession(host.tenantCode, () => {
      if (!host.current()) {
        // Keep only opaque original references for re-authentication to the same
        // customer/workspace; the changed generation cannot apply late results.
        pendingOperations.delete(host.operationScope);
        if (mounted.current && owner.current === identity) { setPending(undefined); setStorageReady(false); setApproval(undefined); setChecked(false); }
      }
    }) : () => {};
    return () => { mounted.current = false; unsubscribe(); };
  }, [identity, hostIdentity, quoteId]);
  const refresh = async (targetQuote = quoteId) => {
    const rows = await sessionApi.enterpriseApprovals(); current();
    const found = rows.find(row => row.quoteId === targetQuote);
    if (!found) throw new Error('原批准申请未读到；保留原操作，不能新建替代申请');
    if (targetQuote === quoteId) { setApproval(found); setChecked(false); }
    return found;
  };
  const publish = (value?: Pending) => { current(); if (value) remember(hostIdentity!, value); else clear(hostIdentity!); setPending(value); };
  const acceptResult = (result: EnterpriseApprovalOriginalResult, original: { quoteId: string; approvalId: string }) => {
    current();
    if (result.approval.id !== original.approvalId || result.approval.quoteId !== original.quoteId) throw new Error('原结果引用不匹配；保留原操作');
    if (result.approval.state === 'closed' && result.original.state === 'closed' && result.original.retryable === false && result.retryable === false && !result.approval.orderId) {
      // Only a server-sealed original execution can release this reference. It is
      // neither cancellation nor permission to reuse its quote/approval/key.
      publish(); setApproval(result.approval); setChecked(false); setSealed(true); return;
    }
    if (result.approval.state !== 'consumed' || result.original.state !== 'observed' || !result.original.orderId) throw new Error('原提交结果仍待核对；不能再次执行');
    publish(); onOrder(result.original.orderId);
  };
  const readResult = async (original: Pending) => {
    if (original.state !== 'committed') {
      const receipt = await sessionApi.enterpriseOperation(original.key); current();
      if (receipt.state !== 'committed') throw new Error('尚无原收据，不证明未执行；保留原请求，不能再次发送');
      original = { ...original, state: 'committed', approvalId: original.approvalId ?? (typeof receipt.result?.id === 'string' ? receipt.result.id : undefined) };
      publish(original);
    }
    if (original.kind === 'submit') {
      if (!original.approvalId) throw new Error('原提交缺少批准引用，须核对原操作');
      const result = await sessionApi.enterpriseApprovalResult(original.approvalId); current();
      acceptResult(result, { quoteId: original.quoteId, approvalId: original.approvalId }); return;
    }
    const approval = await refresh(original.quoteId);
    if (['executing', 'consumed', 'closed'].includes(approval.state)) {
      const result = await sessionApi.enterpriseApprovalResult(approval.id); current();
      acceptResult(result, { quoteId: original.quoteId, approvalId: approval.id }); return;
    }
    publish();
  };
  const command = async (submit: boolean) => {
    current(); if (!storageReady || inFlight.current || readPending(hostIdentity!)) return;
    if (approval?.state === 'closed' || !purpose.trim() || submit && (!checked || approval?.state !== 'approved' || approval.quoteId !== quoteId)) throw new Error('请核对用途、原报价及批准；已封闭的原申请不能复用');
    inFlight.current = true; setBusy(true); setError('');
    try {
      const original: Pending = { key: crypto.randomUUID(), quoteId, approvalId: submit ? approval!.id : undefined, kind: submit ? 'submit' : 'request', state: 'unknown' };
      publish(original); // Storage failure happens before the sole business dispatch.
      let result: { orderId?: string };
      try {
        result = await sessionApi.enterpriseCommand(submit ? 'approvals/submit' : 'approvals', submit
          ? { operationKey: original.key, approvalId: approval!.id, expectedRevision: approval!.revision, reason: purpose, confirm: true }
          : { operationKey: original.key, quoteId, purpose, expectedRevision: 0, reason: purpose });
      } catch (e) {
        if ((e as { status?: number; code?: string }).status === 409 && (e as { code?: string }).code === 'enterprise_revision_conflict') { publish(); await refresh(); }
        throw e;
      }
      current(); const committed: Pending = { ...original, state: 'committed' }; publish(committed);
      if (result.orderId) { publish(); onOrder(result.orderId); }
      else await readResult(committed);
    } catch (e) { if (mounted.current && owner.current === identity && host?.current()) setError(e instanceof Error ? e.message : '结果待核对'); throw e; }
    finally { inFlight.current = false; if (mounted.current && owner.current === identity && host?.current()) setBusy(false); }
  };
  const readOriginal = async () => {
    current(); if (!storageReady || inFlight.current) return; inFlight.current = true; setBusy(true);
    try {
      const original = readPending(hostIdentity!);
      if (original) await readResult(original);
      else {
        const row = await refresh();
        if (['executing', 'consumed', 'closed'].includes(row.state)) {
          const result = await sessionApi.enterpriseApprovalResult(row.id); current();
          acceptResult(result, { quoteId: row.quoteId, approvalId: row.id });
        }
      }
      setError('');
    }
    catch (e) { if (mounted.current && owner.current === identity && host?.current()) setError(e instanceof Error ? e.message : '原结果不可用'); }
    finally { inFlight.current = false; if (mounted.current && owner.current === identity && host?.current()) setBusy(false); }
  };
  const blocked = busy || Boolean(pending) || !storageReady;
  return <section><p className="mock-note">{english ? 'Enterprise payment requires approval. Approval does not reserve stock or confirm payment.' : '本次企业付款须逐单审批；批准不预占库存或额度，也不代表已支付。'}</p>
    <label className="booking-field">{english ? 'Purpose' : '用途'}<textarea value={purpose} disabled={blocked} maxLength={500} onChange={event => setPurpose(event.target.value)} /></label>
    {!approval && <button type="button" className="button button-dark" disabled={blocked || !purpose.trim()} onClick={() => void command(false).catch(() => undefined)}>{english ? 'Request approval' : '申请企业批准'}</button>}
    {approval && <p>{english ? 'Original approval' : '原批准'}：{approval.state} / {approval.expiresAt}</p>}
    {approval?.state === 'closed' && <><p role="status">{english ? 'The original execution is sealed. This did not cancel an order or retry submission. A new request needs a new quote and approval.' : '原执行已封闭，没有取消订单或重试下单。新申请须重新报价并取得新的批准。'}</p>{sealed && approval.quoteId === quoteId && onNewQuote && <button type="button" className="button button-outline" disabled={blocked} onClick={() => { current(); onNewQuote(); }}>{english ? 'Obtain a new quote' : '重新获取报价'}</button>}</>}
    {approval?.state === 'approved' && <><label><input type="checkbox" checked={checked} disabled={blocked} onChange={event => setChecked(event.target.checked)} />{english ? 'I reviewed this quote and enterprise responsibility; explicitly submit' : '我已核对本报价、企业付款责任及保证金安排，明确提交'}</label><button type="button" className="button button-dark" disabled={blocked || !checked || !purpose.trim()} onClick={() => void command(true).catch(() => undefined)}>{english ? 'Explicitly submit' : '核对后提交'}</button></>}
    <button type="button" className="button button-outline" disabled={busy || !storageReady} onClick={() => void readOriginal()}>{english ? 'Read original approval/result' : '核对原批准与提交结果'}</button>
    {pending && <p role="status">{english ? 'Keep this original request; do not submit with a new key' : '保留原请求，不能换键重新提交'}{pending.quoteId !== quoteId ? english ? ' (an earlier quote)' : '（另一份原报价）' : ''}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
