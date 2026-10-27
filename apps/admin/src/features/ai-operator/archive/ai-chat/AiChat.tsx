import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, FileText, Plus, Pencil, RotateCcw, Search, Sparkles, Square, SquarePen, ThumbsDown, ThumbsUp, X, AlertCircle, Zap } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import { ToolCall } from './ToolCall';
import { BrandMark } from '../shared/BrandMark';
import { appendNode, applyEvent, fromMessages, ROOT, uid, updateNode, visibleMessages, type AiChatHistoryItem, type AiChatMessage, type ChatAttachment, type ChatConversation, type ChatModel, type ChatNode, type ChatRespond } from './chat-state';
import { demoHistory, demoModels, makeDemoChats, sampleResponder } from './chat-demo';
import './chat.css';

export type { AiChatHistoryItem, AiChatMessage, ChatAttachment, ChatModel, ChatRespond, ChatSource, ChatStreamEvent, ChatTool } from './chat-state';
export { sampleResponder } from './chat-demo';
export type ChatSuggestion = { label: string; prompt?: string; icon?: 'database' | 'timer' | 'activity' | 'search' };
export type AiChatProps = {
  respond?: ChatRespond; initialMessages?: AiChatMessage[]; history?: AiChatHistoryItem[];
  models?: ChatModel[]; defaultModel?: string; title?: string; autoPlay?: boolean;
  suggestions?: ChatSuggestion[]; greeting?: string; placeholder?: string;
  onFeedback?: (message: AiChatMessage, value: 'up' | 'down' | null) => void;
  onModelChange?: (model: ChatModel) => void; onNewChat?: () => void;
  className?: string; style?: CSSProperties;
  store?: { chats: ChatConversation[]; setChats: Dispatch<SetStateAction<ChatConversation[]>>; activeId: string; objectUrls?: { current: string[] }; setActiveId: (id: string) => void };
  headerActions?: ReactNode; disabled?: boolean;
  queuedPrompt?: { id: string; text: string; chatId: string } | null;
  onQueuedPromptUsed?: () => void;
};
const defaultSuggestions: ChatSuggestion[] = [
  { label: 'Plan a schema change', prompt: 'How can we safely change a database schema?', icon: 'database' },
  { label: 'Prepare a release', prompt: 'Help me prepare a release checklist.', icon: 'activity' },
  { label: 'Explore an idea', prompt: 'Help me turn a new product idea into a small first version.', icon: 'search' },
];
function ModelMark({ model }: { model?: ChatModel }) {
  return model?.brand ? <BrandMark brand={model.brand} size={17} className="chat-model-mark" /> : <Sparkles className="chat-model-mark" size={17} strokeWidth={1.65} style={{ color: model?.color ?? 'currentColor' }} aria-hidden="true" />;
}
function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
function Fold({ label, children, busy = false }: { label: string; children: React.ReactNode; busy?: boolean }) {
  const id = useId(); const [open, setOpen] = useState(false);
  return <div className={`chat-fold ${open ? 'is-open' : ''}`}><button type="button" className={`chat-fold-trigger ${busy ? 'chat-shimmer' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{label}<ChevronRight size={13} /></button><div className="chat-fold-grid" inert={!open}><div id={id}>{children}</div></div></div>;
}
const MessageTurn = memo(function MessageTurn({ message, siblings, onVersion, onEdit, onRetry, onCopy, onFeedback, busy }: {
  message: ChatNode; siblings: ChatNode[]; onVersion: (message: ChatNode) => void; onEdit: (message: ChatNode, text: string) => void;
  onRetry: (message: ChatNode) => void; onCopy: (text: string) => void; onFeedback: (message: ChatNode, value: 'up' | 'down') => void; busy: boolean;
}) {
  const [editing, setEditing] = useState(false), [edit, setEdit] = useState(message.content);
  const editButton = useRef<HTMLButtonElement>(null);
  const cancelEdit = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const index = siblings.findIndex(item => item.id === message.id);
  const streaming = ['thinking', 'streaming'].includes(message.status ?? '');
  const saveEdit = () => { if (edit.trim()) { onEdit(message, edit.trim()); setEditing(false); } };
  return <article className={`chat-turn is-${message.role}`} aria-label={message.role === 'user' ? '我的消息' : `${message.model?.name ?? '助手'} 回复`} aria-busy={streaming}>
    {editing ? <div className="chat-edit"><textarea aria-label="编辑消息" autoFocus value={edit} onChange={event => setEdit(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); cancelEdit(); }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); saveEdit(); }
    }} /><div><button onClick={cancelEdit}>取消</button><button onClick={saveEdit} disabled={!edit.trim()}>保存并发送</button></div></div> : <>
      {message.role === 'user' ? <div className="chat-user-body"><div className="chat-bubble"><ChatMarkdown content={message.content} onCopy={onCopy} />
        {!!message.attachments?.length && <div className="chat-attachments">{message.attachments.map(file => <span className="chat-file" key={file.id}>{file.preview ? <img src={file.preview} alt="" /> : <FileText size={15} />}<span>{file.name}</span></span>)}</div>}
      </div></div> : <div className="chat-assistant-body">
        <div className="chat-reasoning"><ModelMark model={message.model} /><Fold label={message.status === 'thinking' && !message.thoughtFor ? '整理资料中' : `执行摘要 · ${message.thoughtFor ?? 1}秒`} busy={message.status === 'thinking' && !message.thoughtFor}><p>{message.reasoning || '正在整理本地示例…'}</p></Fold></div>
        {!!message.tools?.length && <div className="chat-tools">{message.tools.map(tool => <ToolCall key={tool.id} tool={tool} />)}</div>}
        <ChatMarkdown content={message.content} sources={message.sources} streaming={message.status === 'streaming'} onCopy={onCopy} />
        {message.status === 'stopped' && <p className="chat-state-label">已停止</p>}
        {message.status === 'error' && <div className="chat-error" role="alert"><AlertCircle size={16} /><div><strong>回复失败</strong><p>{message.error}</p><button onClick={() => onRetry(message)}>重试</button></div></div>}
      </div>}
      <div className="chat-turn-actions">
        {siblings.length > 1 && <div className="chat-versions" role="group" aria-label={`Version ${index + 1} of ${siblings.length}`}><button aria-label="上一版本" disabled={index === 0 || busy} onClick={() => onVersion(siblings[index - 1])}><ChevronLeft size={13} /></button><span>{index + 1} / {siblings.length}</span><button aria-label="下一版本" disabled={index === siblings.length - 1 || busy} onClick={() => onVersion(siblings[index + 1])}><ChevronRight size={13} /></button></div>}
        {!streaming && <><button aria-label={message.role === 'user' ? '复制消息' : '复制回复'} title="复制" onClick={() => onCopy(message.content)}><Copy size={14} /></button>
          {message.role === 'user' ? <button ref={editButton} aria-label="编辑消息" title="编辑" disabled={busy} onClick={() => { setEdit(message.content); setEditing(true); }}><Pencil size={14} /></button>
            : <><button aria-label="重试回复" title="重试" disabled={busy} onClick={() => onRetry(message)}><RotateCcw size={14} /></button><button aria-label="有帮助" title="有帮助" aria-pressed={message.feedback === 'up'} onClick={() => onFeedback(message, 'up')}><ThumbsUp size={14} /></button><button aria-label="无帮助" title="无帮助" aria-pressed={message.feedback === 'down'} onClick={() => onFeedback(message, 'down')}><ThumbsDown size={14} /></button></>}
        </>}
      </div>
    </>}
  </article>;
});

export function AiChat({ respond, initialMessages, history, models = demoModels, defaultModel, title, autoPlay = !respond && !initialMessages && !history, suggestions = defaultSuggestions, greeting = 'What are we working on?', placeholder = 'Ask anything', onFeedback, onModelChange, onNewChat, className = '', style, store, headerActions, disabled = false, queuedPrompt, onQueuedPromptUsed }: AiChatProps) {
  const availableModels = models.length ? models : demoModels;
  const [localChats, setLocalChats] = useState<ChatConversation[]>(() => {
    if (initialMessages) return [fromMessages('initial', title ?? 'Conversation', initialMessages), ...(history ?? []).map(item => fromMessages(item.id, item.title, item.messages, item.group))];
    if (respond || history) return (history ?? []).map(item => fromMessages(item.id, item.title, item.messages, item.group));
    const samples = makeDemoChats();
    if (autoPlay) samples[0] = fromMessages(samples[0].id, samples[0].title, demoHistory[0].messages.slice(0, 1), samples[0].group);
    return samples;
  });
  const [localActiveId, setLocalActiveId] = useState<string | null>(() => initialMessages ? 'initial' : respond ? history?.[0]?.id ?? null : (history ?? demoHistory)[0]?.id ?? null);
  const chats = store ? store.chats : localChats;
  const setChats = store?.setChats ?? setLocalChats;
  const activeId = store ? store.activeId : localActiveId;
  const setActiveId = (id: string | null) => { if (store) { if (id) store.setActiveId(id); } else setLocalActiveId(id); };
  const reducedMotion = usePrefersReducedMotion();
  const [model, setModel] = useState(availableModels.find(item => item.id === defaultModel) ?? availableModels[0]);
  useEffect(() => { setModel(previous => availableModels.find(item => item.id === previous.id) ?? availableModels.find(item => item.id === defaultModel) ?? availableModels[0]); }, [models, defaultModel]);
  const [draft, setDraft] = useState(''), [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [menu, setMenu] = useState<'chats' | 'models' | null>(null), [announcement, setAnnouncement] = useState('Local demo · sample responses');
  const [request, setRequest] = useState<{ chat: string; node: string } | null>(null), [atBottom, setAtBottom] = useState(true);
  const controller = useRef<AbortController | null>(null), root = useRef<HTMLElement>(null), thread = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), files = useRef<HTMLInputElement>(null);
  const chatsButton = useRef<HTMLButtonElement>(null), modelsButton = useRef<HTMLButtonElement>(null);
  const scrollPositions = useRef<Record<string, number>>({}), follow = useRef(true), localObjectUrls = useRef<string[]>([]), currentChats = useRef(chats);
  const objectUrls = store?.objectUrls ?? localObjectUrls;
  const followingFrame = useRef(0), autoScrolling = useRef(false);
  const playback = useRef(false);
  const menuId = useId();
  currentChats.current = chats;
  const chat = chats.find(item => item.id === activeId);
  const messages = chat ? visibleMessages(chat) : [];
  const busy = !!request;
  const mutate = useCallback((id: string, update: (value: ChatConversation) => ChatConversation) => setChats(previous => previous.map(value => value.id === id ? update(value) : value)), []);
  const stop = useCallback(() => {
    playback.current = false;
    if (controller.current) {
      controller.current.abort(); controller.current = null;
      setChats(previous => previous.map(value => ({ ...value, nodes: value.nodes.map(node => node.status === 'thinking' || node.status === 'streaming' ? { ...node, status: 'stopped' as const } : node) })));
      setAnnouncement('回复已停止');
    }
    setRequest(null);
  }, []);
  useEffect(() => () => { controller.current?.abort(); if (!store?.objectUrls) objectUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!menu) return;
    const click = (event: PointerEvent) => { if (!root.current?.querySelector(`[data-chat-menu="${menu}"]`)?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener('pointerdown', click);
    root.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', click);
  }, [menu]);
  useLayoutEffect(() => {
    const element = composer.current;
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 160)}px`; }
  }, [draft]);
  useEffect(() => { setDraft(''); setAttachments([]); setMenu(null); }, [activeId]);
  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    element.scrollTop = activeId ? scrollPositions.current[activeId] ?? element.scrollHeight : 0;
    follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAtBottom(follow.current);
  }, [activeId]);
  useEffect(() => {
    if (!thread.current) return;
    const element = thread.current;
    const advance = () => {
      followingFrame.current = 0;
      if (!follow.current) { autoScrolling.current = false; return; }
      const target = element.scrollHeight - element.clientHeight;
      const distance = target - element.scrollTop;
      autoScrolling.current = true;
      element.scrollTop = Math.abs(distance) < 1 || reducedMotion ? target : element.scrollTop + distance * .3;
      if (Math.abs(target - element.scrollTop) > 1) followingFrame.current = requestAnimationFrame(advance);
      else { autoScrolling.current = false; setAtBottom(true); }
    };
    const observer = new ResizeObserver(() => { if (follow.current && !followingFrame.current) followingFrame.current = requestAnimationFrame(advance); });
    const column = element.firstElementChild;
    if (column) observer.observe(column);
    return () => { observer.disconnect(); cancelAnimationFrame(followingFrame.current); followingFrame.current = 0; autoScrolling.current = false; };
  }, [activeId, reducedMotion]);

  const run = useCallback(async (targetChat: ChatConversation, parent: string, context: AiChatMessage[], chosenModel: ChatModel) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const id = uid();
    mutate(targetChat.id, value => appendNode(value, { id, parent, role: 'assistant', content: '', model: chosenModel, status: 'thinking', tools: [], sources: [] }));
    setRequest({ chat: targetChat.id, node: id });
    setAnnouncement(`${chosenModel.name} is replying${respond ? '' : ' (simulated)'}`);
    follow.current = true;
    try {
      for await (const event of (respond ?? sampleResponder)(context, { signal: abort.signal, model: chosenModel, chatId: targetChat.id })) {
        if (abort.signal.aborted || controller.current !== abort) break;
        mutate(targetChat.id, value => {
          const message = value.nodes.find(node => node.id === id);
          return message ? updateNode(value, id, applyEvent(message, event)) : value;
        });
        if (event.type === 'error') break;
      }
      mutate(targetChat.id, value => {
        const message = value.nodes.find(node => node.id === id);
        return message?.status === 'error' ? value : updateNode(value, id, { status: abort.signal.aborted ? 'stopped' : 'done' });
      });
      if (controller.current === abort) setAnnouncement(abort.signal.aborted ? '回复已停止' : `Reply finished${respond ? '' : ' (simulated)'}`);
    } catch (error) {
      const stopped = abort.signal.aborted;
      mutate(targetChat.id, value => updateNode(value, id, { status: stopped ? 'stopped' : 'error', error: stopped ? undefined : error instanceof Error ? error.message : 'Unable to complete this reply.' }));
      if (controller.current === abort) setAnnouncement(stopped ? '回复已停止' : 'Reply failed');
    } finally {
      if (controller.current === abort) { controller.current = null; setRequest(null); }
    }
  }, [mutate, respond]);
  useEffect(() => {
    if (!autoPlay || !root.current) return;
    let played = false;
    const observer = new IntersectionObserver(entries => {
      if (played || !entries.some(entry => entry.isIntersecting)) return;
      played = true; observer.disconnect();
      const opening = currentChats.current.find(value => value.id === activeId);
      const path = opening ? visibleMessages(opening) : [];
      if (opening && path.at(-1)?.role === 'user') {
        playback.current = true;
        void (async () => {
          await run(opening, path.at(-1)!.id, path, model);
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          if (!playback.current) return;
          const current = currentChats.current.find(value => value.id === opening.id);
          const visible = current ? visibleMessages(current) : [];
          const followUp = demoHistory[0].messages[2];
          if (!current || !followUp || visible.at(-1)?.status !== 'done') return;
          const user: ChatNode = { ...followUp, parent: visible.at(-1)!.id };
          const updated = appendNode(current, user);
          mutate(current.id, () => updated);
          await run(updated, user.id, [...visible, user], model);
          playback.current = false;
        })();
      }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
    // Autoplay applies only to the initial conversation, never to a history switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const send = (text = draft) => {
    if (disabled || (!text.trim() && !attachments.length)) return;
    stop();
    let target = chat;
    if (!target) { target = fromMessages(uid(), text.trim().slice(0, 42) || 'Attachments', []); setChats(previous => [target!, ...previous]); setActiveId(target.id); }
    const path = visibleMessages(target);
    const user: ChatNode = { id: uid(), role: 'user', parent: path.at(-1)?.id ?? ROOT, content: text.trim(), attachments };
    mutate(target.id, value => appendNode(value, user));
    setDraft(''); setAttachments([]);
    void run(target, user.id, [...path, user], model);
    composer.current?.focus();
  };
  const consumedPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!queuedPrompt || queuedPrompt.chatId !== activeId || consumedPrompt.current === queuedPrompt.id) return;
    // Defer until the mount commits. StrictMode's rehearsal cleanup must not
    // abort the only copy of a queued automation demo before it can be retried.
    const frame = requestAnimationFrame(() => {
      consumedPrompt.current = queuedPrompt.id;
      send(queuedPrompt.text); onQueuedPromptUsed?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [queuedPrompt?.id, activeId]);
  const copy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); setAnnouncement('已复制'); }
    catch { setAnnouncement('Copy unavailable. Select the text and copy it manually.'); }
  }, []);
  const editMessage = (message: ChatNode, text: string) => {
    if (!chat) return;
    stop();
    const edited: ChatNode = { ...message, id: uid(), content: text };
    const updated = appendNode(chat, edited);
    mutate(chat.id, () => updated);
    const context = visibleMessages(updated);
    void run(updated, edited.id, context, model);
    composer.current?.focus();
  };
  const retry = (message: ChatNode) => {
    playback.current = false;
    if (!chat) return;
    const path = visibleMessages(chat), index = path.findIndex(item => item.id === message.id);
    void run(chat, message.parent, path.slice(0, index), model);
  };
  const pickVersion = (message: ChatNode) => {
    if (!chat) return;
    stop(); mutate(chat.id, value => ({ ...value, choices: { ...value.choices, [message.parent]: message.id } }));
    setAnnouncement('已切换消息版本');
  };
  const feedback = (message: ChatNode, value: 'up' | 'down') => {
    if (!chat) return;
    const next = message.feedback === value ? null : value;
    mutate(chat.id, item => updateNode(item, message.id, { feedback: next }));
    onFeedback?.(message, next);
    setAnnouncement(onFeedback ? 'Feedback recorded' : '评价已保存在本地');
  };
  const saveScroll = () => { if (activeId && thread.current) scrollPositions.current[activeId] = thread.current.scrollTop; };
  const switchChat = (id: string | null) => {
    saveScroll(); stop(); setActiveId(id); setMenu(null); setDraft(''); setAttachments([]); setAnnouncement(id ? 'Conversation opened' : '新对话');
    if (!id) onNewChat?.();
    composer.current?.focus();
  };
  const closeMenu = () => { const trigger = menu === 'chats' ? chatsButton : modelsButton; setMenu(null); trigger.current?.focus(); };
  return <section ref={root} className={`ai-chat ${className}`} aria-label="AI chat" style={style} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (menu) closeMenu(); else if (busy) stop(); }
  }}>
    <header className="chat-header">
      <div className="chat-menu-anchor" data-chat-menu="chats"><button ref={chatsButton} className="chat-title-button" aria-label={`最近对话，当前：${chat?.title ?? '新对话'}`} aria-expanded={menu === 'chats'} aria-haspopup="menu" aria-controls={menu === 'chats' ? menuId : undefined} onClick={() => setMenu(menu === 'chats' ? null : 'chats')}><span>{chat?.title ?? '新对话'}</span><ChevronDown size={13} /></button>
        {menu === 'chats' && <div id={menuId} className="chat-menu chat-history-menu" role="menu" aria-label="最近对话" onKeyDown={menuKeys}><button role="menuitem" onClick={() => switchChat(null)}><SquarePen size={16} />新对话</button><div className="chat-menu-divider" role="separator" />{[...new Set(chats.map(item => item.group ?? '今天'))].map(group => <div role="group" aria-label={group} key={group}><span className="chat-menu-label">{group}</span>{chats.filter(item => (item.group ?? '今天') === group).map(item => <button type="button" key={item.id} role="menuitemradio" aria-checked={item.id === activeId} onClick={() => switchChat(item.id)}><span>{item.title}</span>{item.id === activeId && <Check size={14} />}</button>)}</div>)}</div>}
      </div>
      <div className="chat-header-end">{headerActions}<button className="chat-icon" aria-label="新对话" title="新对话" onClick={() => switchChat(null)}><SquarePen size={18} /></button></div>
    </header>
    <div className="chat-thread-wrap"><div ref={thread} className="chat-thread" role="region" aria-label="对话记录" tabIndex={0} onWheel={event => { if (event.deltaY < 0) { follow.current = false; autoScrolling.current = false; } }} onTouchStart={() => { follow.current = false; autoScrolling.current = false; }} onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { follow.current = false; autoScrolling.current = false; } }} onScroll={() => {
      const element = thread.current!;
      if (!autoScrolling.current) { follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; setAtBottom(follow.current); }
      saveScroll();
    }}><div className="chat-column" key={activeId ?? 'empty'}>{messages.length ? messages.map(message => <MessageTurn key={message.id} message={message} siblings={chat!.nodes.filter(item => item.parent === message.parent && item.role === message.role)} onVersion={pickVersion} onEdit={editMessage} onRetry={retry} onCopy={copy} onFeedback={feedback} busy={busy} />)
      : <div className="chat-empty"><h2>{greeting}</h2><div className="chat-suggestions">{suggestions.slice(0, 3).map(suggestion => <button key={suggestion.label} onClick={() => send(suggestion.prompt ?? suggestion.label)}>{suggestion.icon === 'database' ? <Database size={17} /> : suggestion.icon === 'search' ? <Search size={17} /> : <Zap size={17} />}<span>{suggestion.label}</span><ArrowUp size={14} /></button>)}</div></div>}</div></div>
      {!atBottom && messages.length > 0 && <button className="chat-jump" aria-label="回到最新消息" onClick={() => { follow.current = true; thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reducedMotion ? 'instant' : 'smooth' }); }}><ArrowDown size={16} /></button>}
    </div>
    <div className="chat-composer-wrap"><form className="chat-composer" onSubmit={event => { event.preventDefault(); send(); }}>
      {!!attachments.length && <div className="chat-attachments">{attachments.map(file => <span key={file.id} className="chat-file">{file.preview ? <img src={file.preview} alt="" /> : <FileText size={16} />}<span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(previous => previous.filter(item => item.id !== file.id))}><X size={13} /></button></span>)}</div>}
      <div className="chat-input-row"><textarea ref={composer} rows={2} disabled={disabled} aria-label="消息" placeholder={placeholder} value={draft} onChange={event => { playback.current = false; setDraft(event.target.value); }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
      }} /></div><div className="chat-composer-toolbar"><button type="button" className="chat-icon" aria-label="添加附件" title="附件仅保存在本地" disabled={disabled} onClick={() => files.current?.click()}><Plus size={20} /></button><span className="chat-composer-scope">本地演示</span><div className="chat-composer-end"><div className="chat-menu-anchor" data-chat-menu="models"><button type="button" ref={modelsButton} className="chat-model-button" aria-label={`模型：${model.name}`} aria-expanded={menu === 'models'} aria-haspopup="menu" aria-controls={menu === 'models' ? menuId : undefined} onClick={() => setMenu(menu === 'models' ? null : 'models')}><ModelMark model={model} /><span>{model.name}</span><ChevronDown size={12} /></button>
        {menu === 'models' && <div id={menuId} className="chat-menu chat-model-menu" role="menu" aria-label="模型" onKeyDown={menuKeys}><span className="chat-menu-label">选择模型 · 本地演示</span>{availableModels.map(item => <button type="button" key={item.id} role="menuitemradio" aria-checked={item.id === model.id} onClick={() => { setModel(item); setMenu(null); onModelChange?.(item); setAnnouncement(`${item.name} selected`); modelsButton.current?.focus(); }}><ModelMark model={item} /><span><strong>{item.name}</strong><small>{item.note}</small></span>{item.id === model.id && <Check size={14} />}</button>)}</div>}
      </div><button className="chat-send" type={busy ? 'button' : 'submit'} aria-label={busy ? '停止回复' : '发送消息'} disabled={disabled || (!busy && !draft.trim() && !attachments.length)} onClick={busy ? stop : undefined}>{busy ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} />}</button></div></div>
      <input ref={files} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose attachments" onChange={event => {
        const picked = [...(event.target.files ?? [])].map(file => {
          const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
          if (preview) objectUrls.current.push(preview);
          return { id: uid(), name: file.name, size: file.size, type: file.type, preview };
        });
        setAttachments(previous => [...previous, ...picked]); event.target.value = ''; setAnnouncement('Files attached locally. Nothing uploaded.');
      }} />
    </form><div className="chat-notice">{disabled ? '请先在插件页启用此能力' : '本地演示 · 未连接模型与业务数据，附件不会上传'}</div></div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
  </section>;
}

export default AiChat;
