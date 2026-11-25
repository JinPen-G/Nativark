import type { RentalAssistantRoute as AppRouteDefinition } from "../host";
import { useRentalAssistant } from "../host";
/** Business Copilot using the original current-order conversation and Task chain.
 * Context fields remain local locators. Explicit confirmation owns model starts. */
import { createContext, useContext, useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, type ReactNode } from 'react';
import { BusinessUiScopeProvider, useBusinessUiScope } from "@rental-os/platform-admin/source/components/ui/BusinessUiScope";
import { App } from "@rental-os/platform-admin/source/components/ui/App";
import { useLocale } from "@rental-os/platform-admin/locale";
import { readSelection } from './context';
import { matchPath } from "react-router-dom";
import { useLocation, useNavigate } from "../host";



import type { CopilotRecord, CopilotConfigField } from './context';
import { COPILOT_DESTINATIONS, type CopilotDestination } from './destinations';
import { useCopilotOrder } from './useCopilotOrder';
import type { CopilotOrderTextSource, OrderQuestion } from './copilot-order-session';
import type { LiveVisibleObservationSession } from "@rental-os/ai-native-admin/source/ai-native/visible-observation-session";
import { useGovernancePermissions } from "../../governance/shared";
export type { CopilotConfigField } from './context';
export type CopilotConfigBinding = { read: () => CopilotConfigField[]; editable: () => boolean; fill: (values: Record<string, string>) => void };
export const ORDER_QUESTIONS = [
  { value: 'status', label: '订单状态' }, { value: 'fees', label: '订单费用' },
  { value: 'payments', label: '收款情况' }, { value: 'next_steps', label: '下一步处理' },
] satisfies { value: OrderQuestion; label: string }[];
export type CopilotReview = { prompt: string; orderId: string; question: OrderQuestion | null; source: string };
export type CopilotTurn = { id: string; prompt: string; contexts: CopilotRecord[]; page: string; text: string;
  textSource: CopilotOrderTextSource | null; status: 'reading' | 'done' | 'stopped' };
