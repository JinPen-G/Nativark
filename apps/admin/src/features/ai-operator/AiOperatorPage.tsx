import { useEffect, useRef, useState } from "react";
import { currentSessionEpoch } from '@/app/queryClient';
import { readConversationNavigation } from '@/features/ai-native/conversation-navigation';
import { useLocation } from 'react-router-dom';
import { useLocale } from '@/app/locale';
import { Plus, X } from "lucide-react";
import { Button, Drawer, Input, Modal, Select, Switch } from "@/components/ui";
import { AnimatedIcon } from "@/components/ui/AnimatedIcon";
import { ArcLocale } from "@/components/ui/ArcLocale";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { WorkspacePageTitle } from "@/components/workspace/WorkspaceHeader";
import { VisibleObservationHost, useVisibleObservationHost } from '@/features/ai-native/VisibleObservationHost';
import { VisibleObservationBoundary } from '@/features/ai-native/VisibleObservationBoundary';
import { AI_QUOTE_GOAL_LIMITS } from '@rental-os/shared';
import { AiChat } from "./archive/ai-chat/AiChat";
import { NATIVE_GATEWAY_MODEL } from "./OperatorContext";
import { NativeOperatorWorkspace } from "./NativeOperatorWorkspace";
import { ResizablePanels, ResizablePanel } from "@/registry/components/resizable-panels/resizable-panels";
import { Card } from "@/registry/components/card/card";
import { useOperator, type OperatorTask } from "./OperatorContext";
import { OPERATOR_CAPABILITIES } from "./capabilities";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import "./ai-operator.css";
import "./archive-adapter.css";

