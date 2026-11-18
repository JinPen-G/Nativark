/** Fixed personal order explanation through the original client task. Reads
 * remain separate from model starts and answer continuation; model prose is
 * displayed as generated context, never an order/payment/price observation. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../../data/authClient';
import { withClientRecoveryLock } from '../../data/clientRecoveryStorage';
import { createClientTaskApi } from './client-task-api';
import { createClientTaskSession, clientTaskStorageKey, type ClientTaskView } from './client-task-session';
import { ClientTaskCancellation } from './ClientTaskCancellation';

const initial: ClientTaskView = { status: 'closed', task: null, modelText: null, question: null, receipt: null, scope: null,
  canExplain: false, canRead: false, canSubmit: false, canContinue: false, readOnly: true, modelUnavailable: false,
  observation: null, observationGeneration: 0 };
export function ClientTaskWorkbench({ orderId, scopeKey, english }: { orderId: string; scopeKey: string; english: boolean }) {
  const navigate = useNavigate(), { href } = useSite();
  const [record,setRecord] = useState({ scopeKey, view: initial }), [working,setWorking] = useState(false), [error,setError] = useState(false);
  const [draft,setDraft] = useState({ reference: '', value: '' });
  const currentScope = useRef(scopeKey), generation = useRef(0), busy = useRef(false), session = useRef<ReturnType<typeof createClientTaskSession> | null>(null);
  currentScope.current = scopeKey;
  const view = record.scopeKey === scopeKey ? record.view : initial;
  // Presentation only: keep the original result and recovery references intact.
  const modelText = view.modelText?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '') ?? '';
  const cancellation = record.scopeKey === scopeKey ? session.current?.cancellationHost() : null;
  const question = view.question, field = question?.contract.fields.length === 1 && question.contract.fields[0].kind === 'text'
    && question.contract.fields[0].fieldId === 'clarification_text' ? question.contract.fields[0] : null;
  const inputRef = question ? `${question.requestId}:${question.revision}` : '', inputValue = draft.reference === inputRef ? draft.value : '';
  useEffect(() => {
    generation.current++; busy.current = false; session.current?.dispose(); session.current = null;
    setRecord({ scopeKey, view: initial }); setWorking(false); setError(false); setDraft({ reference: '', value: '' });
    const hide = () => { generation.current++; busy.current = false; session.current?.dispose(); session.current = null;
      setRecord({ scopeKey, view: initial }); setWorking(false); setDraft({ reference: '', value: '' }); };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide);
    const host = captureEnterpriseHostSession(), unsubscribe = host ? subscribeCustomerSession(host.tenantCode, hide) : () => undefined;
    return () => { generation.current++; session.current?.dispose(); session.current = null; unsubscribe();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); };
  },[scopeKey]);
  const ensure = async () => {
    if (currentScope.current !== scopeKey || document.hidden) return null;
    if (session.current) return session.current;
    const host = captureEnterpriseHostSession(); if (!host) throw Error('client_task_unavailable');
    const epoch = generation.current, current = () => epoch === generation.current && currentScope.current === scopeKey && host.current() && !document.hidden;
    const context = { tenantCode: host.tenantCode, serviceCode: host.workspaceCode, customerId: host.customerId, orderId,
      surface: 'tenant_website' as const, current }, key = clientTaskStorageKey(context);
    const owner = createClientTaskSession({ context, api: createClientTaskApi(context), readHost: sessionApi.readBookingHostCapabilities,
      now: Date.now, newKey: () => `client-task-${crypto.randomUUID()}`,
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? undefined : JSON.parse(value); },
        write: value => localStorage.setItem(key,JSON.stringify(value)) },
      changed: next => { if (current()) setRecord({ scopeKey, view: next }); } });
    session.current = owner; await owner.open(); return current() ? owner : null;
  };
  const work = async (action: (owner: NonNullable<typeof session.current>) => Promise<unknown>) => {
    if (busy.current || document.hidden || currentScope.current !== scopeKey) return;
    const epoch = generation.current; busy.current = true; setWorking(true); setError(false);
    try {
      const captured = captureEnterpriseHostSession();
      if (!captured?.current()) throw Error('client_task_unavailable');
      await withClientRecoveryLock(captured.operationScope, async () => {
        if (!captured.current() || epoch !== generation.current || document.hidden) return;
        const owner = await ensure();
        if (owner && captured.current()) await action(owner);
      });
    }
    catch { if (epoch === generation.current) setError(true); }
    finally { if (epoch === generation.current) { busy.current = false; setWorking(false); } }
  };
  return <section className="booking-card" aria-label={english ? 'Order explanation' : '订单解释'} aria-busy={working}>
    <h3>{english ? 'Explain this order' : '解释这笔订单'}</h3>
    {(view.status === 'closed' || view.canExplain) && <button type="button" className="button button-outline" disabled={working}
      onClick={() => void work(owner => owner.explain())}>{english ? 'Request an explanation' : '请求解释'}</button>}
    <button type="button" className="button button-outline" disabled={working} onClick={() => void work(owner => owner.refresh())}>
      {english ? 'Check original answer' : '核对原回答'}</button>
    {(view.canOpenOrder || view.task || cancellation) && <button type="button" className="button button-outline" disabled={working || !view.canOpenOrder}
      onClick={() => void work(async owner => {
        const opened = await owner.openOrder(id => {
          if (id !== orderId || document.hidden || currentScope.current !== scopeKey) throw Error('client_order_navigation_changed');
          navigate(href(`/orders/${encodeURIComponent(id)}`));
        });
        if (!opened) throw Error('client_order_navigation_unavailable');
      })}>{english ? 'Check and open original order' : '核对并打开原订单'}</button>}
    {working && <p role="status">{english ? 'Processing your request…' : '正在处理本次请求…'}</p>}
    {view.status === 'unknown' && <p role="status">{english ? 'The original result needs checking. No model call is repeated.' : '原结果待核对，不重复调用模型。'}</p>}
    {field && question && <><label className="booking-field">{field.label}<textarea maxLength={field.maxLength} value={inputValue}
      disabled={working || !view.canSubmit} onChange={event => setDraft({ reference: inputRef, value: event.target.value })} /></label>
      <button type="button" className="button button-outline" disabled={working || !view.canSubmit || !inputValue.trim()}
        onClick={() => void work(owner => owner.submitClarification(inputValue))}>{english ? 'Save additional context' : '提交补充说明'}</button></>}
    {view.canContinue && <><p>{english ? 'Context saved. Continue explicitly to obtain an answer.' : '补充说明已保存，请明确继续取得回答。'}</p>
      <button type="button" className="button button-outline" disabled={working} onClick={() => void work(owner => owner.continueAnswer())}>
        {english ? 'Continue answering' : '继续回答'}</button></>}
    {modelText && <><p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', unicodeBidi: 'plaintext' }}>{modelText}</p>
      <p>{english ? 'Generated explanation. Amounts and order/payment status remain in the original order details.' : '模型生成说明；金额、订单和付款状态以原订单信息为准。'}</p></>}
    {(error || view.status === 'unavailable' || view.modelUnavailable) && <p role="status">{english ? 'The explanation is unavailable. You can still use the original order page.' : '解释暂不可用，可继续使用原订单页面。'}</p>}
    {cancellation && <ClientTaskCancellation orderId={orderId} scopeKey={scopeKey} origin={cancellation.origin} english={english}
      onObserved={value => {
        const owner = session.current;
        if (currentScope.current !== scopeKey || document.hidden || owner?.cancellationHost()?.origin.taskId !== value.taskId) return;
        void work(async active => { if (active === owner) await active.refreshAfterObservation(value.taskId); });
      }} />}
  </section>;
}
