import { Button, Segmented } from "@/components/ui";
import { AnimatedIcon } from "@/components/ui/AnimatedIcon";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/animate-sidebar/runtime/sidebar";
import { useOperator } from "./OperatorContext";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";

export function OperatorModeSwitch({ ai, onChange }: { ai: boolean; onChange: (ai: boolean) => void }) {
  return <div className="operator-mode-switch">
    <div className="operator-mode-expanded"><Segmented block aria-label="工作模式" value={ai ? "ai" : "admin"} options={[{ label: "AI运营官", value: "ai" }, { label: "管理后台", value: "admin" }]} onChange={value => onChange(value === "ai")} /></div>
    <div className="operator-mode-collapsed"><Button type="text" aria-label={ai ? "切换到管理后台" : "切换到AI运营官"} title={ai ? "管理后台" : "AI运营官"} icon={<AnimatedIcon name={ai ? "dashboard" : "ai"} />} onClick={() => onChange(!ai)} /></div>
  </div>;
}
export function AiOperatorNavigation({ query }: { query: string }) {
  const operator = useOperator();
  const matches = (text: string) => !query.trim() || text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const selected = operator.view === "chat" ? operator.available.some(item => item.id === operator.active.capabilityId && matches(item.name)) ? operator.active.capabilityId : null : operator.view;
  return <Highlight mode="parent" controlledItems value={selected} enabled={selected !== null} hover={false} click={false} containerClassName="rental-sidebar-navigation operator-navigation" className="rental-sidebar-route-highlight">
    <SidebarGroup><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton tooltip="新对话" onClick={() => operator.createConversation()} data-sound="press"><AnimatedIcon name="ai" /><span>新对话</span></SidebarMenuButton></SidebarMenuItem>
      {([['plugins', '插件', 'plugins'], ['automations', '自动化任务', 'schedule']] as const).filter(([, title]) => matches(title)).map(([view, title, icon]) => <SidebarMenuItem key={view}>
        <HighlightItem value={view} asChild><div className="rental-sidebar-route-target"><SidebarMenuButton tooltip={title} isActive={operator.view === view} aria-current={operator.view === view ? "page" : undefined} onClick={() => operator.setView(view)} data-sound="press"><AnimatedIcon name={icon} /><span>{title}</span></SidebarMenuButton></div></HighlightItem>
      </SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>
    <SidebarGroup><SidebarGroupLabel>经营能力</SidebarGroupLabel><SidebarMenu>
      {operator.available.filter(item => matches(item.name)).map(item => <SidebarMenuItem key={item.id}>
        <HighlightItem value={item.id} asChild><div className="rental-sidebar-route-target"><SidebarMenuButton tooltip={item.name} isActive={operator.view === "chat" && operator.active.capabilityId === item.id} aria-current={operator.view === "chat" && operator.active.capabilityId === item.id ? "page" : undefined} onClick={() => operator.chooseCapability(item.id)} data-sound="press"><AnimatedIcon name={item.icon} /><span>{item.name}</span></SidebarMenuButton></div></HighlightItem>
      </SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>
    {operator.capabilityThreads.some(thread => thread.messages.length) && <SidebarGroup className="operator-history"><SidebarGroupLabel>当前能力的对话</SidebarGroupLabel><SidebarMenu>
      {operator.capabilityThreads.filter(thread => thread.messages.length && matches(thread.title)).map(thread => <SidebarMenuItem key={thread.id}><SidebarMenuButton tooltip={thread.title} onClick={() => operator.selectConversation(thread.id)} data-sound="press"><AnimatedIcon name="messages" /><span>{thread.title}</span></SidebarMenuButton></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>}
  </Highlight>;
}