const frequencyLabels = { daily: "每天", weekdays: "工作日", weekly: "每周一" };
/** Model selection belongs to the persisted server route, never a local menu. */
function useConfiguredChatModels() { return { models: [NATIVE_GATEWAY_MODEL], defaultModel: NATIVE_GATEWAY_MODEL.id }; }
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1050px)").matches);
  useEffect(() => { const media = matchMedia("(max-width: 1050px)"); const change = () => setNarrow(media.matches); media.addEventListener("change", change); change(); return () => media.removeEventListener("change", change); }, []);
  return narrow;
}
export function AiOperatorPage() {
  const { t } = useLocale();
  const operator = useOperator();
  const auth = useAuthStore(), { tenant, user } = auth, location = useLocation();
  const identity = JSON.stringify([tenant?.tenantId, auth.currentWorkspaceId, user?.id]);
  const owner = JSON.stringify([identity, user, currentSessionEpoch()]);
  const incoming = readConversationNavigation(location.state?.aiConversation, identity, currentSessionEpoch());
  const handledNavigation = useRef<string | null>(null);
  useEffect(() => {
    const navigation = JSON.stringify([location.key, owner]);
    if (incoming && handledNavigation.current !== navigation
      && ['quote_clarification', 'order_explanation', 'opening_diagnosis'].includes(incoming.capabilityCode)) {
      if (operator.view !== 'chat') { operator.setView('chat'); return; }
      handledNavigation.current = navigation;
      void operator.openNative(incoming.conversationId, incoming.capabilityCode as 'quote_clarification' | 'order_explanation' | 'opening_diagnosis');
    }
  }, [location.key, owner, operator.view]);
  const title = operator.view === "chat" ? operator.capability.name : operator.view === "plugins" ? "插件" : "自动化任务";
  useEffect(() => { document.title = `${t(title)} · ${t("Agent工作台")} · ${resolveAdminBrandName(tenant, user)}`; }, [title, tenant, user, t]);
  return <ArcLocale><ContentTransition value={operator.view} className="operator-page">
    <WorkspacePageTitle><span className="workspace-page-title">{t(title)}</span></WorkspacePageTitle>
    {operator.view === "chat" ? <VisibleObservationHost surface="server_conversation"
      scopeKey={`${owner}:${operator.activeId}`} current={operator.current}><OperatorChat /></VisibleObservationHost>
      : operator.view === "plugins" ? <PluginCatalog /> : <AutomationTasks />}
  </ContentTransition></ArcLocale>;
}
function OperatorChat() {
  const { t } = useLocale();
  const operator = useOperator(), narrow = useNarrow();
  const visible = useVisibleObservationHost();
  const configured = useConfiguredChatModels();
  const [workOpen, setWorkOpen] = useState(!narrow), [mobileOpen, setMobileOpen] = useState(false);
  const split = useRef<HTMLDivElement>(null);
  function toggleWork() {
    if (narrow) { setMobileOpen(true); return; }
    // Use the original component's keyboard contract, preserving its spring, restore target and focus handling.
    split.current?.querySelector('[role="separator"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  useEffect(() => {
    const separator = split.current?.querySelector<HTMLElement>('[role="separator"]');
    const collapsed = separator?.getAttribute("data-collapsed") === "after";
    if (separator && narrow && !collapsed) separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (!narrow) setMobileOpen(false);
  }, [narrow]);
  return <section className="operator-chat-layout" data-narrow={narrow || undefined} aria-label={t("Agent工作台对话")}>
    <div className="operator-split" ref={split}>
      <ResizablePanels label="对话与Agent工作区" onLayoutChange={sizes => setWorkOpen(sizes[1] > 1)}>
        <ResizablePanel id="operator-conversation" label="聊天区" defaultSize={60} minSize={340}>
          <AiChat className="operator-archive-chat"
            store={{ chats: operator.chats, setChats: operator.setChats, activeId: operator.activeId, objectUrls: operator.objectUrls, setActiveId: operator.selectConversation }}
            historyConversationIds={operator.capabilityThreads.map(thread => thread.id)}
            respond={(messages, options) => operator.respond(messages, options, visible)} autoPlay={false} models={configured.models} defaultModel={configured.defaultModel}
            host={{ scope: '原任务', notice: operator.notice || (operator.enabled ? '发送将使用当前受权模型并记录用量，业务动作仍须另行确认。' : '此能力尚未接入，可在工作区打开原业务页面。'),
              maxInputLength: operator.capability.nativeScene === 'quote_clarification' ? AI_QUOTE_GOAL_LIMITS.goalCharacters : undefined,
              preserveInput: operator.capability.nativeScene === 'quote_clarification',
              modelMenu: '服务端当前路由', modelLocked: true, attachments: false, canSend: operator.canSend, onHistory: () => void operator.history(), onRetry: operator.retryOriginal, onReplyStarted: operator.registerReply, onStop: () => void operator.stopTask(),
              renderText: (message, body) => {
                const reference = operator.visibleReference(message);
                return reference ? <VisibleObservationBoundary reference={reference} kind="text"
                  ready={operator.current() && message.content.trim().length > 0}>{body}</VisibleObservationBoundary> : body;
              } }}
            disabled={!operator.enabled} greeting={operator.capability.description} placeholder={`描述${operator.capability.name}相关的工作，或继续补充要求…`}
            suggestions={[{ label: operator.capability.prompt, icon: "activity" }]}
            onNewChat={() => operator.createConversation(operator.capability.id)}
            queuedPrompt={operator.queuedPrompt} onQueuedPromptUsed={() => operator.setQueuedPrompt(null)}
            headerActions={<Button size="small" type="text" className="operator-work-toggle"
              title={t(workOpen && !narrow ? "收起工作区" : "打开工作区")}
              aria-label={t(workOpen && !narrow ? "收起工作区" : "打开工作区")}
              icon={<AnimatedIcon name={workOpen && !narrow ? "panelRightClose" : "panelRightOpen"} style={{ fontSize: 16 }} />}
              aria-expanded={narrow ? mobileOpen : workOpen} aria-controls={narrow ? "operator-mobile-work" : "operator-work"} onClick={toggleWork} />}
          />
        </ResizablePanel>
        <ResizablePanel id="operator-work" label="Agent工作区" defaultSize={40} minSize={310} maxSize={720} collapsible defaultCollapsed={narrow}>
          {!narrow && <WorkArea visible={workOpen} />}
        </ResizablePanel>
      </ResizablePanels>
    </div>
    {narrow && <WorkArea visible={mobileOpen} drawer onClose={() => setMobileOpen(false)} />}
  </section>;
}
function WorkArea({ visible = true, drawer = false, onClose }: { visible?: boolean; drawer?: boolean; onClose?: () => void }) {
  const operator = useOperator(), { t } = useLocale();
  const observation = useVisibleObservationHost();
  const title = <span className="operator-work-title"><AnimatedIcon name="folder" />{t("Agent 工作区")}</span>;
  const actions = <div className="operator-work-header-actions"><span className="operator-demo-tag">{t("原任务")}</span>
    <Button size="small" type="text" className="operator-work-toggle" title={t("读取原结果")} aria-label={t("读取原结果")}
      disabled={!visible || operator.active.running || (!operator.active.native && !operator.active.hasOriginal)}
      icon={<AnimatedIcon name="messages" style={{ fontSize: 16 }} />} onClick={() => { observation?.invalidate(); void operator.readOriginal(); }} />
  </div>;
  const content = <section className="operator-work-area" aria-label={t("Agent工作区")}>
    {!drawer && <header className="operator-panel-header">{title}{actions}</header>}
    <NativeOperatorWorkspace visible={visible} />
  </section>;
  return drawer ? <Drawer open={visible} onClose={onClose} title={title} extra={actions} destroyOnHidden
    className="operator-work-drawer" width="min(100vw, 520px)">
    <div id="operator-mobile-work" className="operator-mobile-work">{content}</div>
  </Drawer> : content;
}
function PluginCatalog() {
  const operator = useOperator(); const [query, setQuery] = useState("");
  return <section className="operator-catalog"><header className="operator-section-header"><div><h1 data-icon-hover=""><AnimatedIcon name="plugins" />插件</h1><p>选择对话可使用的经营能力</p></div><span className="operator-demo-tag">当前能力</span></header>
    <div className="operator-catalog-search"><Input allowClear aria-label="搜索插件" placeholder="搜索能力" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="operator-plugin-grid">{operator.permitted.filter(item => `${item.name}${item.description}`.includes(query.trim())).map(item => <Card key={item.id} title={item.name} description={item.description} className="operator-plugin-card"
      avatar={<span className="operator-plugin-icon"><AnimatedIcon name={item.icon} /></span>} meta={item.nativeScene ? "已接原任务" : "待接入"} action={<Switch aria-label={`启用${item.name}`} checked={!operator.disabled.includes(item.id)} onChange={next => operator.togglePlugin(item.id, next)} />} />)}</div>
    {!operator.permitted.some(item => `${item.name}${item.description}`.includes(query.trim())) && <p className="operator-empty">没有匹配的可用能力</p>}
    <p className="operator-caption">按当前账号权限展示。开关控制本页入口，服务端继续核验实际权限与能力。</p>
  </section>;
}
function AutomationTasks() {
  const operator = useOperator();
  const [editing, setEditing] = useState<OperatorTask | null>(null), [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const visible = operator.tasks.filter(task => task.name.includes(query.trim()));
  const allowed = (capabilityId: string) => operator.available.some(item => item.id === capabilityId);
  function create() { const capability = operator.available[0]; if (!capability) return; setError(""); setEditing({ id: crypto.randomUUID(), name: "", capabilityId: capability.id, frequency: "daily", time: "09:00", prompt: capability.prompt, enabled: true }); }
  function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.prompt.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(editing.time) || !allowed(editing.capabilityId)) { setError("请填写名称、任务要求和有效时间，并选择已启用的能力。"); return; }
    operator.setTasks(previous => [...previous.filter(task => task.id !== editing.id), { ...editing, name: editing.name.trim(), prompt: editing.prompt.trim() }]); setEditing(null);
  }
  function presets() {
    const candidates = [{ capabilityId: "brief", name: "晨间经营简报", frequency: "daily", time: "09:00" }, { capabilityId: "orders", name: "归还验收跟进", frequency: "daily", time: "16:00" }, { capabilityId: "review", name: "每周经营复盘", frequency: "weekly", time: "17:00" }] as const;
    operator.setTasks(previous => [...previous, ...candidates.filter(candidate => allowed(candidate.capabilityId) && !previous.some(task => task.name === candidate.name)).map(candidate => ({ ...candidate, id: crypto.randomUUID(), enabled: true, prompt: OPERATOR_CAPABILITIES.find(item => item.id === candidate.capabilityId)!.prompt }))]);
  }
  return <section className="operator-catalog"><header className="operator-section-header"><div><h1 data-icon-hover=""><AnimatedIcon name="schedule" />自动化任务</h1><p>设定时间与目标，让重复待办按计划整理</p></div><Button type="primary" icon={<Plus size={16} />} disabled onClick={create}>新建任务</Button></header>
    <div className="operator-automation-note"><AnimatedIcon name="schedule" /><span>此控制台尚未开放计划自动运行，请使用原经营自动化入口。</span></div>
    {operator.tasks.length ? <><div className="operator-catalog-search"><Input allowClear aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="operator-task-list">{visible.map(task => <article key={task.id} className="operator-task-row"><AnimatedIcon name="schedule" /><div><h2>{task.name}</h2><p>{frequencyLabels[task.frequency]} {task.time} · {OPERATOR_CAPABILITIES.find(item => item.id === task.capabilityId)?.name}</p></div><div className="operator-task-actions"><Switch aria-label={`${task.name}开关`} checked={task.enabled} disabled={!allowed(task.capabilityId)} onChange={enabled => operator.setTasks(previous => previous.map(item => item.id === task.id ? { ...item, enabled } : item))} /><Button disabled={!task.enabled || !allowed(task.capabilityId)} onClick={() => operator.runTask(task)}>运行演示</Button><Button onClick={() => { setEditing({ ...task }); setError(""); }}>编辑</Button><Button type="text" aria-label={`删除${task.name}`} icon={<X size={16} />} onClick={() => operator.setTasks(previous => previous.filter(item => item.id !== task.id))} /></div></article>)}</div>{!visible.length && <p className="operator-empty">没有匹配的任务</p>}</> : <div className="operator-task-empty"><AnimatedIcon name="schedule" /><h2>把重复待办安排好</h2><p>从晨间简报、归还跟进或每周复盘开始。</p><Button disabled onClick={presets}>计划任务尚未接入</Button></div>}
    <Modal title={editing && operator.tasks.some(task => task.id === editing.id) ? "编辑演示任务" : "新建演示任务"} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={save} okText="保存演示任务">
      {editing && <form className="operator-task-form" onSubmit={event => { event.preventDefault(); save(); }}>
        <label>任务名称<Input maxLength={40} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>经营能力<Select aria-label="经营能力" value={editing.capabilityId} options={operator.available.map(item => ({ label: item.name, value: item.id }))} onChange={capabilityId => setEditing({ ...editing, capabilityId })} /></label>
        <div className="operator-form-pair"><label>重复<Select aria-label="重复频率" value={editing.frequency} options={Object.entries(frequencyLabels).map(([value, label]) => ({ value, label }))} onChange={frequency => setEditing({ ...editing, frequency })} /></label><label>时间<Input type="time" aria-label="运行时间" value={editing.time} onChange={event => setEditing({ ...editing, time: event.target.value })} /></label></div>
        <label>任务要求<Input.TextArea rows={3} maxLength={1000} value={editing.prompt} onChange={event => setEditing({ ...editing, prompt: event.target.value })} /></label>
        {error && <p role="alert">{error}</p>}
      </form>}
    </Modal>
  </section>;
}
