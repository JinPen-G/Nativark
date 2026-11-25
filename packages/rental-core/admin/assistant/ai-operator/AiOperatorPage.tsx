import { useRentalAssistant } from "../host";
import { useEffect, useRef, useState } from "react";

import { readConversationNavigation } from "../ai-native/conversation-navigation";
import { useLocation, useNavigate } from "../host";

import { useLocale } from "@rental-os/platform-admin/locale";
import { Button, Drawer, Input, Switch } from "@rental-os/platform-admin/ui";
import { AnimatedIcon } from "@rental-os/platform-admin/source/components/ui/AnimatedIcon";
import { ArcLocale } from "@rental-os/platform-admin/source/components/ui/ArcLocale";
import { ContentTransition } from "@rental-os/platform-admin/source/components/workspace/ContentTransition";
import { WorkspacePageTitle } from "@rental-os/platform-admin/source/components/workspace/WorkspaceHeader";
import { VisibleObservationHost, useVisibleObservationHost } from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost";
import { VisibleObservationBoundary } from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationBoundary";
import { AI_QUOTE_GOAL_LIMITS } from '@rental-os/shared';
import { AiChat } from "./archive/ai-chat/AiChat";
import { NATIVE_GATEWAY_MODEL } from "./OperatorContext";
import { NativeOperatorWorkspace } from "./NativeOperatorWorkspace";
import { ResizablePanels, ResizablePanel } from "@/registry/components/resizable-panels/resizable-panels";
import { Card } from "@/registry/components/card/card";
import { useOperator } from "./OperatorContext";
import { resolveAdminBrandName } from "@rental-os/platform-admin/shell";

import "./ai-operator.css";
import "./archive-adapter.css";

/** Model selection belongs to the persisted server route, never a local menu. */
function useConfiguredChatModels() { return { models: [NATIVE_GATEWAY_MODEL], defaultModel: NATIVE_GATEWAY_MODEL.id }; }
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1050px)").matches);
  useEffect(() => { const media = matchMedia("(max-width: 1050px)"); const change = () => setNarrow(media.matches); media.addEventListener("change", change); change(); return () => media.removeEventListener("change", change); }, []);
  return narrow;
}
export function AiOperatorPage() {
  const { currentSessionEpoch, useAuthStore } = useRentalAssistant();

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
              modelMenu: '服务端当前路由', modelLocked: true, attachments: false, canSend: operator.canSend, onHistory: () => void operator.history(), onRetry: operator.retryOriginal, onReplyStarted: operator.registerReply,
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
  return <section className="operator-catalog">
    <WorkspacePageTitle><h1 className="workspace-page-title">插件</h1></WorkspacePageTitle>
    <header className="operator-section-header"><p>选择对话可使用的经营能力</p><span className="operator-demo-tag">当前能力</span></header>
    <div className="operator-catalog-search"><Input allowClear aria-label="搜索插件" placeholder="搜索能力" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="operator-plugin-grid">{operator.permitted.filter(item => `${item.name}${item.description}`.includes(query.trim())).map(item => <Card key={item.id} title={item.name} description={item.description} className="operator-plugin-card"
      avatar={<span className="operator-plugin-icon"><AnimatedIcon name={item.icon} /></span>} meta={item.nativeScene ? "在工作台办理" : "在原业务页面办理"} action={<Switch aria-label={`显示${item.name}入口`} checked={!operator.disabled.includes(item.id)} onChange={next => operator.togglePlugin(item.id, next)} />} />)}</div>
    {!operator.permitted.some(item => `${item.name}${item.description}`.includes(query.trim())) && <p className="operator-empty">没有匹配的可用能力</p>}
    <p className="operator-caption">按当前账号权限展示。开关控制本页入口，服务端继续核验实际权限与能力。</p>
  </section>;
}
function AutomationTasks() {
  const { APP_ROUTES, canAccessRoute, useAuthStore } = useRentalAssistant();

  const auth = useAuthStore(), navigate = useNavigate(), { t } = useLocale();
  const route = APP_ROUTES.aiTasks;
  const allowed = canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode, !!auth.user?.isSaasAdmin, auth.hasTenantMembershipPermission);
  return <section className="operator-catalog">
    <WorkspacePageTitle><h1 className="workspace-page-title">{t('自动化任务')}</h1></WorkspacePageTitle>
    <div className="operator-automation-note"><AnimatedIcon name="schedule" /><span>{t('当前工作台尚未开放定时运行。')}</span></div>
    {allowed && <Button onClick={() => navigate(route.path)}>{t('查看已有 AI 任务')}</Button>}
  </section>;
}
