/** Original-task stop controls. Current session/scope changes discard display
 * and abort local waits; saved original operation selectors remain recoverable. */
import { useEffect, useRef, useState } from 'react';
import { captureEnterpriseHostSession, subscribeCustomerSession } from '../../data/authClient';
import { createClientTaskCancellationApi } from './client-task-cancellation-api';
import { createClientTaskCancellationSession, clientTaskCancellationStorageKey,
  type ClientTaskCancellationOrigin, type ClientTaskCancellationObservation,
  type ClientTaskCancellationView } from './client-task-cancellation-session';

const blank = (): ClientTaskCancellationView => ({ status: 'closed', taskStatus: null,
  canRequest: false, canRead: false, canSettle: false, observation: null });
export interface ClientTaskCancellationProps {
  orderId: string; scopeKey: string; origin: ClientTaskCancellationOrigin; english: boolean;
  onObserved?(value: ClientTaskCancellationObservation): void;
}
export function ClientTaskCancellation({ orderId, scopeKey, origin, english, onObserved }: ClientTaskCancellationProps) {
  const identity = JSON.stringify([scopeKey, orderId, origin.reference.materialRef, origin.reference.creationKey, origin.taskId]);
  const [record, setRecord] = useState({ identity, view: blank() }), [working, setWorking] = useState(false);
  const currentIdentity = useRef(identity), generation = useRef(0), busy = useRef(false), observed = useRef('');
  const callback = useRef(onObserved), session = useRef<ReturnType<typeof createClientTaskCancellationSession> | null>(null);
  const api = useRef<ReturnType<typeof createClientTaskCancellationApi> | null>(null);
  currentIdentity.current = identity; callback.current = onObserved;
  const view = record.identity === identity ? record.view : blank();
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const visible = () => !document.hidden && navigator.onLine !== false;
  useEffect(() => {
    const clear = () => {
      generation.current++; busy.current = false; observed.current = '';
      session.current?.dispose(); session.current = null; api.current?.dispose(); api.current = null;
      setRecord({ identity, view: blank() }); setWorking(false);
    };
    clear();
    const visibility = () => { if (document.hidden) clear(); };
    const host = captureEnterpriseHostSession(), unsubscribe = host ? subscribeCustomerSession(host.tenantCode, clear) : () => undefined;
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', clear);
    window.addEventListener('offline', clear); window.addEventListener('online', clear);
    return () => {
      generation.current++; session.current?.dispose(); session.current = null; api.current?.dispose(); api.current = null; unsubscribe();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', clear);
      window.removeEventListener('offline', clear); window.removeEventListener('online', clear);
    };
  }, [identity]);
  const ensure = () => {
    if (currentIdentity.current !== identity || !visible()) return null;
    if (session.current) return session.current;
    const host = captureEnterpriseHostSession(); if (!host) throw Error('client_cancellation_unavailable');
    const epoch = generation.current;
    const current = () => epoch === generation.current && currentIdentity.current === identity && host.current() && visible();
    const context = { tenantCode: host.tenantCode, serviceCode: host.workspaceCode, customerId: host.customerId,
      orderId, surface: 'tenant_website' as const, current };
    const key = clientTaskCancellationStorageKey(context, origin), transport = createClientTaskCancellationApi(context);
    api.current = transport;
    session.current = createClientTaskCancellationSession({ context, origin, api: transport,
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? undefined : JSON.parse(value); },
        write: value => localStorage.setItem(key, JSON.stringify(value)) },
      changed: next => {
        if (!current()) return;
        setRecord({ identity, view: next });
        const receipt = next.observation;
        if (receipt) {
          const signature = JSON.stringify(receipt);
          if (signature !== observed.current) { observed.current = signature; callback.current?.(receipt); }
        }
      } });
    return session.current;
  };
  const work = async (action: (owner: NonNullable<typeof session.current>) => Promise<unknown>) => {
    if (busy.current || currentIdentity.current !== identity || !visible()) return;
    const epoch = generation.current; busy.current = true; setWorking(true);
    try { const owner = ensure(); if (owner) await action(owner); }
    catch { if (epoch === generation.current) setRecord({ identity, view: { ...blank(), status: 'unavailable' } }); }
    finally { if (epoch === generation.current) { busy.current = false; setWorking(false); } }
  };
  return <section aria-label={english ? 'Stop this explanation' : '停止本次解释'} aria-busy={working}>
    <div className="order-bottom-actions">
      {!['settled', 'finished'].includes(view.status) && <button type="button" className="button button-outline"
        disabled={!online || working || view.status !== 'closed' && !view.canRequest}
        onClick={() => void work(owner => owner.requestCancellation())}>{english ? 'Request a stop' : '申请停止解释'}</button>}
      <button type="button" className="button button-outline" disabled={!online || working || view.status !== 'closed' && !view.canRead}
        onClick={() => void work(owner => owner.refresh())}>{english ? 'Check original stop record' : '核对停止结果'}</button>
      {view.canSettle && <button type="button" className="button button-outline" disabled={!online || working}
        onClick={() => void work(owner => owner.finishCancellation())}>{english ? 'Check and finish stopping' : '核对并完成停止'}</button>}
    </div>
    <p role="status" aria-live="polite">
      {!online ? english ? 'You are offline. Reconnect to check the original stop record.' : '当前离线，联网后可读取原停止记录。'
        : working ? english ? 'Checking the original task…' : '正在核对原任务…'
        : view.status === 'requested' ? english ? 'Stop requested; completion still needs checking.' : '停止申请已记录，尚未确认完成。'
          : view.status === 'settled' ? english ? 'Stop request settled; existing results remain.' : '停止请求已收口，已发生的结果保留。'
            : view.status === 'finished' ? english ? 'This explanation task has ended.' : '解释任务已结束。'
              : view.status === 'unknown' ? english ? 'The stop result needs checking against the original record.' : '停止结果待核对，请读取原记录。'
                : view.status === 'unavailable' ? english ? 'The stop record is unavailable. Check the original record later.' : '暂时无法核对停止状态，请稍后读取原记录。'
                  : null}
    </p>
  </section>;
}
