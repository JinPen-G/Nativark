import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { ArrowUp, Check, CircleAlert, FileText, PanelRightClose, RotateCcw, Square, X } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { samplePage, samplePanelRespond, sampleSuggestions } from './panel-demo';
import { applyPageChange, blockLabel, clonePage, undoPageChange, validateChange, wordCount, wordDiff, type AppliedChange, type PanelBlock, type PanelMessage, type PanelPage, type PanelRespond, type TableBlock } from './panel-state';
import './side-panel.css';

export type { PanelBlock, PanelChange, AppliedChange, PanelPage, PanelReply, PanelRequest, PanelRespond, ParagraphBlock, HeadingBlock, TableBlock } from './panel-state';
export type AiSidePanelProps = {
  page?: PanelPage; respond?: PanelRespond;
  onApply?: (change: AppliedChange, page: PanelPage) => void | Promise<unknown>;
  onUndo?: (change: AppliedChange, page: PanelPage) => void | Promise<unknown>;
  defaultOpen?: boolean; suggestions?: string[];
  assistant?: { name?: string; model?: string; mark?: ReactNode };
  className?: string; style?: CSSProperties;
};
function InlineDiff({ before, after }: { before: string; after: string }) {
  return <>{wordDiff(before, after).map((part, index) => part.kind === 'added' ? <ins key={index}>{part.text}</ins> : part.kind === 'removed' ? <del key={index}>{part.text}</del> : <Fragment key={index}>{part.text}</Fragment>)}</>;
}
function DataTable({ block, before }: { block: TableBlock; before?: TableBlock }) {
  const removedColumns = before?.columns.filter(column => !block.columns.includes(column)) ?? [];
  return <div className="asp-table-scroll"><table aria-label={block.label ?? 'Page table'}><thead><tr>{block.columns.map((column, index) => <th key={`${column}-${index}`} scope="col">{before && !before.columns.includes(column) ? <ins>{column}</ins> : column}</th>)}{removedColumns.map(column => <th key={column} scope="col"><del>{column}</del></th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => {
    const oldIndex = before?.columns.indexOf(block.columns[columnIndex]) ?? -1, oldCell = oldIndex >= 0 ? before?.rows[rowIndex]?.[oldIndex] : undefined;
    return <td key={columnIndex}>{!before ? cell : oldCell === undefined ? <ins>{cell}</ins> : <InlineDiff before={oldCell} after={cell} />}</td>;
  })}{removedColumns.map(column => <td key={column}><del>{before?.rows[rowIndex]?.[before.columns.indexOf(column)]}</del></td>)}</tr>)}{before?.rows.slice(block.rows.length).map((row, index) => <tr key={`removed-${index}`}>{block.columns.map(column => <td key={column}><del>{row[before.columns.indexOf(column)]}</del></td>)}</tr>)}</tbody></table></div>;
}
const PageBlock = memo(function PageBlock({ block, highlighted }: { block: PanelBlock; highlighted: boolean }) {
  return <div data-block-id={block.id} className={`asp-block is-${block.type} ${highlighted ? 'is-highlighted' : ''}`}>
    {block.type === 'table' ? <DataTable block={block} /> : block.type === 'heading' ? block.level === 3 ? <h3>{block.text}</h3> : <h2>{block.text}</h2> : <p>{block.text}</p>}
  </div>;
});
function changeDescription(change: AppliedChange) {
  if (change.after.type === 'table' && change.before.type === 'table') {
    const before = change.before;
    const added = change.after.columns.filter(column => !before.columns.includes(column));
    return added.length ? `Adds ${added.join(', ')} column` : 'Updates table values';
  }
  return change.after.type !== 'table' && change.before.type !== 'table' ? `${wordCount(change.after.text)} words, was ${wordCount(change.before.text)}` : 'Proposed change';
}
const Reply = memo(function Reply({ message, name, applying, onAction, onRetry }: { message: PanelMessage; name: string; applying: string | null; onAction: (id: string, action: 'apply' | 'discard' | 'undo') => void; onRetry: (id: string) => void }) {
  const change = message.change, busy = message.status === 'reading' || message.status === 'streaming';
  return <article className="asp-turn" aria-label={`Question: ${message.prompt}`}>
    <div className="asp-user"><p>{message.prompt}</p>{message.selection && <span title={message.selection}><FileText size={11} />Selection</span>}</div>
    <div className="asp-answer" aria-busy={busy} aria-label={`${name} response`}>
      {message.status === 'reading' && <span className="asp-reading">Reading the page</span>}
      {!!message.text && <div className={`asp-markdown ${message.status === 'streaming' ? 'is-streaming' : ''}`}><Markdown>{message.text}</Markdown></div>}
      {message.status === 'stopped' && <p className="asp-state"><Square size={12} />Stopped</p>}
      {message.status === 'error' && <div className="asp-error" role="alert"><CircleAlert size={15} /><div><strong>{name} did not respond</strong><p>{message.error}</p><button onClick={() => onRetry(message.id)}><RotateCcw size={12} />Retry</button></div></div>}
      {change && message.status === 'done' && <section className="asp-change" aria-label={`Proposed change to ${blockLabel(change.after)}`}>
        <header><strong>{blockLabel(change.after)}</strong><span>{changeDescription(change)}</span></header>
        <div className="asp-change-body">{change.after.type === 'table' && change.before.type === 'table' ? <DataTable block={change.after} before={change.before} /> : change.after.type !== 'table' && change.before.type !== 'table' ? <p><InlineDiff before={change.before.text} after={change.after.text} /></p> : null}</div>
        <footer>{message.changeStatus === 'applied' ? <span className="asp-state is-applied"><Check size={13} />Applied to the page</span> : message.changeStatus === 'discarded' ? <span className="asp-state"><X size={13} />Discarded</span> : <><span className="asp-state">{message.changeStatus === 'undone' && <><RotateCcw size={12} />Undone</>}</span><div><button disabled={!!applying} onClick={() => onAction(message.id, 'discard')}>Discard</button><button className="asp-primary" data-apply-id={message.id} disabled={!!applying} onClick={() => onAction(message.id, 'apply')}>{applying === message.id ? 'Applying…' : 'Apply'}</button></div></>}</footer>
        {message.actionError && <p className="asp-action-error" role="alert">{message.actionError}</p>}
      </section>}
    </div>
  </article>;
});

