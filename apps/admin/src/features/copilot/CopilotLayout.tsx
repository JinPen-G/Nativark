import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ContextMenu } from '@animate-ui/react/primitives/base-ui/context-menu';
import { ArrowUp, FileText, PanelRightClose, Plus, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLocale } from '@/app/locale';
import { currentSessionEpoch } from '@/app/queryClient';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { useAuthStore } from '@/features/auth/authStore';
import { ServerConversationPanel } from '@/features/ai-native/ServerConversationPanel';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useCopilot, type CopilotTurn } from './CopilotProvider';
import { readTarget, readRecord, type CopilotRecord } from './context';
import { CopilotNavigation } from './CopilotNavigation';
import { navigationTarget } from './destinations';
import './archive/ai-side-panel/side-panel.css';
import './copilot.css';

/** Original ai-side-panel dock geometry and curve; only the document/demo is replaced.
 * The single business-area trigger delegates to whole records, not individual fields. */
export function CopilotLayout({ children, suspended = false }: { children: ReactNode; suspended?: boolean }) {
  const copilot = useCopilot(), { t } = useLocale(), location = useLocation(), { pathname } = location;
  const [menuOpen, setMenuOpen] = useState(false), [target, setTarget] = useState<CopilotRecord[]>([]), [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const shown = Boolean(copilot?.open && !suspended && copilot.available);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setNarrow(node.clientWidth < 640);
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setMenuOpen(false); }, [pathname, suspended]);
  useEffect(() => { if (narrow && navigationTarget(location.state, pathname)) copilot?.close(); }, [location.key, narrow]);
  const capture = (event: SyntheticEvent) => {
    const items = !suspended && copilot?.available ? readTarget(event.target, pathname) : [];
    if (!items.length) {
      // Also stops the primitive's document bubbling listener, preserving native menus.
      event.stopPropagation(); return;
    }
    setTarget(items);
  };
  return <div ref={root} className={`ai-side-panel copilot-host${shown ? ' is-open' : ''}${narrow ? ' is-sheet' : ''}`}>
    <CopilotNavigation />
    <ContextMenu.Root open={menuOpen} onOpenChange={next => setMenuOpen(next)}>
      <ContextMenu.Trigger render={<div className="asp-page-column" ref={content} inert={shown && narrow || undefined} />}
        onContextMenuCapture={capture} onTouchStartCapture={capture}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Positioner className="copilot-menu-positioner" sideOffset={5} collisionPadding={8}>
        <ContextMenu.Popup className="copilot-menu" aria-label={t('Copilot 上下文操作')}>
          <div className="copilot-menu-label">{target.length > 1 ? t('已选 {count} 条记录', { count: target.length }) : target[0]?.label}</div>
          <ContextMenu.Item className="copilot-menu-item" data-sound="press" onClick={() => copilot?.add(target, true)}><AnimatedIcon name="ai" />{t('询问 Copilot')}</ContextMenu.Item>
          <ContextMenu.Item className="copilot-menu-item" data-sound="press" onClick={() => copilot?.add(target)}><Plus size={16} />{t('添加到 Copilot')}</ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner></ContextMenu.Portal>
    </ContextMenu.Root>
    {shown && narrow && <div className="asp-scrim" aria-hidden="true" onClick={copilot?.close} />}
    <div className="asp-dock" inert={!shown || undefined} aria-hidden={!shown || undefined}><div className="asp-dock-inner">
      {copilot && <CopilotPanel narrow={narrow} open={shown} background={content.current} />}
    </div></div>
  </div>;
}