function useCopilotState() {
  const { APP_ROUTES, canAccessRoute, useAuthStore } = useRentalAssistant();

  const [open, setOpen] = useState(false), [contexts, setContexts] = useState<CopilotRecord[]>([]);
  const [draft, setDraft] = useState(''), [focusVersion, setFocus] = useState(0);
  const [review, setReview] = useState<CopilotReview | null>(null), [sentPrompt, setSentPrompt] = useState('');
  const reviewRef = useRef<CopilotReview | null>(null), viewVersion = useRef(0);
  const [notice, setNotice] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const bindings = useRef(new Map<string, CopilotConfigBinding>());
  const [feedback, setFeedback] = useState('');
  const visible = useRef<LiveVisibleObservationSession | null>(null);
  const visibleHost = useCallback(() => visible.current, []);
  const registerVisibleHost = useCallback((host: LiveVisibleObservationSession | null) => {
    visible.current = host;
    return () => { if (visible.current === host) visible.current = null; };
  }, []);
  const clearReview = useCallback(() => { reviewRef.current = null; setReview(null); }, []);
  const retractView = useCallback(() => {
    viewVersion.current++;
    clearReview(); setDraft(''); setSentPrompt(''); setFeedback(''); setNotice('');
  }, [clearReview]);
  const registerConfiguration = useCallback((id: string, binding: CopilotConfigBinding) => {
    bindings.current.set(id, binding);
    return () => { if (bindings.current.get(id) === binding) bindings.current.delete(id); };
  }, []);
  const location = useLocation();
  const { t } = useLocale();
  const navigate = useNavigate();
  const auth = useAuthStore();
  const governance = useGovernancePermissions(auth.hasPermission);
  const routes = (Object.values(APP_ROUTES) as AppRouteDefinition[]).filter(route => route.menu && canAccessRoute(route, auth.hasPermission, auth.hasCapability,
    auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission));
  const available = !auth.user?.isSaasAdmin && Boolean(auth.sessionVerified && auth.currentWorkspaceId)
    && canAccessRoute(APP_ROUTES.aiOperator);
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
  const selectedOrderIds = contexts.map(record => matchPath({ path: APP_ROUTES.orderDetail.path, end: true }, record.path)?.params.id);
  const pageOrderId = matchPath({ path: APP_ROUTES.orderDetail.path, end: true }, location.pathname)?.params.id;
  const candidate = contexts.length ? selectedOrderIds.every(id => id && id === selectedOrderIds[0]) ? selectedOrderIds[0] : undefined : pageOrderId;
  const orderId = candidate && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(candidate) ? candidate : undefined;
  const source = JSON.stringify([location.pathname, contexts.map(record => [record.key, record.path, record.recordId])]);
  const order = useCopilotOrder(orderId, open, available && canAccessRoute(APP_ROUTES.orderDetail), source, visibleHost);
  const busy = order.state.phase === 'preparing' || order.state.phase === 'running';
  const turns = useMemo<CopilotTurn[]>(() => order.state.hasOriginal ? [{ id: order.state.conversationId ?? 'original-order',
    prompt: sentPrompt || '原订单会话', contexts, page: page?.label ?? location.pathname, text: order.state.text,
    textSource: order.state.textSource,
    status: busy ? 'reading' : order.state.phase === 'observed' ? 'done' : 'stopped' }] : [],
  [order.state, sentPrompt, contexts, page?.label, location.pathname, busy]);
  useLayoutEffect(() => { retractView(); }, [source, retractView]);
  useLayoutEffect(() => { setContexts([]); }, [location.pathname]);
  useEffect(() => {
    const retract = () => { retractView(); setContexts([]); };
    const hidden = () => { if (document.hidden) retract(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('offline', retract); window.addEventListener('pagehide', retract);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('offline', retract); window.removeEventListener('pagehide', retract);
    };
  }, [retractView]);
  const report = (error: unknown) => {
    setFeedback(error instanceof Error && error.message === 'AI_RESOURCE_UNAVAILABLE'
      ? '当前入口不可用，请返回原业务页或 Agent 控制台核对。'
      : '原操作待核对，请读取原结果；未观察到结果不表示未执行。');
  };
  function show() {
    if (!available) return;
    if (!open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true); setFocus(value => value + 1);
  }
  function close() {
    order.close(); retractView(); setContexts([]);
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
    order.stop(); retractView();
    setFeedback('已停止接收本页结果。模型与业务状态请按原操作核对。');
  }
  function send(prompt: string, _english?: boolean, records?: CopilotRecord[]) {
    if (!available || busy || !prompt.trim()) return;
    if (records) { add(records); setFeedback('已添加来源，请核对上下文后发送。'); return; }
    if (!orderId) { setFeedback('请打开一笔订单后提问。资料或配置请通过原页面办理。'); return; }
    if (order.state.hasOriginal) { setFeedback('请先核对原结果，或在原会话中继续处理。'); return; }
    const selected = ORDER_QUESTIONS.find(item => item.label === prompt.trim() || t(item.label) === prompt.trim());
    const nextReview = { prompt: prompt.trim(), orderId, question: selected?.value ?? null, source };
    reviewRef.current = nextReview; setReview(nextReview);
    setFeedback('');
  }
  async function confirm() {
    if (!review?.question || reviewRef.current !== review || review.source !== source || review.orderId !== orderId
      || busy || !open || !available || document.hidden || !navigator.onLine) return;
    const version = viewVersion.current;
    const question = review.question;
    setSentPrompt(ORDER_QUESTIONS.find(item => item.value === question)!.label);
    clearReview(); setDraft('');
    try { await order.submit(question); } catch (error) { if (viewVersion.current === version) report(error); }
  }
  async function readOriginal() {
    const version = viewVersion.current;
    clearReview(); setFeedback('');
    try { await order.read(); } catch (error) { if (viewVersion.current === version) report(error); }
  }
  async function clear() {
    const version = viewVersion.current;
    try { await order.clear(); if (viewVersion.current === version) { retractView(); setContexts([]); } }
    catch (error) { if (viewVersion.current === version) report(error); }
  }
  return { open, contexts, turns, draft, setDraft, focusVersion, notice, available, page, routes, busy, show, close, add, send, stop,
    registerConfiguration, navigateTo, feedback, order: order.state, orderId, identity: order.identity, readOriginal,
    registerVisibleHost, observationScope: order.observationScope, observationCurrent: order.observationCurrent,
    review: review?.source === source ? review : null, confirm, clear,
    dismissReview: () => { if (reviewRef.current === review) clearReview(); },
    selectQuestion: (question: OrderQuestion) => {
      if (!review || reviewRef.current !== review || !ORDER_QUESTIONS.some(item => item.value === question)) return;
      const nextReview = { ...review, question }; reviewRef.current = nextReview; setReview(nextReview);
    },
    remove: (key: string) => setContexts(previous => previous.filter(record => record.key !== key)),
  };
}
type CopilotState = ReturnType<typeof useCopilotState>;
const Context = createContext<CopilotState | null>(null);
function ScopedProvider({ children }: { children: ReactNode }) {
  const value = useCopilotState();
  const scope = useBusinessUiScope(), { pathname } = useLocation(), { t } = useLocale();
  const { message } = App.useApp();
  const selectionCommand = value.available ? { label: t('添加到 Copilot'), run: (host: HTMLElement, count: number) => {
    const records = readSelection(host, pathname);
    if (records.length !== count) { message.warning(t('部分所选记录不在当前视图，请重新选择后添加。')); return; }
    value.add(records, true);
  } } : undefined;
  return <Context.Provider value={value}><BusinessUiScopeProvider value={{ ...scope, selectionCommand }}>{children}</BusinessUiScopeProvider></Context.Provider>;
}
export function CopilotProvider({ children }: { children: ReactNode }) {
  const { currentSessionEpoch, useAuthStore } = useRentalAssistant();

  const auth = useAuthStore();
  const scope = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch(), auth.sessionVerified]);
  return <ScopedProvider key={scope}>{children}</ScopedProvider>;
}
export function useCopilot() { return useContext(Context); }
