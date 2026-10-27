import { useEffect, useRef, useState } from "react";
import { Copy, Download, PanelRightClose, PanelRightOpen, Plus, X } from "lucide-react";
import { Button, Drawer, Input, Modal, Select, Switch } from "@/components/ui";
import { AnimatedIcon } from "@/components/ui/AnimatedIcon";
import { ArcLocale } from "@/components/ui/ArcLocale";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { AiChat } from "./archive/ai-chat/AiChat";
import { AgentRun } from "./archive/agent-run/AgentRun";
import { BrandMark } from "./archive/shared/BrandMark";
import { OPERATOR_MODELS } from "./demo-response";
import { ResizablePanels, ResizablePanel } from "@/registry/components/resizable-panels/resizable-panels";
import { Card } from "@/registry/components/card/card";
import { useOperator, type OperatorTask } from "./OperatorContext";
import { OPERATOR_CAPABILITIES, type OperatorArtifact } from "./capabilities";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import "./ai-operator.css";
import "./archive-adapter.css";

const frequencyLabels = { daily: "每天", weekdays: "工作日", weekly: "每周一" };
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1050px)").matches);
  useEffect(() => { const media = matchMedia("(max-width: 1050px)"); const change = () => setNarrow(media.matches); media.addEventListener("change", change); change(); return () => media.removeEventListener("change", change); }, []);
  return narrow;
}
export function AiOperatorPage() {
  const operator = useOperator();
  const tenant = useAuthStore(state => state.tenant), user = useAuthStore(state => state.user);
  const title = operator.view === "chat" ? operator.capability.name : operator.view === "plugins" ? "插件" : "自动化任务";
  useEffect(() => { document.title = `${title} · AI运营官 · ${resolveAdminBrandName(tenant, user)}`; }, [title, tenant, user]);
  return <ArcLocale><ContentTransition value={operator.view} className="operator-page">
    {operator.view === "chat" ? <OperatorChat /> : operator.view === "plugins" ? <PluginCatalog /> : <AutomationTasks />}
  </ContentTransition></ArcLocale>;
}
function OperatorChat() {
  const operator = useOperator(), narrow = useNarrow();
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
  return <section className="operator-chat-layout" data-narrow={narrow || undefined} aria-label="AI运营官对话">
    <div className="operator-split" ref={split}>
      <ResizablePanels label="对话与Agent工作区" onLayoutChange={sizes => setWorkOpen(sizes[1] > 1)}>
        <ResizablePanel id="operator-conversation" label="聊天区" defaultSize={60} minSize={340}>
          <AiChat className="operator-archive-chat"
            store={{ chats: operator.chats, setChats: operator.setChats, activeId: operator.activeId, objectUrls: operator.objectUrls, setActiveId: operator.selectConversation }}
            respond={operator.respond} autoPlay={false} models={OPERATOR_MODELS} defaultModel="everyday"
            disabled={!operator.enabled} greeting={operator.capability.description} placeholder="说出经营目标，或继续补充要求…"
            suggestions={[{ label: operator.capability.prompt, icon: "activity" }]}
            onNewChat={() => operator.createConversation(operator.capability.id)}
            queuedPrompt={operator.queuedPrompt} onQueuedPromptUsed={() => operator.setQueuedPrompt(null)}
            headerActions={<Button type="text" aria-label={workOpen && !narrow ? "收起工作区" : "打开工作区"} icon={workOpen && !narrow ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />} aria-expanded={narrow ? mobileOpen : workOpen} aria-controls={narrow ? "operator-mobile-work" : "operator-work"} onClick={toggleWork} />}
          />
        </ResizablePanel>
        <ResizablePanel id="operator-work" label="Agent工作区" defaultSize={40} minSize={310} maxSize={720} collapsible defaultCollapsed={narrow}>
          {!narrow && <WorkArea />}
        </ResizablePanel>
      </ResizablePanels>
    </div>
    <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="Agent 工作区" destroyOnHidden width="min(100vw, 520px)"><div id="operator-mobile-work" className="operator-mobile-work"><WorkArea /></div></Drawer>
  </section>;
}
function WorkArea() {
  const operator = useOperator(), thread = operator.active;
  const [confirmOpen, setConfirmOpen] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { setConfirmOpen(false); setNotice(""); }, [thread.id, thread.artifact]);
  const artifact = thread.artifact;
  const printable = artifact ? [artifact.title, artifact.summary, ...(artifact.metrics ?? []).map(item => `${item.label}：${item.value}`), artifact.columns.join(" | "), ...artifact.rows.map(row => row.join(" | ")), artifact.note].join("\n\n") : "";
  async function copy() { try { await navigator.clipboard.writeText(printable); setNotice("已复制示例结果"); } catch { setNotice("浏览器未允许复制，请使用下载"); } }
  function download() { if (!artifact) return; const url = URL.createObjectURL(new Blob([printable], { type: "text/plain;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${artifact.title}-示例.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已下载示例结果"); }
  return <section className="operator-work-area" aria-label="Agent工作区">
    <header><span><AnimatedIcon name="folder" /> Agent 工作区</span><span className="operator-demo-tag">示例</span></header>
    <ContentTransition value={`${thread.id}:${artifact ? "result" : thread.run ? "run" : "empty"}`} className="operator-work-body">
      {artifact ? <ArtifactView artifact={artifact} /> : thread.run ? <div className="operator-run-host"><AgentRun key={thread.runId} task={`${operator.capability.name} · 执行过程`} model={{ name: thread.runModel?.name ?? "日常助手", mark: <BrandMark brand={thread.runModel?.brand ?? "openai"} size={14} /> }} run={thread.run} autoPlay={false} activityOnly /></div> : <div className="operator-work-empty"><AnimatedIcon name="folder" /><h2>结果会出现在这里</h2><p>运行时展示资料与工具步骤，完成后在这里核对结果。</p></div>}

    </ContentTransition>
    <footer className="operator-work-footer">
      {artifact && <><div className="operator-result-tools"><Button size="small" icon={<Copy size={14} />} onClick={copy}>复制</Button><Button size="small" icon={<Download size={14} />} onClick={download}>下载</Button></div>
        {operator.capability.action && <Button type="primary" block disabled={Boolean(thread.receipt) || !operator.enabled} onClick={() => setConfirmOpen(true)}>{thread.receipt ? "已确认此示例" : operator.capability.action}</Button>}
        <p className="operator-caption" role="status">{thread.receipt || notice || artifact.note}</p></>}
    </footer>
    <Modal open={confirmOpen} title="确认此演示结果" okText="确认并生成演示回执" onCancel={() => setConfirmOpen(false)} onOk={() => { operator.confirm(); setConfirmOpen(false); }}>
      <p>将确认「{artifact?.title}」的示例内容。此操作只生成本地演示回执，不会创建订单、分派任务或扣款。</p>
    </Modal>
  </section>;
}
function ArtifactView({ artifact }: { artifact: OperatorArtifact }) {
  const timeline = ["schedule", "tasks", "document"].includes(artifact.kind);
  return <article className="operator-artifact" data-format={artifact.kind}>
    <h2>{artifact.title}</h2><p>{artifact.summary}</p>
    {artifact.metrics && <div className="operator-metrics">{artifact.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.note && <small>{metric.note}</small>}</div>)}</div>}
    {artifact.kind === "quote" && <dl className="operator-quote-context"><div><dt>客户</dt><dd>示例客户A</dd></div><div><dt>租期</dt><dd>周六至周日 · 2天</dd></div><div><dt>资源</dt><dd>摄影套装 × 2</dd></div></dl>}
    {timeline ? <ol className="operator-timeline">{artifact.rows.map((row, index) => <li key={row[0]}><span className="operator-step-number">{index + 1}</span><div><h3>{row[0]}</h3><p>{row.slice(1).join(" · ")}</p></div></li>)}</ol> : <div className="operator-result-table"><table><caption className="sr-only">{artifact.title} · 示例数据</caption><thead><tr>{artifact.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{artifact.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {artifact.kind === "trend" && <div className="operator-trend" aria-label="演示订单量：上周19，本周24"><div><span>上周</span><meter min={0} max={30} value={19}>19</meter><b>19</b></div><div><span>本周</span><meter min={0} max={30} value={24}>24</meter><b>24</b></div></div>}
  </article>;
}
function PluginCatalog() {
  const operator = useOperator(); const [query, setQuery] = useState("");
  return <section className="operator-catalog"><header className="operator-section-header"><div><h1 data-icon-hover=""><AnimatedIcon name="plugins" />插件</h1><p>选择对话可使用的经营能力</p></div><span className="operator-demo-tag">前端演示</span></header>
    <div className="operator-catalog-search"><Input allowClear aria-label="搜索插件" placeholder="搜索能力" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="operator-plugin-grid">{operator.permitted.filter(item => `${item.name}${item.description}`.includes(query.trim())).map(item => <Card key={item.id} title={item.name} description={item.description} className="operator-plugin-card"
      avatar={<span className="operator-plugin-icon"><AnimatedIcon name={item.icon} /></span>} meta="经营能力 · 演示" action={<Switch aria-label={`启用${item.name}`} checked={!operator.disabled.includes(item.id)} onChange={next => operator.togglePlugin(item.id, next)} />} />)}</div>
    {!operator.permitted.some(item => `${item.name}${item.description}`.includes(query.trim())) && <p className="operator-empty">没有匹配的可用能力</p>}
    <p className="operator-caption">按当前账号的页面权限展示；开关仅影响本次演示，不改变实际权限。</p>
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
  return <section className="operator-catalog"><header className="operator-section-header"><div><h1 data-icon-hover=""><AnimatedIcon name="schedule" />自动化任务</h1><p>设定时间与目标，让重复待办按计划整理</p></div><Button type="primary" icon={<Plus size={16} />} disabled={!operator.available.length} onClick={create}>新建任务</Button></header>
    <div className="operator-automation-note"><AnimatedIcon name="schedule" /><span>前端演示：任务仅保留在当前会话，不会按时自动执行；可手动运行查看效果。</span></div>
    {operator.tasks.length ? <><div className="operator-catalog-search"><Input allowClear aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="operator-task-list">{visible.map(task => <article key={task.id} className="operator-task-row"><AnimatedIcon name="schedule" /><div><h2>{task.name}</h2><p>{frequencyLabels[task.frequency]} {task.time} · {OPERATOR_CAPABILITIES.find(item => item.id === task.capabilityId)?.name}</p></div><div className="operator-task-actions"><Switch aria-label={`${task.name}开关`} checked={task.enabled} disabled={!allowed(task.capabilityId)} onChange={enabled => operator.setTasks(previous => previous.map(item => item.id === task.id ? { ...item, enabled } : item))} /><Button disabled={!task.enabled || !allowed(task.capabilityId)} onClick={() => operator.runTask(task)}>运行演示</Button><Button onClick={() => { setEditing({ ...task }); setError(""); }}>编辑</Button><Button type="text" aria-label={`删除${task.name}`} icon={<X size={16} />} onClick={() => operator.setTasks(previous => previous.filter(item => item.id !== task.id))} /></div></article>)}</div>{!visible.length && <p className="operator-empty">没有匹配的任务</p>}</> : <div className="operator-task-empty"><AnimatedIcon name="schedule" /><h2>把重复待办安排好</h2><p>从晨间简报、归还跟进或每周复盘开始。</p><Button disabled={!operator.available.length} onClick={presets}>添加示例任务</Button></div>}
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
