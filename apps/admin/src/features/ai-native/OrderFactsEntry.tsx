import { useEffect, useMemo, useState } from 'react';
import { ActionButton, Alert } from '@/components/ui';
import { request } from '@/api/http';
import { useAuthStore } from '@/features/auth/authStore';
import { AiTaskWorkbench } from './AiTaskWorkbench';
import { OrderFactsHost, type OrderAssistantPacket, type OrderAssistantQuestion } from './order-facts-host';

/** Actual order page consumer. Mount/import is inert. A human click requests
 * the existing guarded original-input chain; no local enable/approval switch.
 * No model driver or business action is supplied by this first read-only host.
 */
export function OrderFactsEntry({ orderId }: { orderId: string }) {
  const tenantId = useAuthStore(state => state.tenant?.tenantId);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const actorId = useAuthStore(state => state.user?.id);
  const token = useAuthStore(state => state.token);
  const allowed = useAuthStore(state => state.hasPermission('rental-os:order:view'));
  const host = useMemo(() => new OrderFactsHost({ orderId, tenantId: tenantId ?? '', workspaceId: workspaceId ?? '',
    current: () => { const session = useAuthStore.getState(); return Boolean(token && tenantId && workspaceId && actorId)
      && session.token === token && session.user?.id === actorId && session.tenant?.tenantId === tenantId
      && session.currentWorkspaceId === workspaceId && session.hasPermission('rental-os:order:view'); },
    post: (path, data) => request<unknown>(path, { method: 'post', data }),
    newKey: () => `order-facts:${crypto.randomUUID()}` }), [orderId, tenantId, workspaceId, actorId, token]);
  useEffect(() => { host.activate(); return () => host.close(); }, [host]);
  const [result, setResult] = useState<{ host: OrderFactsHost; packet?: OrderAssistantPacket; pending: boolean; error?: string }>();
  const current = result?.host === host ? result : undefined;
  const load = async (question: OrderAssistantQuestion) => {
    setResult({ host, pending: true });
    try { const packet = await host.read(question); setResult({ host, packet, pending: false }); }
    catch (error) {
      setResult({ host, pending: false, error: '当前 AI 场景政策、权益或原事实不可用；可继续使用本订单页人工办理。结果不明时仅核对原请求，不重新执行。' });
      throw error;
    }
  };
  const packet = current?.packet;
  const readTask = useMemo(() => packet
    ? async (taskId: string, _context: unknown, signal: AbortSignal) => host.detail(packet, taskId, signal) : undefined, [host, packet]);
  if (!allowed || !tenantId || !workspaceId || !actorId) return null;
  const status = packet?.task.status;
  const displayStatus = status === 'queued' ? 'registered' : status?.startsWith('waiting_') ? 'waiting' : status;
  return <section aria-label="订单业务助手">
    <h2>订单业务助手</h2>
    <p>按需读取正式业务事实。默认不读取、不轮询、不调用模型；场景未配置时保留人工办理。</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {([['status', '查看订单状态'], ['fees', '核对费用依据'], ['next_steps', '查看人工办理提示']] as const).map(([question, label]) =>
        <ActionButton key={question} label={label} pendingLabel="读取中…" disabled={current?.pending}
          onAction={() => load(question)} />)}
    </div>
    {current?.error && <Alert type="warning" message={current.error} />}
    {packet && <AiTaskWorkbench key={packet.task.taskId} context={{ audience: 'operator', tenantId, workspaceId }}
      enabled visible selectedTaskId={packet.task.taskId} readTask={readTask}
      tasks={[{ id: packet.task.taskId, scene: 'order_explanation', status: displayStatus, updatedAt: packet.original.createdAt }]} />}
  </section>;
}
