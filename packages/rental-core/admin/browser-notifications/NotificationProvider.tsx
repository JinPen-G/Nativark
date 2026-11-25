import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isTransientRefreshError } from '@rental-os/platform-admin/runtime';
import { captureSoundScope, emitSoundEvent } from '@rental-os/platform-admin/sound';
import { groupTodos, messageState, parsePersonalState, type Notice, type PersonalEntry, type PersonalState, type Folder } from './model';
import type { RentalNotificationBindings } from './types';

/** 原通知状态按一个真实浏览器宿主装配，身份切换重建其本机消息投影。 */
export function createRentalNotificationProvider(bindings: RentalNotificationBindings) {
  const useAuthStore = bindings.session.useAuthStore;
  const rentalCoreApi = bindings.api;
  const useOperator = bindings.useOperator ?? (() => undefined);

  /** Current-space business todos plus explicit local AI demo results. No business write adapters. */
  function useMessages() {
    const auth = useAuthStore(), operator = useOperator();
    const epoch = bindings.session.currentSessionEpoch();
    const scope = JSON.stringify([auth.user?.id, auth.tenant?.tenantId ?? 'platform', auth.currentWorkspaceId ?? 'none']);
    const storageKey = `rental_notifications_v1:${scope}`;
    const [personal, setPersonal] = useState<PersonalState>(() => {
      try { return parsePersonalState(localStorage.getItem(storageKey)); } catch { return {}; }
    });
    const [storageAvailable, setStorageAvailable] = useState(true);
    const aiTimes = useRef(new Map<string, string>()), seenEvents = useRef<Set<string> | null>(null);
    const businessSnapshotSeen = useRef(false);
    const enabled = auth.sessionVerified && !!auth.currentWorkspaceId && !auth.user?.isSaasAdmin
      && ['rental-os:order:view', 'rental-os:report:view', 'rental-core:maintenance:view'].some(auth.hasPermission)
      && (bindings.hasPageAccess?.('workbench', auth) ?? true);
    const query = useQuery({
      queryKey: ['notifications', 'todos', scope, auth.user],
      queryFn: rentalCoreApi.workbenchTodos, enabled, staleTime: 30_000, refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
    useEffect(() => {
      const sync = (event: StorageEvent) => { if (event.key === storageKey) setPersonal(parsePersonalState(event.newValue)); };
      window.addEventListener('storage', sync);
      return () => window.removeEventListener('storage', sync);
    }, [storageKey]);
    useEffect(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(personal)); }
      catch { setStorageAvailable(false); }
    }, [storageKey, personal]);
    const notices = useMemo(() => {
      const business = enabled && (!query.isError || isTransientRefreshError(query.error)) ? groupTodos(query.data?.items ?? []) : [];
      const ai: Notice[] = [];
      for (const thread of operator?.threads ?? []) {
        const capability = operator?.available.find(item => item.id === thread.capabilityId);
        if (!capability || !thread.runId || !thread.artifact || thread.running || !bindings.aiHref) continue;
        const event = `ai:${thread.id}:${thread.runId}`;
        if (!aiTimes.current.has(event)) aiTimes.current.set(event, new Date().toISOString());
        ai.push({ id: event, events: [event], category: 'ai', title: thread.artifact.title,
          description: thread.revisionRequest ? `待补充：${thread.revisionRequest}\n${thread.artifact.summary}` : thread.artifact.summary, createdAt: aiTimes.current.get(event)!, priority: 'normal',
          pending: Boolean(capability.action && !thread.receipt), href: bindings.aiHref, threadId: thread.id, demo: true });
      }
      return [...business, ...ai].sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || b.createdAt.localeCompare(a.createdAt));
    }, [enabled, query.data, query.isError, query.error, operator?.threads, operator?.available]);
    const messages = useMemo(() => notices.map(item => ({ ...item, ...messageState(item, personal[item.id]) })), [notices, personal]);
    useEffect(() => {
      if (enabled && !query.isSuccess) return;
      const keys = new Set(notices.flatMap(item => item.events));
      // Core 目录就绪前可先挂载空通知，首次实际待办快照仍须静默。
      if (enabled && !businessSnapshotSeen.current) {
        businessSnapshotSeen.current = true;
        seenEvents.current = keys;
        return;
      }
      if (!seenEvents.current) { seenEvents.current = keys; return; }
      const arrived = messages.filter(item => item.folder === 'Inbox' && !item.read && item.events.some(id => !seenEvents.current!.has(id)));
      const soundScope = captureSoundScope();
      const soundKey = bindings.soundScopeKey?.(useAuthStore.getState()) ?? scope;
      if (arrived.length && soundScope?.key === soundKey && soundScope.epoch === epoch
        && bindings.session.currentSessionEpoch() === epoch) void emitSoundEvent({ ...soundScope,
        id: `inbox:${arrived[0].events.find(id => !seenEvents.current!.has(id))}`, type: 'notification' });
      for (const key of keys) seenEvents.current.add(key);
      if (seenEvents.current.size > 2000) seenEvents.current = keys;
    }, [enabled, query.isSuccess, notices, messages, scope, epoch]);
    function update(id: string, patch: { read?: boolean; folder?: Folder }) {
      const notice = notices.find(item => item.id === id);
      if (!notice) return;
      setPersonal(previous => {
        const state = messageState(notice, previous[id]);
        const folder = patch.folder ?? state.folder;
        const entry: PersonalEntry = { ...state, ...patch, read: patch.read ?? state.read, folder, events: notice.events.slice(0, 40), updatedAt: Date.now() };
        return Object.fromEntries(Object.entries({ ...previous, [id]: entry }).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 500));
      });
    }
    function restore(id: string, entry?: PersonalEntry) {
      setPersonal(previous => { const next = { ...previous }; if (entry) next[id] = entry; else delete next[id]; return next; });
    }
    return { messages, personal, update, restore, storageAvailable,
      loading: enabled && query.isPending, error: enabled && query.isError, refreshing: query.isFetching,
      refresh: () => enabled ? query.refetch() : undefined, unread: messages.filter(item => item.folder === 'Inbox' && !item.read).length };
  }
  const NotificationContext = createContext<ReturnType<typeof useMessages> | null>(null);
  function ScopedNotificationProvider({ children }: { children: ReactNode }) {
    const value = useMessages();
    return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
  }
  function useNotifications() {
    const value = useContext(NotificationContext);
    if (!value) throw new Error('NotificationProvider required');
    return value;
  }
  function NotificationProvider({ children }: { children: ReactNode }) {
    const identity = useAuthStore(auth => JSON.stringify([
      auth.user?.id, auth.tenant?.tenantId ?? 'platform', auth.currentWorkspaceId ?? 'none',
    ]));
    return <ScopedNotificationProvider key={identity}>{children}</ScopedNotificationProvider>;
  }
  return { NotificationProvider, useNotifications };
}
