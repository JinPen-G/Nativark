/** Native console host. Local branches never grant execution or business approval. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fromMessages, visibleMessages, appendNode, updateNode, ROOT, type ChatConversation, type ChatRespond, type ChatModel, type AiChatMessage } from './archive/ai-chat/chat-state';
import type { AgentRunState } from './archive/agent-run/agent-run-state';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { useLocation } from 'react-router-dom';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { aiConversationsApi } from '@/api/aiConversations';
import { OPERATOR_CAPABILITIES, type OperatorArtifact } from './capabilities';
import { NativeOperatorSession, nativeResultText, nativeAgentRun, type NativeFrame, type NativeScene } from './native-session';
import type { LiveVisibleObservationSession, VisibleSourceReference } from '../ai-native/visible-observation-session';
import { AI_QUOTE_GOAL_DRAFT_VERSION, validateAiQuoteGoalInputDraft } from '@rental-os/shared';
export type OperatorView = 'chat' | 'plugins' | 'automations';
interface ThreadDetails { capabilityId: string; artifact?: OperatorArtifact; step: number; running: boolean; receipt?: string; run?: AgentRunState; runId?: string; runModel?: ChatModel; revisionRequest?: string; native?: NativeFrame; hasOriginal?: boolean }
export const NATIVE_GATEWAY_MODEL: ChatModel = { id: 'server-route', name: '服务端路由', note: '采用服务端当前受权路由' };
const id = () => crypto.randomUUID();
function consoleOwner(auth: ReturnType<typeof useAuthStore.getState>) {
  return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user,
    auth.tenant?.categoryCode, auth.tenant?.capabilities, currentSessionEpoch()]);
}
function useOperatorState() {
  const auth = useAuthStore(), location = useLocation();
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const owner = consoleOwner(auth);
  const permitted = OPERATOR_CAPABILITIES.filter(capability => {
    const route = Object.values(APP_ROUTES).find(entry => entry.path === capability.route);
    return route && canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode, !!auth.user?.isSaasAdmin, auth.hasTenantMembershipPermission);
  });
  const [disabled, setDisabled] = useState<string[]>([]), [notice, setNotice] = useState('');
  const available = permitted.filter(item => !disabled.includes(item.id));
  const first = permitted.find(item => item.id === 'booking') ?? permitted[0] ?? OPERATOR_CAPABILITIES.find(item => item.id === 'booking')!;
  const [chats, setChats] = useState<ChatConversation[]>(() => [fromMessages(id(), '新对话', [], '今天')]);
  const [activeId, setActiveId] = useState(chats[0].id);
  const [details, setDetails] = useState<Record<string, ThreadDetails>>(() => ({ [chats[0].id]: { capabilityId: first.id, running: false, step: 0 } }));
  const [view, setView] = useState<OperatorView>('chat');
  const [queuedPrompt, setQueuedPrompt] = useState<{ id: string; text: string; chatId: string } | null>(null);
  const [orderId, setOrderId] = useState('');
  const [openingSections, setOpeningSections] = useState<string[]>([]);
  const [historyPage, setHistoryPage] = useState<{ scene: NativeScene; status: 'active' | 'archived'; next: string | null } | null>(null);
  const historyRequest = useRef(0);
  const [orderQuestion, setOrderQuestion] = useState<'' | 'status' | 'fees' | 'payments' | 'next_steps'>('');
  const request = useRef<AbortController | null>(null), generation = useRef(0), alive = useRef(true), objectUrls = useRef<string[]>([]);
  const replies = useRef(new Map<string, string>()), startingReply = useRef(new Map<string, string>());
  const lastConversation = useRef(new Map<string, string>([[first.id, chats[0].id]]));
  const threads = chats.map(chat => ({ ...chat, messages: visibleMessages(chat), ...(details[chat.id] ?? { capabilityId: first.id, running: false, step: 0 }) }));
  const refs = useRef({ threads, activeId, owner, view, pathname: location.pathname });
  refs.current = { threads, activeId, owner, view, pathname: location.pathname };
  const active = threads.find(thread => thread.id === activeId) ?? threads[0];
  const capability = OPERATOR_CAPABILITIES.find(item => item.id === active.capabilityId) ?? first;
  const scene = capability.nativeScene, enabled = !!scene && available.some(item => item.id === capability.id);
  const current = () => {
    const now = useAuthStore.getState();
    return alive.current && !document.hidden && refs.current.view === 'chat' && refs.current.pathname === APP_ROUTES.aiOperator.path
      && !!now.token && now.sessionVerified && !!now.user && !now.user.isSaasAdmin && !!now.tenant?.tenantId && !!now.currentWorkspaceId
      && owner === consoleOwner(now);
  };
  const native = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* missing locator storage fails closed */ }
    return new NativeOperatorSession({ api: aiConversationsApi, tasks: aiTaskCenterApi, storage, identity, current, changed: (chatId, frame) => {
      if (frame.turn && startingReply.current.has(chatId)) {
        replies.current.set(`${chatId}:${frame.turn.admissionKey}`, startingReply.current.get(chatId)!);
        startingReply.current.delete(chatId);
      }
      if (current()) setDetails(previous => ({ ...previous, [chatId]: { ...previous[chatId], hasOriginal: true, native: frame, runId: frame.turn?.task?.runId, ...(frame.snapshot ? { run: nativeAgentRun(frame.snapshot) } : {}) } }));
    } });
  }, [owner]);
  function cancel() { generation.current++; request.current?.abort(); request.current = null; }
  function withdraw(message: string) {
    cancel(); native.retract(); setOrderId(''); setOrderQuestion(''); setOpeningSections([]); setNotice(message);
    setChats(previous => previous.map(chat => fromMessages(chat.id, chat.title, [], chat.group)));
    setDetails(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key,
      { capabilityId: value.capabilityId, hasOriginal: value.hasOriginal || !!value.native, step: 0, running: false }])));
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => { if (document.hidden) withdraw('页面已隐藏，返回后请读取原对话。'); };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; cancel(); native.retract(); objectUrls.current.forEach(url => URL.revokeObjectURL(url)); document.removeEventListener('visibilitychange', hide); };
  }, [native]);
  const wasVisible = useRef(location.pathname === APP_ROUTES.aiOperator.path && view === 'chat');
  useEffect(() => {
    const visible = location.pathname === APP_ROUTES.aiOperator.path && view === 'chat';
    if (wasVisible.current && !visible) withdraw('返回聊天后，请读取原对话。');
    wasVisible.current = visible;
  }, [location.pathname, view, native]);
  function createConversation(capabilityId = capability.id) {
    if (!available.some(item => item.id === capabilityId)) return activeId;
    cancel(); const chatId = id(); setChats(previous => [fromMessages(chatId, '新对话', [], '今天'), ...previous]);
    setDetails(previous => ({ ...previous, [chatId]: { capabilityId, step: 0, running: false } }));
    lastConversation.current.set(capabilityId, chatId); setActiveId(chatId); setView('chat'); setOrderId(''); setOrderQuestion(''); setOpeningSections([]); setNotice(''); return chatId;
  }
  async function readOriginal(chatId = activeId) {
    if (!current()) return; cancel(); const abort = new AbortController(); request.current = abort;
    try { const target = refs.current.threads.find(thread => thread.id === chatId), original = target?.native;
      const frame = original?.historical ? await native.open(chatId, original.conversationId, original.scene, abort.signal) : await native.read(chatId, abort.signal);
      if (!current() || abort.signal.aborted) return;
      setChats(previous => previous.map(chat => { if (chat.id !== chatId) return chat;
        const key = `${chatId}:${frame.turn?.admissionKey ?? 'unobserved'}`;
        const nodeId = replies.current.get(key) ?? `original:${key}`;
        replies.current.set(key, nodeId);
        return chat.nodes.some(node => node.id === nodeId) ? updateNode(chat, nodeId, { content: nativeResultText(frame), error: undefined, status: 'done' })
          : appendNode(chat, { id: nodeId, parent: visibleMessages(chat).at(-1)?.id ?? ROOT, role: 'assistant', content: nativeResultText(frame), status: 'done' }); })); setNotice('');
    } catch { if (current() && !abort.signal.aborted) {
      setDetails(previous => ({ ...previous, [chatId]: { ...previous[chatId], native: undefined, run: undefined, hasOriginal: true } }));
      setChats(previous => previous.map(chat => chat.id === chatId ? { ...chat, nodes: chat.nodes.map(node => node.role === 'assistant' ? { ...node, content: '', sources: [], tools: [], error: '原结果当前不可读取。', status: 'error' as const } : node) } : chat));
      setNotice('原结果当前不可读取，请保留原操作，稍后再次核对。'); } }
    finally { if (request.current === abort) request.current = null; }
  }
  function selectConversation(chatId: string) {
    const target = refs.current.threads.find(thread => thread.id === chatId); if (!target || !available.some(item => item.id === target.capabilityId)) return;
    cancel(); setActiveId(chatId); setView('chat'); setOrderId(''); setOrderQuestion(''); setOpeningSections([]); setNotice(''); lastConversation.current.set(target.capabilityId, chatId);
    if (target.native || target.hasOriginal) void readOriginal(chatId);
  }
  function chooseCapability(capabilityId: string) {
    if (!available.some(item => item.id === capabilityId)) return;
    const previous = refs.current.threads.find(thread => thread.id === lastConversation.current.get(capabilityId));
    if (previous) selectConversation(previous.id); else createConversation(capabilityId);
  }
  async function history(status: 'active' | 'archived' = 'active', beforeId?: string) {
    if (!scene || !current()) return;
    const abort = new AbortController(), selection = generation.current, chatId = activeId, attempt = ++historyRequest.current;
    const selected = () => current() && selection === generation.current && refs.current.activeId === chatId && attempt === historyRequest.current;
    try { const rows = await native.history(scene, abort.signal, status, beforeId); if (!selected()) return;
      setHistoryPage({ scene, status, next: rows.nextBeforeId });
      const originals = native.locatorsSnapshot().filter(row => row.scene === scene);
      const serverItems = rows.items.filter(row => !originals.some(original => original.conversationId === row.conversationId));
      setChats(previous => [...previous, ...originals.filter(row => !previous.some(chat => chat.id === row.chatId)).map(row => fromMessages(row.chatId, '原操作待核对', [], '原操作'))]);
      setDetails(previous => ({ ...previous, ...Object.fromEntries(originals.filter(row => !previous[row.chatId]).map(row => [row.chatId, { capabilityId: capability.id, hasOriginal: true, running: false, step: 0 }])) }));
      setChats(previous => [...previous, ...serverItems.filter(row => !previous.some(chat => chat.id === row.conversationId)).map(row => fromMessages(row.conversationId, `${capability.name} · ${new Date(row.createdAt).toLocaleString()}`, [], status === 'archived' ? '已归档' : '原对话'))]);
      setDetails(previous => ({ ...previous, ...Object.fromEntries(serverItems.filter(row => !previous[row.conversationId]).map(row => [row.conversationId, { capabilityId: capability.id, running: false, step: 0,
        native: { conversationId: row.conversationId, scene, turn: null, result: null, historical: true, phase: 'result' } }])) }));
    } catch { if (selected()) setNotice('原对话当前不可读取。'); }
  }
  async function openNative(conversationId: string, capabilityCode: NativeScene) {
    if (!current()) return; const item = permitted.find(item => item.nativeScene === capabilityCode); if (!item) return;
    cancel(); const abort = new AbortController(); request.current = abort;
    try {
      const existing = refs.current.threads.find(thread => thread.id === conversationId || thread.native?.conversationId === conversationId);
      const chatId = existing?.id ?? native.locatorsSnapshot().find(row => row.conversationId === conversationId)?.chatId ?? conversationId;
      const frame = await native.open(chatId, conversationId, capabilityCode, abort.signal); if (!current() || abort.signal.aborted) return;
      const key = `${chatId}:${frame.turn?.admissionKey ?? 'unobserved'}`, nodeId = replies.current.get(key) ?? `original:${key}`;
      replies.current.set(key, nodeId);
      setChats(previous => {
        const chat = previous.find(value => value.id === chatId) ?? fromMessages(chatId, item.name, [], '原对话');
        const updated = chat.nodes.some(node => node.id === nodeId)
          ? updateNode(chat, nodeId, { content: nativeResultText(frame), error: undefined, status: 'done' })
          : appendNode(chat, { id: nodeId, parent: visibleMessages(chat).at(-1)?.id ?? ROOT, role: 'assistant', content: nativeResultText(frame), status: 'done' });
        return previous.some(value => value.id === chatId) ? previous.map(value => value.id === chatId ? updated : value) : [updated, ...previous];
      });
      setDetails(previous => ({ ...previous, [chatId]: { ...previous[chatId], capabilityId: item.id, native: frame, hasOriginal: true, running: false, step: 0 } }));
      lastConversation.current.set(item.id, chatId); setActiveId(chatId); setView('chat'); setNotice('');
    } catch { if (current() && !abort.signal.aborted) setNotice('原对话不可读取，未启动任务。'); }
    finally { if (request.current === abort) request.current = null; }
  }
  const canSend = (text: string) => {
    if (!current() || !enabled) return false;
    if (scene === 'quote_clarification' && !validateAiQuoteGoalInputDraft({ kind: 'quote_goal',
      draftVersion: AI_QUOTE_GOAL_DRAFT_VERSION, goalText: text })) {
      setNotice('请填写不超过4096字的租赁需求，消息仍保留在输入框。'); return false;
    }
    try {
      const readyForNext = active.native?.readyForNext && native.frame(activeId)?.readyForNext;
      if (!readyForNext && (active.native || active.hasOriginal || native.hasOriginal(activeId)) || native.locatorsSnapshot().some(row => row.pending)) {
        setNotice('当前轮次已受理或原结果待核对。新输入仍保留在输入框，请先核对原结果，并在工作区补充条件或确认。'); return false;
      }
    } catch { setNotice('原操作定位不可读取，消息仍保留在输入框。'); return false; }
    if (scene === 'order_explanation' && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(orderId.trim())) { setNotice('请先在工作区填写真实订单编号。消息仍保留在输入框。'); return false; }
    if (scene === 'order_explanation' && !orderQuestion) { setNotice('请先在工作区明确选择本次订单问题。消息仍保留在输入框。'); return false; }
    if (scene === 'opening_diagnosis' && !openingSections.length) { setNotice('请先在工作区选择要检查的分区。消息仍保留在输入框。'); return false; }
    return !!text.trim();
  };
  const respond = async function* (messages: Parameters<ChatRespond>[0], { signal, chatId }: Parameters<ChatRespond>[1],
    visible?: LiveVisibleObservationSession | null) {
    const targetId = chatId ?? activeId, target = refs.current.threads.find(thread => thread.id === targetId);
    if (!scene || !enabled || !current() || target?.capabilityId !== capability.id || targetId !== refs.current.activeId) throw Error('AI_SCOPE_CHANGED');
    const latest = messages.filter(message => message.role === 'user').at(-1); if (latest?.attachments?.length) throw Error('此入口尚未开放附件上传，请使用原识别入口。');
    const abort = new AbortController(); request.current = abort; const cancelRead = () => abort.abort(); signal.addEventListener('abort', cancelRead, { once: true }); if (signal.aborted) abort.abort();
    setDetails(previous => ({ ...previous, [targetId]: { ...previous[targetId], running: true } }));
    try { const original = target?.native;
      // A composer message always means new input. Original reads have their
      // own action and may never masquerade as the answer to this message.
      const readyForNext = original?.readyForNext && native.frame(targetId)?.readyForNext;
      if (!readyForNext && (original || target?.hasOriginal || native.hasOriginal(targetId))) throw Error('新输入未发送，请读取原结果。');
      const frame = await native.send({ chatId: targetId, scene, text: latest?.content ?? '', orderId: orderId.trim(), question: orderQuestion || undefined, sections: openingSections }, abort.signal, visible);
      if (!current() || abort.signal.aborted) throw Error('AI_SCOPE_CHANGED');
      setChats(previous => previous.map(chat => chat.id === targetId && chat.title === '新对话' ? { ...chat, title: latest?.content.slice(0, 26) ?? capability.name } : chat));
      yield { type: 'text' as const, delta: nativeResultText(frame) };
    } finally { signal.removeEventListener('abort', cancelRead); if (request.current === abort) request.current = null;
      if (alive.current) setDetails(previous => ({ ...previous, [targetId]: { ...previous[targetId], running: false } })); }
  };
  const visibleReference = (message: AiChatMessage): VisibleSourceReference | null => {
    if (!current() || refs.current.activeId !== activeId || message.role !== 'assistant') return null;
    const frame = native.frame(activeId), result = frame?.result;
    if (!frame?.turn || result?.status !== 'observed' || result.result.status !== 'available'
      || replies.current.get(`${activeId}:${frame.turn.admissionKey}`) !== message.id
      || message.content !== nativeResultText(frame)) return null;
    return { taskId: result.result.taskId, runId: result.result.runId,
      source: { kind: 'model_result', resultId: result.result.resultId } };
  };
  const resultChanged = (value: Awaited<ReturnType<typeof aiConversationsApi.currentResult>> | null) => {
    if (!current() || refs.current.activeId !== activeId) return;
    if (!value) { withdraw('原结果当前不可读取，请重新核对原请求。'); return; }
    const frame = native.frame(activeId), previous = frame?.result;
    if (!frame || value.conversationId !== frame.conversationId || value.admissionKey !== frame.turn?.admissionKey) return;
    if (value.status === previous?.status && (value.status !== 'observed' || previous.status === 'observed'
      && value.result.status === previous.result.status && value.result.runId === previous.result.runId
      && value.result.resultId === previous.result.resultId && value.result.text?.value === previous.result.text?.value)) return;
    void readOriginal(activeId);
  };
  return { permitted, available, disabled, togglePlugin: (capabilityId: string, next: boolean) => { if (!next && capability.id === capabilityId) cancel(); setDisabled(previous => next ? previous.filter(item => item !== capabilityId) : [...new Set([...previous, capabilityId])]); },
    chats, setChats, objectUrls, activeId, queuedPrompt, setQueuedPrompt, respond, visibleReference, resultChanged,
    retract: () => withdraw('当前权限或来源已变化，请重新核对原请求。'), canSend, history, historyPage: historyPage?.scene === scene ? historyPage : null, openNative, readOriginal, identity, current, notice, orderId, setOrderId, orderQuestion, setOrderQuestion, openingSections, setOpeningSections, native,
    registerReply: (chatId: string, nodeId: string) => { startingReply.current.set(chatId, nodeId); },
    retryOriginal: (nodeId: string) => {
      const key = `${activeId}:${active.native?.turn?.admissionKey ?? 'unobserved'}`;
      if (replies.current.get(key) === nodeId || startingReply.current.get(activeId) === nodeId) void readOriginal();
      else setNotice('此回复属于历史分支；请从最近对话核对原记录，不会重新派发。');
    },
    capabilityThreads: threads.filter(thread => thread.capabilityId === capability.id), threads, active, capability, enabled, view,
    setView: (next: OperatorView) => { if (next !== view) cancel(); setView(next); },
    createConversation, selectConversation, openConversation: selectConversation, chooseCapability, cancel,
    confirm: () => false, confirmConversation: (_id: string, _run?: string) => false, requestConversationChanges: (_id: string, _run: string | undefined, _note: string) => false,
  };
}
type OperatorState = ReturnType<typeof useOperatorState>;
const OperatorContext = createContext<OperatorState | null>(null);
function ScopedOperatorProvider({ children }: { children: ReactNode }) { const state = useOperatorState(); return <OperatorContext.Provider value={state}>{children}</OperatorContext.Provider>; }
export function OperatorProvider({ children }: { children: ReactNode }) { const auth = useAuthStore(); return <ScopedOperatorProvider key={consoleOwner(auth)}>{children}</ScopedOperatorProvider>; }
export function useOperator() { const value = useContext(OperatorContext); if (!value) throw Error('OperatorProvider required'); return value; }
