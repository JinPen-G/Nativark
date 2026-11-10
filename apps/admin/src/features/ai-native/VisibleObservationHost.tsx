/** Feature-local measurement lifetime for a real TaskCenter/conversation host.
 * It neither starts an action nor restores observations from browser storage. */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { LiveVisibleObservationSession } from './visible-observation-session';

const Context = createContext<LiveVisibleObservationSession | null>(null);
export const useVisibleObservationHost = () => useContext(Context);
export function VisibleObservationHost({ surface, taskId, conversationId, scopeKey, current, children }: {
  surface: 'task_center' | 'server_conversation'; taskId?: string | null; conversationId?: string;
  scopeKey?: string | number; current: () => boolean; children: ReactNode;
}) {
  const epoch = currentSessionEpoch(), active = useRef(current); active.current = current;
  const host = useMemo(() => {
    const lifetime = { mounted: false };
    const session = new LiveVisibleObservationSession(surface, {
    available: () => typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      && typeof IntersectionObserver === 'function' && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      && typeof performance !== 'undefined' && typeof performance.now === 'function'
      && Number.isFinite(window.innerWidth) && window.innerWidth > 0,
    current: () => lifetime.mounted && !document.hidden && navigator.onLine !== false
      && epoch === currentSessionEpoch() && active.current(),
    epoch: currentSessionEpoch, now: () => performance.now(), uuid: () => crypto.randomUUID(),
    viewport: () => window.innerWidth < 768 ? 'compact_viewport' : 'wide_viewport',
    report: async value => {
      const result = await aiTaskCenterApi.reportVisible(value, currentSessionSignal());
      if (result.version !== value.version || result.observationId !== value.observationId
        || result.taskId !== value.taskId || result.runId !== value.runId || result.kind !== value.kind
        || result.status !== 'recorded' || result.provenance !== 'client_reported_not_business_fact'
        || result.effects !== 'no_authorization_execution_accounting_or_slo') throw Error('AI_RESOURCE_UNAVAILABLE');
    }
    }, { ...(taskId ? { taskId } : {}), ...(conversationId ? { conversationId } : {}) });
    return { session, lifetime };
  }, [surface, taskId, conversationId, scopeKey, epoch]);
  const { session } = host;
  useEffect(() => {
    // The mounted host owns admission. An old callback cannot rearm a closed
    // view; React effect replay may reopen this lifetime without restoring time.
    host.lifetime.mounted = true;
    const clear = () => session.invalidate(), signal = currentSessionSignal();
    document.addEventListener('visibilitychange', clear); window.addEventListener('offline', clear); signal.addEventListener('abort', clear);
    return () => { host.lifetime.mounted = false; session.dispose(); document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('offline', clear); signal.removeEventListener('abort', clear); };
  }, [host, session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
