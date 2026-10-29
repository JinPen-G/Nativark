/** Global business Copilot preview, separate from capability-bound AI Workspace chats.
 * Memory only, scoped by auth generation; no model/API calls or business mutations. */
import { createContext, useContext, useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from '@/app/navigation';
import type { CopilotRecord, CopilotConfigField } from './context';
import { COPILOT_DESTINATIONS, type CopilotDestination } from './destinations';
import { useGovernancePermissions } from '@/features/settings/governance/shared';
export type { CopilotConfigField } from './context';
export type CopilotConfigBinding = { read: () => CopilotConfigField[]; editable: () => boolean; fill: (values: Record<string, string>) => void };
type ConfigChange = CopilotConfigField & { configId: string; before: string; after: string; recordKey: string };

export type CopilotTurn = { id: string; prompt: string; contexts: CopilotRecord[]; page: string; text: string;
  status: 'reading' | 'done' | 'stopped'; proposal?: 'pending' | 'confirmed' | 'discarded';
  destinations?: CopilotDestination[]; changes?: ConfigChange[]; filled?: boolean };
function useCopilotState() {
  const [open, setOpen] = useState(false), [contexts, setContexts] = useState<CopilotRecord[]>([]);
  const [turns, setTurns] = useState<CopilotTurn[]>([]), [draft, setDraft] = useState(''), [focusVersion, setFocus] = useState(0);
  const [notice, setNotice] = useState('');
  const active = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const bindings = useRef(new Map<string, CopilotConfigBinding>());
  const [configurationNotice, setConfigurationNotice] = useState('');
  const registerConfiguration = useCallback((id: string, binding: CopilotConfigBinding) => {
    bindings.current.set(id, binding);
    return () => { if (bindings.current.get(id) === binding) bindings.current.delete(id); };
  }, []);
  const location = useLocation();
  const navigate = useNavigate(), governance = useGovernancePermissions();
  const auth = useAuthStore();
  const routes = (Object.values(APP_ROUTES) as AppRouteDefinition[]).filter(route => route.menu && canAccessRoute(route, auth.hasPermission, auth.hasCapability,
    auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission));
  const available = !auth.user?.isSaasAdmin && Boolean(auth.sessionVerified && auth.currentWorkspaceId);
  const page = routes.filter(route => location.pathname === route.path || location.pathname.startsWith(`${route.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const permitted = (record: CopilotRecord) => routes.some(route => record.path === route.path || record.path.startsWith(`${route.path}/`));
  const destinations = COPILOT_DESTINATIONS.filter(target => routes.some(route => route.path === target.path)
    && (target.tab !== 'rules' || governance.canSeeRules) && (target.tab !== 'calendar' || governance.canSeeCalendar)
    && (target.tab !== 'category' || governance.canSeeSettings));
  const routeDestinations: CopilotDestination[] = routes.map(route => ({ id: `page:${route.path}`, path: route.path, label: route.label, keywords: /$^/ }));
  function navigateTo(id: string) {
    const target = [...destinations, ...routeDestinations].find(item => item.id === id);
    if (!available || !target) return;
    navigate(target.path, { state: { copilotTarget: target.id } });
  }
  function project(record: CopilotRecord): CopilotRecord {
    const binding = record.configId && bindings.current.get(record.configId);
    if (!binding) return record;
    const configuration = binding.read().map(field => ({ ...field, options: field.options?.map(option => ({ ...option })) }));
    return { ...record, configuration, fields: configuration.map(field => ({ key: field.key, label: field.label, value: field.options?.find(option => option.value === field.value)?.label ?? field.value })) };
  }
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
    const safe = incoming.filter(permitted).map(project);
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
  function send(prompt: string, english: boolean, records?: CopilotRecord[]) {
    if (!available || active.current || !prompt.trim()) return;
    const snapshot = (records ?? contexts).filter(permitted).map(record => records ? project(record) : record);
    const id = crypto.randomUUID();
    const turn: CopilotTurn = { id, prompt: prompt.trim(), contexts: snapshot, page: page?.label ?? location.pathname, text: '', status: 'reading' };
    setTurns(previous => [...previous, turn]); setDraft('');
    // Explicitly local preview latency, never labelled as a real resource/API read.
    active.current = setTimeout(() => {
      active.current = undefined;
      const wantsAction = /修改|调整|分配|派工|办理|启用|停用|删除|取消订单|执行|change|assign|disable|enable|delete|update/i.test(prompt);
      const askingNavigation = /哪里|在哪|怎么设置|打开|跳转|定位|带我|可用页面|where|navigate|open|go to|find|available pages/i.test(prompt);
      const matches = askingNavigation ? destinations.filter(target => target.keywords.test(prompt)) : [];
      const links = matches.length ? matches : askingNavigation ? routeDestinations.filter(target => prompt.includes(target.label) || /可用页面|available pages/i.test(prompt)).slice(0, 8) : [];
      const changes: ConfigChange[] = wantsAction ? snapshot.flatMap(record => record.configId && record.configuration && bindings.current.get(record.configId)?.editable()
        ? record.configuration.filter(field => field.options?.length).map(field => ({ ...field, configId: record.configId!, recordKey: record.key, before: field.value, after: field.value })) : []) : [];
      // Small deterministic demo grammar only; it cannot infer arbitrary settings.
      // Ambiguous or out-of-range values stay unchanged for explicit selection.
      const radiusValues = prompt.match(/\d+/g);
      if (radiusValues?.length === 1 && /圆角|radius|radii/i.test(prompt)) {
        const value = String(Number(radiusValues[0]));
        const named = changes.filter(change => prompt.includes(change.label) || /container/i.test(prompt) && change.key === 'adminContainerRadius' || /button/i.test(prompt) && change.key === 'adminButtonRadius' || /input/i.test(prompt) && change.key === 'adminInputRadius');
        for (const change of named.length ? named : changes) if (change.options?.some(option => option.value === value)) change.after = value;
      }
      const text = snapshot.length ? snapshot.map((record, index) => {
        const facts = record.fields;
        const sections = /分析|解释|核对|风险|analyse|analyze|explain|review/i.test(prompt) ? [
          { label: english ? 'Status' : '当前状态', match: /状态|status|state/i },
          { label: english ? 'Schedule' : '计划时间', match: /时间|日期|取机|还机|归还|pickup|return|date|time|At$/i },
          { label: english ? 'Charges' : '资金摘要', match: /金额|应付|待收|押金|余额|amount|price|balance|due/i },
        ] : [];
        const used = new Set<string>();
        const grouped = sections.map(section => { const selected = facts.filter(field => section.match.test(`${field.key} ${field.label}`)); selected.forEach(field => used.add(field.key)); return selected.length ? `**${section.label}**\n${selected.map(field => `- ${field.label}：${field.value}`).join('\n')}\n` : ''; }).join('\n');
        const explanation = record.configId === 'admin-radii' ? english ? '\nContainer, button and input radii are independent. Default inherits the platform setting. Changes here fill the draft only.' : '\n容器、按钮、输入框三组圆角独立设置；沿用默认表示不单独覆盖。建议只填入当前表单，保存仍由你决定。'
          : record.configId === 'business-rules' ? english ? '\nThis is the published version summary. Editing a draft and publishing it are separate actions. Historical orders retain their original snapshots.' : '\n这里是已生效规则的摘要。修改需先编辑规则草稿，再由有权限的人员发布；历史订单继续保留原规则快照。' : '';
        return `### ${index + 1}. ${record.label}\n${grouped}${facts.filter(field => !used.has(field.key)).map(field => `- **${field.label}**：${field.value}`).join('\n')}\n${explanation}`;
      }).join('\n') : links.length ? (english ? 'Use the registered destinations below to open the page and locate the section.' : '可以通过下方入口打开页面并定位对应分区。') : english ? 'Choose a record to add its displayed facts. You can also open a permitted page below.' : '你可以右击业务记录加入上下文，也可以询问某项设置在哪里。';
      setTurns(previous => previous.map(item => item.id === id ? { ...item, status: 'done',
        text: `${english ? '**Local preview · displayed facts only**' : '**本地演示 · 仅整理页面可见信息**'}\n\n${text}\n\n${snapshot.some(record => !record.configId) ? english ? 'Check the current status, dates and charges before taking action. Hidden records and business rules have not been queried.' : '可先核对当前状态与计划时间，再核对费用及处理条件。未查询隐藏资料或业务规则，暂不作业务结论。' : ''}`,
        destinations: links, ...(changes.length ? { changes } : {}),
        ...(wantsAction && snapshot.length ? { proposal: 'pending' as const } : {}) } : item));
      if (links.length === 1 && /带我去|帮我打开|跳转到|定位到|take me to|navigate to|go to/i.test(prompt)) navigateTo(links[0].id);
    }, 650);
  }
  const busy = turns.some(turn => turn.status === 'reading');
  function fillConfiguration(turn: CopilotTurn) {
    setConfigurationNotice('');
    if (!available || turn.proposal !== 'pending' || !turn.changes?.length || turn.contexts.some(record => record.path !== location.pathname || !permitted(record))) {
      setConfigurationNotice('请返回配置分区重新核对。'); return false;
    }
    const changed = turn.changes.filter(change => change.after !== change.before);
    if (!changed.length) return false;
    // Validate every section before touching any form draft; stale or unmounted
    // bindings fail closed. Values come only from this section's declared options.
    for (const change of turn.changes) {
      const binding = bindings.current.get(change.configId), field = binding?.read().find(item => item.key === change.key);
      if (!binding?.editable() || !field || field.value !== change.before || !field.options?.some(option => option.value === change.after)) {
        setConfigurationNotice('配置已变化或不可编辑，请重新添加分区后核对。'); return false;
      }
    }
    for (const id of new Set(changed.map(change => change.configId))) bindings.current.get(id)!.fill(Object.fromEntries(changed.filter(change => change.configId === id).map(change => [change.key, change.after])));
    setTurns(previous => previous.map(item => item.id === turn.id ? { ...item, proposal: 'confirmed', filled: true } : item));
    return true;
  }
  return { open, contexts, turns, draft, setDraft, focusVersion, notice, available, page, routes, busy, show, close, add, send, stop,
    registerConfiguration, navigateTo, configurationNotice, fillConfiguration,
    updateChange: (id: string, key: string, value: string) => setTurns(previous => previous.map(turn => turn.id === id && turn.proposal === 'pending' ? { ...turn, changes: turn.changes?.map(change => `${change.configId}:${change.key}` === key ? { ...change, after: value } : change) } : turn)),
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
