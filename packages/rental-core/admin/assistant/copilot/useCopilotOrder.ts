import type { AiConversationsApi } from "../api/aiConversations";
import type { createAiTaskCenterApi } from "@rental-os/ai-native-admin/source/api/aiTaskCenter";
type AiTaskCenterApi = ReturnType<typeof createAiTaskCenterApi>;
import { useRentalAssistant } from "../host";
/** Browser lifetime and durable original locators for the incumbent Copilot.
 * Cross-tab writes use the browser's exclusive lock. Missing storage or locks
 * keeps execution unavailable. Console transfer carries only the conversation. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AI_TASK_CENTER_ENTRY_PERMISSIONS } from '@rental-os/shared';




import { CopilotOrderSession, type OrderQuestion } from './copilot-order-session';
import type { LiveVisibleObservationSession } from "@rental-os/ai-native-admin/source/ai-native/visible-observation-session";

const empty = Object.freeze({ phase: 'idle' as const, conversationId: null, taskId: null, runId: null,
  text: '', textSource: null, facts: null, steps: [], complete: false, hasOriginal: false });
const snapshot = () => empty;
const subscribe = () => () => {};
const noVisibleHost = () => null;
export function useCopilotOrder(orderId: string | undefined, open: boolean, allowed: boolean, source: string,
  visibleHost: () => LiveVisibleObservationSession | null = noVisibleHost) {
  const { aiConversationsApi, aiTaskCenterApi, currentSessionEpoch, useAuthStore } = useRentalAssistant();

  const auth = useAuthStore(), epoch = currentSessionEpoch();
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const owner = JSON.stringify([identity, auth.user, epoch, orderId, source]);
  const lease = useRef({ owner, open, allowed }); lease.current = { owner, open, allowed };
  const session = useMemo(() => {
    if (!orderId) return null;
    const pathname = window.location.pathname;
    let storage: Storage | null = null;
    try {
      const shared = window.localStorage, original = window.sessionStorage;
      // The shared locator prevents a second tab replacing an unknown chain.
      // Original scene journals remain compatible with same-tab Agent transfer.
      const target = (key: string) => key.startsWith('ai-copilot-order') ? shared : original;
      storage = { getItem: key => target(key).getItem(key), setItem: (key, value) => target(key).setItem(key, value),
        removeItem: key => target(key).removeItem(key) } as Storage;
    } catch { /* unavailable storage must never authorize a new chain */ }
    return new CopilotOrderSession({ ...aiConversationsApi, snapshot: aiTaskCenterApi.snapshot }, storage, identity, orderId, () => {
      const now = useAuthStore.getState();
      return lease.current.owner === owner && lease.current.open && lease.current.allowed && !document.hidden
        && navigator.onLine && epoch === currentSessionEpoch() && !!now.token && now.sessionVerified
        && !now.user?.isSaasAdmin && window.location.pathname === pathname
        && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(now.hasPermission)
        && JSON.stringify([JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user?.id]),
          now.user, currentSessionEpoch(), orderId, source]) === owner;
    }, undefined, visibleHost);
  }, [owner, visibleHost]);
  const state = useSyncExternalStore(session?.subscribe ?? subscribe, session?.snapshot ?? snapshot, snapshot);
  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      session.retract();
      if (lease.current.owner === owner && lease.current.open && lease.current.allowed && !document.hidden && navigator.onLine)
        session.activate();
    };
    const suspend = () => session.retract();
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('offline', refresh); window.addEventListener('online', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('offline', refresh); window.removeEventListener('online', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('pagehide', suspend); window.removeEventListener('pageshow', refresh); session.dispose();
    };
  }, [session, owner, open, allowed]);
  const lock = async (work: () => Promise<void> | void) => {
    if (!session || !navigator.locks) throw Error('AI_RESOURCE_UNAVAILABLE');
    await navigator.locks.request(`ai-copilot-order:${identity}:${orderId}`, { mode: 'exclusive', ifAvailable: true }, async held => {
      if (!held || lease.current.owner !== owner) throw Error('AI_RESULT_UNKNOWN');
      await work();
    });
  };
  return { state, identity, session, observationScope: owner,
    observationCurrent: session?.observationCurrent ?? (() => false),
    submit: (question: OrderQuestion) => lock(() => session!.submit(question)),
    read: async () => { if (!session) throw Error('AI_RESOURCE_UNAVAILABLE'); await session.read(); },
    clear: () => lock(() => session!.newChat()),
    close: () => { lease.current.open = false; session?.retract(); },
    stop: () => { session?.retract(); if (open && allowed) session?.activate(); },
  };
}