function CopilotPanel({ narrow, open, background }: { narrow: boolean; open: boolean; background: HTMLElement | null }) {
  const copilot = useCopilot()!, { t, locale } = useLocale(), navigate = useNavigate();
  const { pathname } = useLocation();
  const input = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLElement>(null), thread = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<CopilotTurn | null>(null), [reviewOpen, setReviewOpen] = useState(false);
  const [availableContext, setAvailableContext] = useState({ detail: false, configuration: false });
  const [serverOpen, setServerOpen] = useState(false);
  const auth = useAuthStore();
  const canContinue = canAccessRoute(APP_ROUTES.aiOperator, auth.hasPermission, auth.hasCapability,
    auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission);
  useEffect(() => { setServerOpen(false); }, [open, pathname, copilot.focusVersion]);
  useEffect(() => {
    if (!open || !background) return;
    const read = () => {
      const next = { detail: Boolean(background.querySelector('[data-copilot-detail]')), configuration: Boolean(background.querySelector('[data-copilot-config]')) };
      setAvailableContext(previous => previous.detail === next.detail && previous.configuration === next.configuration ? previous : next);
    };
    read(); const observer = new MutationObserver(read); observer.observe(background, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, background, pathname]);
  useEffect(() => {
    if (open) (serverOpen ? panel.current?.querySelector<HTMLElement>('button') : input.current)?.focus({ preventScroll: true });
  }, [open, copilot.focusVersion, serverOpen]);
  useEffect(() => {
    const node = thread.current;
    if (node && (copilot.busy || node.scrollHeight - node.scrollTop - node.clientHeight < 200)) node.scrollTo({ top: node.scrollHeight });
  }, [copilot.turns, copilot.busy]);
  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => {
      const anotherDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(node => node !== panel.current && node.getClientRects().length);
      if (event.key === 'Escape' && !anotherDialog && !document.querySelector('[role="menu"]')) { event.preventDefault(); copilot.close(); }
      if (narrow && !anotherDialog && event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]'));
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const contain = (event: FocusEvent) => { if (narrow && background?.contains(event.target as Node)) input.current?.focus(); };
    document.addEventListener('keydown', handle); document.addEventListener('focusin', contain);
    return () => { document.removeEventListener('keydown', handle); document.removeEventListener('focusin', contain); };
  }, [open, narrow, background, copilot.close]);
  const send = (text = copilot.draft) => copilot.send(text, locale === 'en-US');
  const prepareCurrent = (label: string) => {
    const candidates = document.querySelectorAll<HTMLElement>('.copilot-host .asp-page-column [data-copilot-config], .copilot-host .asp-page-column [data-copilot-detail]');
    const records = Array.from(candidates).map(node => readRecord(node, window.location.pathname)).filter((record): record is CopilotRecord => Boolean(record));
    if (!records.length) return;
    copilot.add(records); copilot.send(label, locale === 'en-US', records);
  };
  const changed = (turn: CopilotTurn) => turn.changes?.filter(change => change.after !== change.before) ?? [];
  const contextLabel = (record: CopilotRecord) => record.label;
  if (serverOpen) return <aside id="business-copilot" ref={panel} className="asp-panel" role={narrow ? 'dialog' : 'complementary'}
    aria-modal={narrow && open || undefined} aria-label="Copilot">
    <header className="asp-panel-header"><div className="asp-identity"><AnimatedIcon name="ai" /><strong>Copilot</strong><span>{t('服务端对话')}</span>
      <Button onClick={() => setServerOpen(false)}>{t('返回示例工作区')}</Button>
      <button type="button" aria-label={t('关闭 Copilot')} data-sound="press" onClick={copilot.close}><PanelRightClose size={16} /></button>
    </div></header>
    <div className="asp-thread"><ServerConversationPanel visible={open} onOpenConversation={canContinue ? selection => {
      const now = useAuthStore.getState();
      if (!canAccessRoute(APP_ROUTES.aiOperator, now.hasPermission, now.hasCapability, now.tenant?.categoryCode,
        Boolean(now.user?.isSaasAdmin), now.hasTenantMembershipPermission)) return;
      navigate(APP_ROUTES.aiOperator.path, { state: { aiConversation: { ...selection,
        identity: JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user?.id]), sessionEpoch: currentSessionEpoch() } } });
      copilot.close();
    } : undefined} /></div>
  </aside>;
  return <aside id="business-copilot" ref={panel} className="asp-panel" role={narrow ? 'dialog' : 'complementary'} aria-modal={narrow && open || undefined} aria-label="Copilot">
    <header className="asp-panel-header"><div className="asp-identity"><AnimatedIcon name="ai" /><strong>Copilot</strong><span>{t('本地演示')}</span>
      <Button onClick={() => { copilot.stop(); setReviewOpen(false); setServerOpen(true); }}>{t('服务端对话')}</Button>
      <button type="button" title={t('新对话')} aria-label={t('新对话')} data-sound="press" onClick={copilot.clear}><RotateCcw size={15} /></button>
      <button type="button" aria-label={t('关闭 Copilot')} data-sound="press" onClick={copilot.close}><PanelRightClose size={16} /></button>
    </div><div className="asp-context"><span><FileText size={12} />{t(copilot.page?.label ?? '当前页面')}</span></div></header>
    <div className="asp-thread" ref={thread} aria-busy={copilot.busy}><div className={`asp-thread-content${copilot.turns.length ? '' : ' is-empty'}`}>
      {!copilot.turns.length && <div className="asp-empty"><h2>{t('从当前工作继续')}</h2><p>{t('右击业务记录，加入上下文后提问。')}</p>
        <div className="asp-suggestions">
          {!copilot.contexts.length && availableContext.detail && <button type="button" data-sound="press" onClick={() => prepareCurrent(t('分析当前资料'))}>{t('分析当前资料')}</button>}
          {!copilot.contexts.length && availableContext.configuration && <button type="button" data-sound="press" onClick={() => prepareCurrent(t('解释当前配置'))}>{t('解释当前配置')}</button>}
          {[t('整理所选内容'), t('查看可用页面')].map(label => <button type="button" key={label} data-sound="press" onClick={() => send(label)}>{label}</button>)}</div>
      </div>}
      {copilot.turns.map(turn => <article key={turn.id} className="asp-turn"><div className="asp-user"><p>{turn.prompt}</p><span>{t(turn.page)} · {turn.contexts.length} {t('条上下文')}</span></div>
        {turn.status === 'reading' ? <p className="asp-reading" role="status">{t('正在整理所选内容（演示）')}</p> : <>
          <div className="asp-markdown"><Markdown skipHtml allowedElements={['p', 'strong', 'em', 'h3', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'br']}>{turn.text}</Markdown></div>
          {turn.status === 'stopped' && <p className="asp-state">{t('已停止')}<button type="button" onClick={() => send(turn.prompt)}>{t('重试')}</button></p>}
          {!!turn.contexts.length && <details className="copilot-sources"><summary>{t('上下文来源')} · {turn.contexts.length}</summary>{turn.contexts.map(record => <div key={record.key}><strong>{contextLabel(record)}</strong><span>{t(record.source)} · {new Date(record.capturedAt).toLocaleTimeString(locale)}</span>
            <button type="button" onClick={() => { if (copilot.routes.some(route => record.path === route.path || record.path.startsWith(`${route.path}/`))) { navigate(record.path); if (narrow) copilot.close(); } }}>{t('返回来源')}</button></div>)}</details>}
          {turn.proposal && <section className="asp-change"><header><strong>{t(turn.changes?.length ? '配置建议' : '操作预览')}</strong><span>{t(turn.filled ? '未保存' : '尚未执行')}</span></header><div className="asp-change-body"><p>{turn.prompt}</p>
            {turn.changes?.map(change => <label key={`${change.configId}:${change.key}`} className="copilot-proposed-field"><span>{change.label}<small>{t('当前值')}：{change.options?.find(option => option.value === change.before)?.label ?? change.before}</small></span>
              <Select aria-label={`${t('建议值')} ${change.label}`} value={change.after} disabled={turn.proposal !== 'pending'} options={change.options} onChange={value => copilot.updateChange(turn.id, `${change.configId}:${change.key}`, String(value))} /></label>)}
            {turn.changes?.length ? <small>{t('核对后仅填入表单，仍需手动保存。')}</small> : <span className="asp-state">{turn.contexts.length} {t('条记录')}</span>}</div>
            <footer>{turn.proposal === 'pending' ? <><span /><div><button type="button" data-sound="press" onClick={() => copilot.decide(turn.id, 'discarded')}>{t('放弃')}</button><button type="button" className="asp-primary" data-sound="press" disabled={Boolean(turn.changes?.length && !changed(turn).length)} onClick={() => { setReview(turn); setReviewOpen(true); }}>{t('核对方案')}</button></div></> : <span className="asp-state">{t(turn.filled ? '已填入表单，尚未保存。' : turn.proposal === 'confirmed' ? '演示方案已确认，未执行业务' : '已放弃')}</span>}</footer>
          </section>}
          {!!turn.destinations?.length && <div className="copilot-routes">{turn.destinations.map(target => <button type="button" key={target.id} data-sound="page" onClick={() => { copilot.navigateTo(target.id); if (narrow) copilot.close(); }}>{target.anchor ? `${t('定位')} · ` : ''}{t(target.label)}</button>)}</div>}
        </>}
      </article>)}
    </div></div>
    {!!copilot.contexts.length && <div className="asp-context copilot-contexts" aria-label={t('待发送的上下文')}>{copilot.contexts.map(record => <span key={record.key} className="asp-selection-chip" title={`${record.source} · ${contextLabel(record)}`}><FileText size={12} /><span>{contextLabel(record)}</span><button type="button" aria-label={`${t('移除上下文')} ${contextLabel(record)}`} onClick={() => copilot.remove(record.key)}><X size={12} /></button></span>)}</div>}
    <form className="asp-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={input} aria-label={t('向 Copilot 提问')} placeholder={t('询问所选内容，或描述要处理的工作…')} value={copilot.draft} maxLength={4000} rows={2} onChange={event => copilot.setDraft(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(); }
    }} />{copilot.busy ? <button type="button" className="asp-send" aria-label={t('停止生成')} onClick={copilot.stop}><Square size={13} /></button> : <button type="submit" className="asp-send" aria-label={t('发送消息')} data-sound="press" disabled={!copilot.draft.trim()}><ArrowUp size={16} /></button>}</form>
    <div className="copilot-footnote">{t('本地演示，未连接模型或执行业务。')}</div>
    <span className="asp-sr" role="status">{copilot.notice && t('已添加 {count} 条上下文', { count: copilot.notice })}</span>
    <Modal title={<><ShieldCheck size={18} /> {t('确认处理方案')}</>} open={reviewOpen} afterClose={() => setReview(null)} onCancel={() => setReviewOpen(false)} footer={<>
      <Button onClick={() => setReviewOpen(false)}>{t('返回核对')}</Button><Button type="primary" disabled={!copilot.available} onClick={() => { if (review?.changes?.length) { if (!copilot.fillConfiguration(review)) return; } else if (review) copilot.decide(review.id, 'confirmed'); setReviewOpen(false); }}>{t(review?.changes?.length ? '填入表单' : '确认演示方案')}</Button>
    </>}><div className="copilot-review"><p>{review?.prompt}</p><dl>{review?.changes?.length ? changed(review).map(change => <div key={`${change.configId}:${change.key}`}><dt>{change.label}</dt><dd><del>{change.options?.find(option => option.value === change.before)?.label ?? change.before}</del><span aria-hidden> → </span><strong>{change.options?.find(option => option.value === change.after)?.label ?? change.after}</strong></dd></div>) : review?.contexts.map(record => <div key={record.key}><dt>{contextLabel(record)}</dt><dd>{record.fields.map(field => `${field.label}：${field.value}`).join(' · ')}</dd></div>)}</dl>
      {copilot.configurationNotice && <p role="alert">{t(copilot.configurationNotice)}</p>}<small>{t(review?.changes?.length ? '核对后仅填入表单，仍需手动保存。' : '仅记录本次演示确认，不修改真实数据。')}</small></div></Modal>
  </aside>;
}
