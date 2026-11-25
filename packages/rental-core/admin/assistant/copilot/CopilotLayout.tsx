import { useRentalAssistant } from "../host";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ContextMenu } from '@animate-ui/react/primitives/base-ui/context-menu';
import { ArrowUp, FileText, PanelRightClose, Plus, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { AI_CONVERSATION_DRAFT_VERSION, formatRentalMoney } from '@rental-os/shared';
import { useLocation, useNavigate } from "../host";
import { useLocale } from "@rental-os/platform-admin/locale";



import { safeDisplayText } from "@rental-os/ai-native-admin/source/ai-native/safe-display";
import { VisibleObservationHost, useVisibleObservationHost } from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost";
import { VisibleObservationBoundary } from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationBoundary";
import { AnimatedIcon } from "@rental-os/platform-admin/source/components/ui/AnimatedIcon";
import { Button } from "@rental-os/platform-admin/source/components/ui/Button";
import { Modal } from "@rental-os/platform-admin/source/components/ui/Modal";
import { Select } from "@rental-os/platform-admin/source/components/ui/Select";
import { useCopilot, ORDER_QUESTIONS, type CopilotTurn } from './CopilotProvider';
import type { OrderQuestion } from './copilot-order-session';
import { readTarget, readRecord, type CopilotRecord } from './context';
import { CopilotNavigation } from './CopilotNavigation';
import { navigationTarget } from './destinations';
import './archive/ai-side-panel/side-panel.css';
import './copilot.css';

/** Sibling workspace and Copilot panels retain the original dock/sheet motion and session.
 * Archive resets stay inside the chat panel; the business trigger captures whole records. */
export function CopilotLayout({ children, header, suspended = false }: { children: ReactNode; header?: ReactNode; suspended?: boolean }) {
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
  useEffect(() => { if (suspended && copilot?.open) copilot.close(); }, [suspended, copilot?.open]);
  useEffect(() => { if (narrow && navigationTarget(location.state, pathname)) copilot?.close(); }, [location.key, narrow]);
  const capture = (event: SyntheticEvent) => {
    const items = !suspended && copilot?.available ? readTarget(event.target, pathname) : [];
    if (!items.length) {
      // Also stops the primitive's document bubbling listener, preserving native menus.
      event.stopPropagation(); return;
    }
    setTarget(items);
  };
  return <div ref={root} className={`copilot-host${shown ? ' is-open' : ''}${narrow ? ' is-sheet' : ''}`}>
    <CopilotNavigation />
    <ContextMenu.Root open={menuOpen} onOpenChange={next => setMenuOpen(next)}>
      <ContextMenu.Trigger render={<div className="asp-page-column" ref={content} inert={shown && narrow || undefined} />}
        onContextMenuCapture={capture} onTouchStartCapture={capture}>
        {header}{children}
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
    <div className="asp-dock" inert={!shown || undefined} aria-hidden={!shown || undefined}><div className="asp-dock-inner ai-side-panel">
      {copilot && <VisibleObservationHost surface="server_conversation" scopeKey={copilot.observationScope}
        current={() => shown && copilot.observationCurrent()}>
        <CopilotPanel narrow={narrow} open={shown} background={content.current} />
      </VisibleObservationHost>}
    </div></div>
  </div>;
}

function CopilotPanel({ narrow, open, background }: { narrow: boolean; open: boolean; background: HTMLElement | null }) {
  const { APP_ROUTES, canAccessRoute, currentSessionEpoch, useAuthStore } = useRentalAssistant();

  const copilot = useCopilot()!, { t, locale } = useLocale(), navigate = useNavigate();
  const visible = useVisibleObservationHost();
  const { pathname } = useLocation();
  const input = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLElement>(null), thread = useRef<HTMLDivElement>(null);
  const [availableContext, setAvailableContext] = useState({ detail: false, configuration: false });
  const auth = useAuthStore();
  const canContinue = canAccessRoute(APP_ROUTES.aiOperator, auth.hasPermission, auth.hasCapability,
    auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission);
  useLayoutEffect(() => copilot.registerVisibleHost(visible), [copilot.registerVisibleHost, visible]);
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
    if (open) input.current?.focus({ preventScroll: true });
  }, [open, copilot.focusVersion]);
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
    const records = Array.from(candidates).map(node => readRecord(node, pathname)).filter((record): record is CopilotRecord => Boolean(record));
    if (!records.length) return;
    copilot.add(records); copilot.send(label, locale === 'en-US', records);
  };
  const contextLabel = (record: CopilotRecord) => record.label;
  const payable = copilot.order.facts?.order.amounts.finalPayable, currency = copilot.order.facts?.order.currency;
  const payableText = typeof payable === 'number' && Number.isFinite(payable)
    && (!Number.isInteger(payable) || Number.isSafeInteger(payable)) && typeof currency === 'string' && currency.length > 0
    ? formatRentalMoney(payable, currency) : t('未加载');
  const transfer = () => {
    const now = useAuthStore.getState(), conversationId = copilot.order.conversationId;
    if (!open || !conversationId || !now.sessionVerified || !now.token || copilot.identity !== JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user?.id])
      || !canAccessRoute(APP_ROUTES.aiOperator, now.hasPermission, now.hasCapability, now.tenant?.categoryCode,
        Boolean(now.user?.isSaasAdmin), now.hasTenantMembershipPermission)) return;
    navigate(APP_ROUTES.aiOperator.path, { state: { aiConversation: { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, capabilityCode: 'order_explanation',
      identity: copilot.identity, sessionEpoch: currentSessionEpoch() } } });
    copilot.close();
  };
  return <aside id="business-copilot" ref={panel} className="asp-panel" role={narrow ? 'dialog' : 'complementary'} aria-modal={narrow && open || undefined} aria-label="Copilot">
    <header className="asp-panel-header"><div className="asp-identity"><AnimatedIcon name="ai" /><strong>Copilot</strong><span>{t('订单 Agent')}</span>
      {canContinue && copilot.order.conversationId && <Button onClick={transfer}>{t('在 Agent 控制台继续')}</Button>}
      {copilot.order.hasOriginal && <Button disabled={copilot.busy} onClick={() => void copilot.readOriginal()}>{t('核对原结果')}</Button>}
      <button type="button" title={t('新对话')} aria-label={t('新对话')} data-sound="press" disabled={copilot.busy || copilot.order.hasOriginal && !copilot.order.complete} onClick={() => void copilot.clear()}><RotateCcw size={15} /></button>
      <button type="button" aria-label={t('关闭 Copilot')} data-sound="press" onClick={copilot.close}><PanelRightClose size={16} /></button>
    </div><div className="asp-context"><span><FileText size={12} />{t(copilot.page?.label ?? '当前页面')}</span></div></header>
    <div className="asp-thread" ref={thread} aria-busy={copilot.busy}><div className={`asp-thread-content${copilot.turns.length ? '' : ' is-empty'}`}>
      {!copilot.turns.length && <div className="asp-empty"><h2>{t('从当前工作继续')}</h2><p>{t('右击业务记录，加入上下文后提问。')}</p>
        <div className="asp-suggestions">
          {!copilot.contexts.length && availableContext.detail && <button type="button" data-sound="press" onClick={() => prepareCurrent(t('分析当前资料'))}>{t('分析当前资料')}</button>}
          {!copilot.contexts.length && availableContext.configuration && <button type="button" data-sound="press" onClick={() => prepareCurrent(t('解释当前配置'))}>{t('解释当前配置')}</button>}
          {[t('订单状态'), t('订单费用'), t('收款情况'), t('下一步处理')].map(label => <button type="button" key={label} data-sound="press" onClick={() => send(label)}>{label}</button>)}</div>
      </div>}
      {copilot.turns.map(turn => <article key={turn.id} className="asp-turn"><div className="asp-user"><p>{turn.prompt}</p><span>{t(turn.page)} · {turn.contexts.length} {t('条上下文')}</span></div>
        {turn.status === 'reading' ? <p className="asp-reading" role="status">{t('正在读取原任务并运行订单 Agent…')}</p> : <>
          <CopilotModelText turn={turn} />
          {turn.status === 'done' && copilot.order.complete && !copilot.order.textSource && <p role="status">{t('原轮次已关闭，可开始新对话。')}</p>}
          {turn.status === 'stopped' && <p className="asp-state">{t('原操作待核对')}<button type="button" disabled={copilot.busy} onClick={() => void copilot.readOriginal()}>{t('核对原结果')}</button></p>}
          {!!turn.contexts.length && <details className="copilot-sources"><summary>{t('上下文来源')} · {turn.contexts.length}</summary>{turn.contexts.map(record => <div key={record.key}><strong>{contextLabel(record)}</strong><span>{t(record.source)} · {new Date(record.capturedAt).toLocaleTimeString(locale)}</span>
            <button type="button" onClick={() => { if (copilot.routes.some(route => record.path === route.path || record.path.startsWith(`${route.path}/`))) { navigate(record.path); if (narrow) copilot.close(); } }}>{t('返回来源')}</button></div>)}</details>}
          {copilot.order.facts && <section className="asp-change"><header><strong>{t('原订单事实')}</strong><span>{t('只读')}</span></header>
            <div className="asp-change-body"><dl>
              <div><dt>{t('订单')}</dt><dd>{safeDisplayText(copilot.order.facts.order.orderNo, 191)}</dd></div>
              <div><dt>{t('状态')}</dt><dd>{safeDisplayText(copilot.order.facts.order.status, 80)}</dd></div>
              <div><dt>{t('应付金额')}</dt><dd>{payableText}</dd></div>
            </dl><small>{t('收款证据及历史费用依据未加载，请回原订单页核对。')}</small></div></section>}
          {!!copilot.order.steps.length && <details className="copilot-sources"><summary>{t('原 Task 步骤')}</summary>
            {copilot.order.steps.map(step => <div key={step.stepId}><strong>{t('步骤')} {step.sequence}</strong><span>{t(step.status)}</span></div>)}</details>}

        </>}
      </article>)}
    </div></div>
    {!!copilot.contexts.length && <div className="asp-context copilot-contexts" aria-label={t('待发送的上下文')}>{copilot.contexts.map(record => <span key={record.key} className="asp-selection-chip" title={`${record.source} · ${contextLabel(record)}`}><FileText size={12} /><span>{contextLabel(record)}</span><button type="button" aria-label={`${t('移除上下文')} ${contextLabel(record)}`} onClick={() => copilot.remove(record.key)}><X size={12} /></button></span>)}</div>}
    <form className="asp-composer" onSubmit={event => { event.preventDefault(); send(); }}><textarea ref={input} aria-label={t('向 Copilot 提问')} placeholder={t(copilot.orderId ? '询问这笔订单…' : '请先打开一笔订单再提问')} value={copilot.draft} disabled={!copilot.orderId} maxLength={4000} rows={2} onChange={event => copilot.setDraft(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(); }
    }} />{copilot.busy ? <button type="button" className="asp-send" aria-label={t('停止生成')} onClick={copilot.stop}><Square size={13} /></button> : <button type="submit" className="asp-send" aria-label={t('发送消息')} data-sound="press" disabled={!copilot.orderId || !copilot.draft.trim()}><ArrowUp size={16} /></button>}</form>
    <div className="copilot-footnote">{t('模型内容需核对；本入口读取原订单事实，业务办理沿原页面。')}</div>
    {copilot.feedback && <p className="asp-state" role="status">{t(copilot.feedback)}</p>}
    {!copilot.orderId && <div className="copilot-routes"><button type="button" onClick={copilot.close}>{t('回原页面办理资料或配置')}</button></div>}
    <span className="asp-sr" role="status">{copilot.notice && t('已添加 {count} 条上下文', { count: copilot.notice })}</span>
    <Modal title={<><ShieldCheck size={18} /> {t('确认处理方案')}</>} open={open && Boolean(copilot.review)} onCancel={copilot.dismissReview} footer={<>
      <Button onClick={copilot.dismissReview}>{t('返回核对')}</Button><Button type="primary" disabled={!copilot.review?.question || !copilot.available || copilot.busy} onClick={() => void copilot.confirm()}>{t('确认并运行订单 Agent')}</Button>
    </>}><div className="copilot-review"><p>{copilot.review?.prompt}</p><dl><div><dt>{t('原订单定位')}</dt><dd>{copilot.review?.orderId}</dd></div></dl>
      <label><span>{t('本次发送的问题')}</span><Select aria-label={t('本次发送的问题')} placeholder={t('请选择问题类别')} value={copilot.review?.question ?? undefined} options={ORDER_QUESTIONS.map(item => ({ ...item, label: t(item.label) }))}
        onChange={value => copilot.selectQuestion(String(value) as OrderQuestion)} /></label>
      <small>{t('当前模型接口接收订单定位和所选问题类别。输入框文字仅作本页核对备注；页面字段不会作为服务端事实提交。确认后将创建原会话、任务并启动模型。')}</small>
    </div></Modal>
  </aside>;
}

function CopilotModelText({ turn }: { turn: CopilotTurn }) {
  const copilot = useCopilot()!, source = turn.textSource;
  const body = <div className="asp-markdown" data-ai-visible-text={source ? '' : undefined}>
    <Markdown skipHtml allowedElements={['p', 'strong', 'em', 'h3', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'br']}>{safeDisplayText(turn.text, 20000)}</Markdown>
  </div>;
  if (!source) return body;
  return <VisibleObservationBoundary kind="text" reference={{ taskId: source.taskId, runId: source.runId,
    source: { kind: 'model_result', resultId: source.resultId } }} ready={copilot.order.phase === 'observed'
      && turn.status === 'done' && source === copilot.order.textSource && turn.text === copilot.order.text
      && turn.text.trim().length > 0 && copilot.observationCurrent()}>{body}</VisibleObservationBoundary>;
}
