import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fromMessages, visibleMessages, type ChatConversation, type ChatRespond, type ChatModel } from "./archive/ai-chat/chat-state";
import type { AgentRunState } from "./archive/agent-run/agent-run-state";
import { OPERATOR_MODELS, demoAnswer, demoPause, demoResources, demoSteps, demoTool } from "./demo-response";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { useAuthStore } from "@/features/auth/authStore";
import { OPERATOR_CAPABILITIES, exampleArtifact, type OperatorArtifact } from "./capabilities";

export type OperatorView = "chat" | "plugins" | "automations";
interface ThreadDetails { capabilityId: string; artifact?: OperatorArtifact; step: number; running: boolean; receipt?: string; run?: AgentRunState; runId?: string; runModel?: ChatModel }
export interface OperatorTask { id: string; name: string; capabilityId: string; frequency: "daily" | "weekdays" | "weekly"; time: string; prompt: string; enabled: boolean }
const id = () => crypto.randomUUID();
function useOperatorState() {
  const auth = useAuthStore();
  const permitted = OPERATOR_CAPABILITIES.filter(capability => {
    const route = Object.values(APP_ROUTES).find(entry => entry.path === capability.route);
    return route && canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission);
  });
  const [disabled, setDisabled] = useState<string[]>([]);
  const available = permitted.filter(item => !disabled.includes(item.id));
  const [chats, setChats] = useState<ChatConversation[]>(() => [fromMessages(id(), "新对话", [], "今天"),
    ...permitted.slice(1, 4).map(item => fromMessages(`demo-history-${item.id}`, `${item.name} · 示例对话`, [
      { id: id(), role: "user", content: item.prompt },
      { id: id(), role: "assistant", content: demoAnswer(item), model: OPERATOR_MODELS[0], reasoning: "本地示例：整理资料、核对规则与生成结果；未读取真实业务数据。", thoughtFor: 1,
        tools: [demoTool(item, 1, "done"), demoTool(item, 2, "done")], sources: demoResources(item), status: "done" },
    ], "示例对话"))]);
  const [activeId, setActiveId] = useState(chats[0].id);
  const [details, setDetails] = useState<Record<string, ThreadDetails>>(() => Object.fromEntries(chats.map((chat, index) => {
    const selected = index ? permitted[index] : permitted[0];
    return [chat.id, { capabilityId: selected?.id ?? "brief", running: false, step: index ? 4 : 0, ...(index && selected ? { artifact: exampleArtifact(selected) } : {}) }];
  })));
  const [view, setView] = useState<OperatorView>("chat");
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [queuedPrompt, setQueuedPrompt] = useState<{ id: string; text: string; chatId: string } | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const alive = useRef(true), objectUrls = useRef<string[]>([]), demoFailures = useRef(new Set<string>());
  const threads = chats.map(chat => ({ ...chat, messages: visibleMessages(chat), ...(details[chat.id] ?? { capabilityId: permitted[0]?.id ?? "brief", running: false, step: 0 }) }));
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const active = threads.find(thread => thread.id === activeId) ?? threads[0];
  const capability = OPERATOR_CAPABILITIES.find(item => item.id === active.capabilityId) ?? OPERATOR_CAPABILITIES[0];
  const enabled = available.some(item => item.id === active.capabilityId);
  const patch = useCallback((threadId: string, update: (thread: ThreadDetails) => ThreadDetails) => {
    setDetails(previous => ({ ...previous, [threadId]: update(previous[threadId] ?? { capabilityId: "brief", running: false, step: 0 }) }));
  }, []);
  function cancel() { generation.current++; request.current?.abort(); request.current = null; }
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); objectUrls.current.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  function createConversation(capabilityId = available[0]?.id ?? permitted[0]?.id ?? "brief") {
    cancel(); const threadId = id();
    setChats(previous => [fromMessages(threadId, "新对话", [], "今天"), ...previous].slice(0, 20));
    patch(threadId, () => ({ capabilityId, running: false, step: 0 }));
    setActiveId(threadId); setView("chat"); return threadId;
  }
  function selectConversation(threadId: string) { if (activeId !== threadId) cancel(); setActiveId(threadId); setView("chat"); }
  function chooseCapability(capabilityId: string) {
    const previous = threadsRef.current.find(thread => thread.capabilityId === capabilityId);
    if (previous) selectConversation(previous.id); else createConversation(capabilityId);
  }
  const respond: ChatRespond = async function* (messages, { signal, model, chatId }) {
    const threadId = chatId ?? activeId;
    const selectedThread = threadsRef.current.find(thread => thread.id === threadId);
    const selected = OPERATOR_CAPABILITIES.find(item => item.id === selectedThread?.capabilityId) ?? capability;
    if (!available.some(item => item.id === selected.id)) { yield { type: "error", message: "请先在插件页启用此能力。" }; return; }
    cancel(); const token = generation.current, abort = new AbortController(); request.current = abort;
    const stop = () => abort.abort(); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) abort.abort();
    const spec = demoSteps(selected), started = performance.now(), runId = id();
    const current = () => alive.current && token === generation.current && !abort.signal.aborted;
    const publish = (index: number, complete = false) => {
      if (!current()) return;
      const steps = spec.slice(0, index + 1).map((step, i) => ({ ...step, status: i < index || complete ? "done" as const : "running" as const, durationMs: i < index || complete ? 900 : undefined, ...(step.progress ? { progress: { ...step.progress, value: complete || i < index ? step.progress.total : 1 } } : {}) }));
      patch(threadId, previous => ({ ...previous, step: index, running: !complete, runModel: model, run: { status: complete ? "done" : "working", elapsedMs: performance.now() - started, steps } }));
    };
    const prompt = messages.filter(message => message.role === "user").at(-1)?.content ?? selected.name;
    setChats(previous => previous.map(chat => chat.id === threadId ? { ...chat, title: prompt.slice(0, 26) || "附件演示" } : chat));
    patch(threadId, previous => ({ ...previous, running: true, artifact: undefined, receipt: undefined, runId }));
    try {
      publish(0);
      yield { type: "reasoning", delta: `本地执行摘要：确定${selected.name}的资料范围，读取示例记录，核对关联规则，再整理可核对的结果。` };
      await demoPause(700, abort.signal);
      yield { type: "reasoning-end", seconds: 1 };
      for (const index of [1, 2, 3]) {
        publish(index);
        if (index < 3) yield { type: "tool", tool: demoTool(selected, index, "running") };
        await demoPause(950, abort.signal);
        const failureKey = `${threadId}:${prompt}`;
        if (index === 1 && /\[error\]|模拟失败/.test(prompt) && !demoFailures.current.has(failureKey)) {
          demoFailures.current.add(failureKey);
          yield { type: "tool", tool: { ...demoTool(selected, index, "error"), summary: "模拟读取失败", output: "本地演示：点击重试可重新运行，没有请求真实服务。" } };
          throw new Error("示例读取失败。可点击重试，继续体验本地流程。");
        }
        if (index < 3) yield { type: "tool", tool: demoTool(selected, index, "done") };
      }
      yield { type: "sources", sources: demoResources(selected) };
      for (const chunk of demoAnswer(selected).match(/.{1,14}/gs) ?? []) {
        await demoPause(28, abort.signal); yield { type: "text", delta: chunk };
      }
      if (current()) { publish(3, true); patch(threadId, previous => ({ ...previous, artifact: exampleArtifact(selected) })); }
    } finally {
      signal.removeEventListener("abort", stop);
      if (alive.current && request.current === abort) request.current = null;
      // Only this run may finish its workspace. A newer run owns subsequent updates.
      if (alive.current) {
        patch(threadId, previous => previous.runId === runId && previous.running ? { ...previous, running: false, run: previous.run ? { ...previous.run, status: "stopped", steps: previous.run.steps.map(step => step.status === "running" ? { ...step, status: "rejected", doneVerb: "已停止" } : step) } : undefined } : previous);
      }
    }
  };
  function runTask(task: OperatorTask) {
    if (!available.some(item => item.id === task.capabilityId)) return;
    const chatId = createConversation(task.capabilityId);
    setQueuedPrompt({ id: id(), text: task.prompt, chatId });
  }
  function confirm() {
    if (!active.artifact || active.running) return;
    patch(activeId, thread => ({ ...thread, receipt: `演示回执 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · 已确认此示例，未提交真实业务。` }));
  }
  function togglePlugin(capabilityId: string, next: boolean) {
    if (!next && active.capabilityId === capabilityId) cancel();
    setDisabled(previous => next ? previous.filter(value => value !== capabilityId) : [...new Set([...previous, capabilityId])]);
  }
  return { permitted, available, disabled, togglePlugin, chats, setChats, objectUrls, activeId, queuedPrompt, setQueuedPrompt, respond, threads, active, capability, enabled, view, setView, createConversation, selectConversation, chooseCapability, cancel, confirm, tasks, setTasks, runTask };
}
type OperatorState = ReturnType<typeof useOperatorState>;
const OperatorContext = createContext<OperatorState | null>(null);
/** Mounted inside the authenticated tenant/workspace shell: no cross-scope persistence or API calls. */
export function OperatorProvider({ children }: { children: ReactNode }) { const state = useOperatorState(); return <OperatorContext.Provider value={state}>{children}</OperatorContext.Provider>; }
export function useOperator() { const value = useContext(OperatorContext); if (!value) throw new Error("OperatorProvider required"); return value; }
