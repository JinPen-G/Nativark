import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton, Alert } from '@rental-os/platform-admin/ui';
import { useRentalOrderContext } from '../orders/page-context';
import { AiAdminHostProvider, createAiAdminHost } from '@rental-os/ai-native-admin/host';

import { AiTaskWorkbench } from '@rental-os/ai-native-admin/workbench';
import { OrderFactsHost, type OrderAssistantPacket, type OrderAssistantQuestion } from './order-facts-host';

/** Actual order page consumer. Mount/import is inert. A human click requests
 * the existing guarded original-input chain; no local enable/approval switch.
 * No model driver or business action is supplied by this first read-only host.
 */
export function OrderFactsEntry({ orderId }: { orderId: string }) {
  const context = useRentalOrderContext();
  const { runtime, session } = context;
  const currentContext = useRef(context);
  currentContext.current = context;
  const tenantId = session.tenant?.tenantId, workspaceId = session.currentWorkspaceId, actorId = session.user?.id;
  const accessKey = JSON.stringify(session.user), epoch = runtime.currentSessionEpoch();
  const allowed = session.hasPermission('rental-os:order:view');
  const presentation = useMemo(() => createAiAdminHost({ runtime,
    getSession: () => currentContext.current.getSession() }), [runtime]);
  // The same authenticated scope and query epoch own both the order and AI view.
  const host = useMemo(() => new OrderFactsHost({ orderId, tenantId: tenantId ?? '', workspaceId: workspaceId ?? '',
    current: () => { const current = currentContext.current.getSession(); return !document.hidden && current.sessionVerified && current.authenticated
      && Boolean(tenantId && workspaceId && actorId) && runtime.currentSessionEpoch() === epoch
      && current.user?.id === actorId && current.tenant?.tenantId === tenantId
      && JSON.stringify(current.user) === accessKey && current.currentWorkspaceId === workspaceId
      && current.hasPermission('rental-os:order:view'); },
    post: (path, data) => currentContext.current.requestOriginal<unknown>(path, { method: 'post', data }),
    newKey: () => `order-facts:${crypto.randomUUID()}` }),
    [orderId, tenantId, workspaceId, actorId, accessKey, allowed, epoch, runtime]);
  const [result, setResult] = useState<{ host: OrderFactsHost; packet?: OrderAssistantPacket; pending: boolean; error?: string }>();
  const lifetime = useRef({ host, generation: 0, mounted: false, pending: false });
  if (lifetime.current.host !== host) lifetime.current = { host, generation: lifetime.current.generation + 1, mounted: false, pending: false };
  useEffect(() => {
    const view = lifetime.current;
    view.mounted = true;
    const visibility = () => {
      view.generation++; view.pending = false;
      setResult(undefined);
      if (document.hidden) host.pause(); else host.activate();
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      view.mounted = false; view.generation++; view.pending = false;
      document.removeEventListener('visibilitychange', visibility);
      host.close();
    };
  }, [host]);
  const current = result?.host === host ? result : undefined;
  const load = async (question: OrderAssistantQuestion) => {
    const view = lifetime.current, generation = view.generation;
    if (view.host !== host || !view.mounted || view.pending || document.hidden) throw Error('读取入口当前不可用');
    view.pending = true;
    const currentView = () => lifetime.current === view && view.mounted && view.generation === generation && !document.hidden;
    setResult({ host, pending: true });
    try {
      const packet = await host.read(question);
      if (!currentView()) throw Error('读取页面已变化');
      setResult({ host, packet, pending: false });
    }
    catch (error) {
      if (currentView()) setResult({ host, pending: false, error: '当前 AI 场景政策、权益或原事实不可用；可继续使用本订单页人工办理。结果不明时仅核对原请求，不重新执行。' });
      throw error;
    } finally { if (currentView()) view.pending = false; }
  };
  const packet = current?.packet;
  const readTask = useMemo(() => packet
    ? async (taskId: string, _context: unknown, signal: AbortSignal) => host.detail(packet, taskId, signal) : undefined, [host, packet]);
  if (!session.sessionVerified || !session.authenticated || !allowed || !tenantId || !workspaceId || !actorId) return null;
  const status = packet?.task.status;
  const displayStatus = status === 'queued' ? 'registered' : status?.startsWith('waiting_') ? 'waiting' : status;
  return <AiAdminHostProvider host={presentation}><section aria-label="订单业务助手">
    <h2>订单业务助手</h2>
    <p>按需读取正式业务事实。默认不读取、不轮询、不调用模型；场景未配置时保留人工办理。</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {([['status', '查看订单状态'], ['fees', '核对费用依据'], ['next_steps', '查看人工办理提示']] as const).map(([question, label]) =>
        <ActionButton key={question} label={label} intent="review" pendingLabel="读取中…" successLabel="已读取" disabled={current?.pending}
          onAction={() => load(question)} />)}
    </div>
    {current?.error && <Alert type="warning" message={current.error} />}
    {packet && <AiTaskWorkbench key={packet.task.taskId} context={{ audience: 'operator', tenantId, workspaceId }}
      enabled visible selectedTaskId={packet.task.taskId} readTask={readTask}
      tasks={[{ id: packet.task.taskId, scene: 'order_explanation', status: displayStatus, updatedAt: packet.original.createdAt }]} />}
  </section></AiAdminHostProvider>;
}
