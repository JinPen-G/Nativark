/** Global business Copilot preview, separate from capability-bound AI Workspace chats.
 * Memory only, scoped by auth generation; no model/API calls or business mutations. */
import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from '@/app/navigation';
import type { CopilotRecord } from './context';

export type CopilotTurn = { id: string; prompt: string; contexts: CopilotRecord[]; page: string; text: string;
  status: 'reading' | 'done' | 'stopped'; proposal?: 'pending' | 'confirmed' | 'discarded' };
function useCopilotState() {
  const [open, setOpen] = useState(false), [contexts, setContexts] = useState<CopilotRecord[]>([]);
  const [turns, setTurns] = useState<CopilotTurn[]>([]), [draft, setDraft] = useState(''), [focusVersion, setFocus] = useState(0);
  const [notice, setNotice] = useState('');
  const active = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const auth = useAuthStore();
  const routes = (Object.values(APP_ROUTES) as AppRouteDefinition[]).filter(route => route.menu && canAccessRoute(route, auth.hasPermission, auth.hasCapability,
    auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission));
  const available = !auth.user?.isSaasAdmin && Boolean(auth.sessionVerified && auth.currentWorkspaceId);
  const page = routes.filter(route => location.pathname === route.path || location.pathname.startsWith(`${route.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const permitted = (record: CopilotRecord) => routes.some(route => record.path === route.path || record.path.startsWith(`${route.path}/`));
  useEffect(() => () => clearTimeout(active.current), []);
  function show() {
    if (!available) return;
    if (!open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true); setFocus(value => value + 1);
  }
  function close() {
    setOpen(false);
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('.workspace-copilot-entry'))?.focus({ preventScroll: true }));
  }
  function add(incoming: CopilotRecord[], focus = false) {
    if (!available) return;
    const safe = incoming.filter(permitted);
    if (!safe.length) return;
    setContexts(previous => {
      const map = new Map(previous.map(record => [record.key, record]));
      safe.forEach(record => map.set(record.key, record));
      return [...map.values()];
    });
    setNotice(`${safe.length}`);
    if (focus) show();
  }
  function stop() {
    clearTimeout(active.current); active.current = undefined;
    setTurns(previous => previous.map(turn => turn.status === 'reading' ? { ...turn, status: 'stopped' } : turn));
  }
  function send(prompt: string, english: boolean) {
    if (!available || active.current || !prompt.trim()) return;
    const snapshot = contexts.filter(permitted);
    const id = crypto.randomUUID();
    const turn: CopilotTurn = { id, prompt: prompt.trim(), contexts: snapshot, page: page?.label ?? location.pathname, text: '', status: 'reading' };
    setTurns(previous => [...previous, turn]); setDraft('');
    // Explicitly local preview latency, never labelled as a real resource/API read.
    active.current = setTimeout(() => {
      active.current = undefined;
      const wantsAction = /修改|调整|分配|派工|办理|启用|停用|删除|取消订单|执行|change|assign|disable|enable|delete|update/i.test(prompt);
      const text = snapshot.length ? snapshot.map((record, index) => {
        const facts = record.fields;
        return `### ${index + 1}. ${record.label}\n${facts.map(field => `- **${field.label}**：${field.value}`).join('\n')}\n`;
      }).join('\n') : english ? 'Choose a record to add its displayed facts. You can also open a permitted page below.' : '你可以右击业务记录加入上下文，也可以从下方进入当前账号可用的页面。';
      setTurns(previous => previous.map(item => item.id === id ? { ...item, status: 'done',
        text: `${english ? '**Local preview · displayed facts only**' : '**本地演示 · 仅整理页面可见信息**'}\n\n${text}\n\n${snapshot.length ? english ? 'Check the current status, dates and charges before taking action. Hidden records and business rules have not been queried.' : '可先核对当前状态与计划时间，再核对费用及处理条件。未查询隐藏资料或业务规则，暂不作业务结论。' : ''}`,
        ...(wantsAction && snapshot.length ? { proposal: 'pending' as const } : {}) } : item));
    }, 650);
  }
  const busy = turns.some(turn => turn.status === 'reading');
  return { open, contexts, turns, draft, setDraft, focusVersion, notice, available, page, routes, busy, show, close, add, send, stop,
    remove: (key: string) => setContexts(previous => previous.filter(record => record.key !== key)),
    clear: () => { stop(); setTurns([]); setContexts([]); setDraft(''); },
    decide: (id: string, decision: 'confirmed' | 'discarded') => setTurns(previous => previous.map(turn => turn.id === id && turn.proposal === 'pending' ? { ...turn, proposal: decision } : turn)),
  };
}
type CopilotState = ReturnType<typeof useCopilotState>;
const Context = createContext<CopilotState | null>(null);
function ScopedProvider({ children }: { children: ReactNode }) {
  const value = useCopilotState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function CopilotProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStore();
  const scope = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, currentSessionEpoch(), auth.sessionVerified,
    auth.user?.permissions, auth.user?.tenantMembership, auth.user?.roleIds, auth.user?.dataScope, auth.user?.locationScope]);
  return <ScopedProvider key={scope}>{children}</ScopedProvider>;
}
export function useCopilot() { return useContext(Context); }