export function AiSidePanel({ page, respond, onApply, onUndo, defaultOpen = true, suggestions = sampleSuggestions, assistant, className = '', style }: AiSidePanelProps) {
  const [document, setDocument] = useState(() => clonePage(page ?? samplePage)), [messages, setMessages] = useState<PanelMessage[]>([]), [open, setOpen] = useState(defaultOpen), [narrow, setNarrow] = useState(false);
  const [draft, setDraft] = useState(''), [selection, setSelection] = useState<string | undefined>(), [selectionPrompt, setSelectionPrompt] = useState<{ text: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false), [applying, setApplying] = useState<string | null>(null), [highlight, setHighlight] = useState<string | null>(null), [announcement, setAnnouncement] = useState('');
  const root = useRef<HTMLDivElement>(null), article = useRef<HTMLElement>(null), thread = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), reopen = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null), currentPage = useRef(document), currentMessages = useRef(messages), inputPage = useRef(page), version = useRef(0), actionLock = useRef(false), live = useRef(true), frame = useRef(0), follow = useRef(true), highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlers = useRef({ respond, onApply, onUndo }); handlers.current = { respond, onApply, onUndo };
  const name = assistant?.name ?? 'Assistant', model = assistant?.model ?? 'Claude Sonnet 5.5';
  const panelId = useId();
  const scrolling = useRef(false);
  currentPage.current = document; currentMessages.current = messages;
  const setPage = useCallback((next: PanelPage) => { currentPage.current = next; setDocument(next); }, []);
  const editMessage = useCallback((id: string, patch: Partial<PanelMessage>) => setMessages(previous => previous.map(message => message.id === id ? { ...message, ...patch } : message)), []);
  const stop = useCallback(() => { const active = controller.current; if (!active) return; active.abort(); controller.current = null; setBusy(false); setMessages(previous => previous.map(message => ['reading', 'streaming'].includes(message.status) ? { ...message, status: 'stopped', change: undefined } : message)); setAnnouncement('Stopped. The page was not changed.'); }, []);
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); cancelAnimationFrame(frame.current); if (highlightTimer.current) clearTimeout(highlightTimer.current); }; }, []);
  useEffect(() => {
    if (page === inputPage.current) return;
    inputPage.current = page; version.current++; stop(); actionLock.current = false; setApplying(null); setPage(clonePage(page ?? samplePage)); setMessages([]); setSelection(undefined); setDraft(''); setHighlight(null); setAnnouncement('Page changed. Previous suggestions were cleared.');
  }, [page, setPage, stop]);
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => setNarrow(entries[0].contentRect.width < 640)); observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (open && narrow) requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true })); }, [open, narrow]);
  useLayoutEffect(() => { const element = composer.current; if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 150)}px`; } }, [draft]);
  useLayoutEffect(() => {
    if (!follow.current || !thread.current) return;
    cancelAnimationFrame(frame.current);
    const animate = () => {
      const element = thread.current; if (!element || !follow.current) return;
      const delta = element.scrollHeight - element.clientHeight - element.scrollTop;
      scrolling.current = true;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(delta) < 1) { element.scrollTop = element.scrollHeight; requestAnimationFrame(() => { scrolling.current = false; }); return; }
      element.scrollTop += delta * .3; frame.current = requestAnimationFrame(animate);
    };
    frame.current = requestAnimationFrame(animate);
  }, [messages, open]);
  const inspectSelection = useCallback(() => {
    const selected = window.getSelection();
    if (!selected || !selected.rangeCount || selected.isCollapsed || !article.current?.contains(selected.anchorNode) || !article.current.contains(selected.focusNode)) { setSelectionPrompt(null); return; }
    const text = selected.toString().trim(); if (!text) { setSelectionPrompt(null); return; }
    const bounds = selected.getRangeAt(0).getBoundingClientRect(), area = root.current!.getBoundingClientRect();
    setSelectionPrompt({ text, x: Math.max(8, Math.min(bounds.left - area.left, area.width - 180)), y: Math.max(8, Math.min(bounds.top - area.top - 38, area.height - 44)) });
  }, []);
  useEffect(() => { window.document.addEventListener('selectionchange', inspectSelection); return () => window.document.removeEventListener('selectionchange', inspectSelection); }, [inspectSelection]);
  const toggle = (next: boolean) => { setOpen(next); setSelectionPrompt(null); setAnnouncement(next ? `${name} opened` : `${name} closed`); requestAnimationFrame(() => next ? composer.current?.focus({ preventScroll: true }) : reopen.current?.focus({ preventScroll: true })); };
  const run = useCallback(async (id: string, prompt: string, context: string | undefined, snapshot: PanelPage) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const requestVersion = version.current;
    setBusy(true); follow.current = true; editMessage(id, { status: 'reading', text: '', change: undefined, error: undefined }); setAnnouncement('Reading the page');
    const valid = () => live.current && !abort.signal.aborted && controller.current === abort && version.current === requestVersion;
    const pause = (ms: number) => new Promise<void>((resolve, reject) => { if (abort.signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; } const cancel = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); }; const timer = setTimeout(() => { abort.signal.removeEventListener('abort', cancel); resolve(); }, ms); abort.signal.addEventListener('abort', cancel, { once: true }); });
    try {
      if (!handlers.current.respond) await pause(550);
      const reply = await (handlers.current.respond ?? samplePanelRespond)({ prompt, page: clonePage(snapshot), selection: context, signal: abort.signal });
      if (!valid()) return;
      const change = reply.change ? validateChange(snapshot, reply.change) : undefined;
      let text = ''; editMessage(id, { status: 'streaming' });
      if (typeof reply.text === 'string') {
        const chunks = reply.text.match(/(?:\S+\s*){1,5}|\s+/gu) ?? [reply.text];
        for (const chunk of chunks) { await pause(34); if (!valid()) return; text += chunk; editMessage(id, { text }); }
      } else if (reply.text && typeof reply.text[Symbol.asyncIterator] === 'function') {
        for await (const delta of reply.text) { if (!valid()) return; if (typeof delta !== 'string') throw new Error('The assistant returned an invalid text chunk.'); text += delta; editMessage(id, { text }); }
      } else throw new Error('The assistant returned no text.');
      if (!valid()) return;
      editMessage(id, { status: 'done', text, change, changeStatus: change ? 'proposed' : undefined });
      setAnnouncement(`Answer ready${change ? ` with a proposed change to ${blockLabel(change.after)}` : ''}${handlers.current.respond ? '' : ' (simulated)'}`);
    } catch (error) {
      if (!valid()) return;
      const message = error instanceof Error ? error.message : 'Please try again.';
      editMessage(id, { status: 'error', error: message, change: undefined }); setAnnouncement(`${name} did not respond. ${message}`);
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }, [editMessage, name]);
  const send = (prompt = draft) => {
    if (!prompt.trim() || controller.current) return;
    const id = crypto.randomUUID(), text = prompt.trim(), context = selection;
    setMessages(previous => [...previous, { id, prompt: text, selection: context, text: '', status: 'reading' }]); setDraft('');
    void run(id, text, context, clonePage(currentPage.current)); composer.current?.focus({ preventScroll: true });
  };
  const retry = useCallback((id: string) => { if (controller.current) return; const message = currentMessages.current.find(value => value.id === id); if (message) void run(id, message.prompt, message.selection, clonePage(currentPage.current)); }, [run]);
  const action = useCallback(async (id: string, type: 'apply' | 'discard' | 'undo') => {
    const message = currentMessages.current.find(value => value.id === id), change = message?.change;
    if (!message || !change || actionLock.current) return;
    if (type === 'discard') { if (message.changeStatus === 'applied') return; editMessage(id, { changeStatus: 'discarded', actionError: undefined }); setAnnouncement('Discarded. The page was not changed.'); composer.current?.focus(); return; }
    if (type === 'apply' && !['proposed', 'undone'].includes(message.changeStatus ?? '')) return;
    if (type === 'undo' && message.changeStatus !== 'applied') return;
    const actionVersion = version.current; actionLock.current = true; setApplying(id);
    try {
      const next = type === 'apply' ? applyPageChange(currentPage.current, change) : undoPageChange(currentPage.current, change);
      await handlers.current[type === 'apply' ? 'onApply' : 'onUndo']?.(structuredClone(change), clonePage(next));
      if (!live.current || version.current !== actionVersion) return;
      setPage(next); editMessage(id, { changeStatus: type === 'apply' ? 'applied' : 'undone', actionError: undefined }); setHighlight(change.blockId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlight(null), matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 1250);
      setAnnouncement(type === 'apply' ? `Applied. ${blockLabel(change.after)} updated. Undo is available.` : `Undone. ${blockLabel(change.before)} restored.`);
      requestAnimationFrame(() => {
        root.current?.querySelector<HTMLButtonElement>(type === 'apply' ? `[data-undo-id="${id}"]` : `[data-apply-id="${id}"]`)?.focus({ preventScroll: true });
        const changed = article.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(change.blockId)}"]`);
        if (changed && root.current && root.current.clientWidth >= 640) changed.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      });
    } catch (error) { if (live.current && version.current === actionVersion) { const message = error instanceof Error ? error.message : 'The change could not be saved.'; editMessage(id, { actionError: message }); setAnnouncement(message); } }
    finally { if (version.current === actionVersion) { actionLock.current = false; if (live.current) setApplying(null); } }
  }, [editMessage, setPage]);
  const used = new Set(messages.map(message => message.prompt)), remaining = suggestions.filter(prompt => !used.has(prompt));
  const applied = messages.filter(message => message.changeStatus === 'applied' && message.change);
  return <div ref={root} className={`ai-side-panel ${open ? 'is-open' : ''} ${narrow ? 'is-sheet' : ''} ${className}`} style={style} role="region" aria-label="AI side panel" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); toggle(false); }
    if (event.key === 'Tab' && narrow && open) {
      const controls = [...root.current!.querySelectorAll<HTMLElement>('.asp-panel button:not(:disabled), .asp-panel textarea:not(:disabled)')], first = controls[0], last = controls.at(-1);
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="asp-page-column" inert={narrow && open} aria-hidden={narrow && open ? true : undefined}>
      <div className="asp-page-scroll"><article ref={article} className="asp-document" aria-label={document.title} onPointerUp={inspectSelection} onKeyUp={inspectSelection}>
        <header><h1>{document.title}</h1>{document.meta && <p>{document.meta}</p>}</header>
        {document.blocks.map(block => <PageBlock key={block.id} block={block} highlighted={highlight === block.id} />)}
      </article></div>
      <button ref={reopen} className="asp-reopen" aria-label={`Open ${name}`} aria-expanded={open} aria-controls={panelId} tabIndex={open ? -1 : 0} aria-hidden={open ? true : undefined} onClick={() => toggle(true)}><BrandMark brand="anthropic" size={15} />{name}</button>
    </div>
    {selectionPrompt && !(narrow && open) && <button className="asp-selection-prompt" style={{ left: selectionPrompt.x, top: selectionPrompt.y }} onPointerDown={event => event.preventDefault()} onClick={() => { setSelection(selectionPrompt.text); setSelectionPrompt(null); window.getSelection()?.removeAllRanges(); toggle(true); }}><BrandMark brand="anthropic" size={13} />Ask about selection</button>}
    {narrow && open && <div className="asp-scrim" aria-hidden="true" onClick={() => toggle(false)} />}
    <div className="asp-dock" aria-hidden={!open} inert={!open}><div className="asp-dock-inner"><aside id={panelId} className="asp-panel" aria-label={name}>
      <header className="asp-panel-header"><div className="asp-identity">{assistant?.mark ?? <BrandMark brand="anthropic" size={15} />}<strong>{name}</strong><span>{model}</span><button ref={closeButton} aria-label={`Close ${name.toLowerCase()}`} aria-expanded={open} aria-controls={panelId} onClick={() => toggle(false)}>{narrow ? <X size={16} /> : <PanelRightClose size={16} />}</button></div><div className="asp-context"><span><FileText size={12} />This page</span>{selection && <span className="asp-selection-chip" title={selection}><span>Selection: {selection}</span><button aria-label="Remove selection context" onClick={() => { setSelection(undefined); setAnnouncement('Selection removed'); composer.current?.focus(); }}><X size={11} /></button></span>}</div></header>
      <div ref={thread} className="asp-thread" role="region" aria-label="Assistant conversation" onWheel={event => { if (event.deltaY < 0) { follow.current = false; scrolling.current = false; } }} onTouchStart={() => { follow.current = false; scrolling.current = false; }} onScroll={() => { if (!scrolling.current) { const el = thread.current!; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 70; } }}>
        <div className={`asp-thread-content ${messages.length ? '' : 'is-empty'}`}>
          {messages.map(message => <Reply key={message.id} message={message} name={name} applying={applying} onAction={action} onRetry={retry} />)}
          {!messages.length && <div className="asp-empty"><h2>Ask about {document.title}</h2><p>{name} reads this page and proposes edits. Nothing changes until you apply it.{!respond && ' Answers in this preview are simulated.'}</p></div>}
          {!busy && !!remaining.length && <div className="asp-suggestions">{remaining.map(prompt => <button key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div>}
        </div>
      </div>
      {!!applied.length && <div className="asp-undo-tray" aria-label="Applied changes">{applied.map(message => <button key={message.id} data-undo-id={message.id} aria-label={`Undo changes to ${blockLabel(message.change!.after)}`} disabled={!!applying} onClick={() => void action(message.id, 'undo')}><Check size={12} /><span>{blockLabel(message.change!.after)} updated</span><RotateCcw size={11} />Undo</button>)}</div>}
      <form className="asp-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={composer} aria-label="Message assistant" placeholder="Ask about this page" rows={1} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button className="asp-send" type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop' : 'Send'} disabled={!busy && !draft.trim()} onClick={busy ? stop : undefined}>{busy ? <Square size={12} fill="currentColor" /> : <ArrowUp size={17} />}</button></form>
    </aside></div></div>
    <div className="asp-sr" role="status" aria-live="polite">{announcement}</div>
  </div>;
}
export default AiSidePanel;
