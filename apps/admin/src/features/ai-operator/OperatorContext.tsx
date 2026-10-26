import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatDraft, ChatMessage } from "@/registry/components/chat-thread/chat-thread";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { useAuthStore } from "@/features/auth/authStore";
import { OPERATOR_CAPABILITIES, exampleArtifact, type OperatorArtifact } from "./capabilities";

export type OperatorView = "chat" | "plugins" | "automations";
export interface Conversation { id: string; capabilityId: string; title: string; messages: ChatMessage[]; artifact?: OperatorArtifact; step: number; running: boolean; receipt?: string }
export interface OperatorTask { id: string; name: string; capabilityId: string; frequency: "daily" | "weekdays" | "weekly"; time: string; prompt: string; enabled: boolean }
const id = () => crypto.randomUUID();
const newThread = (capabilityId = "brief"): Conversation => ({ id: id(), capabilityId, title: "新对话", messages: [], step: 0, running: false });
function useOperatorState() {
  const auth = useAuthStore();
  const permitted = OPERATOR_CAPABILITIES.filter(capability => {
    const route = Object.values(APP_ROUTES).find(entry => entry.path === capability.route);
    return route && canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission);
  });
  const [disabled, setDisabled] = useState<string[]>([]);
  const available = permitted.filter(item => !disabled.includes(item.id));
  const [threads, setThreads] = useState<Conversation[]>(() => [newThread(permitted[0]?.id)]);
  const [activeId, setActiveId] = useState(threads[0].id);
  const [view, setView] = useState<OperatorView>("chat");
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0), alive = useRef(true);
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const active = threads.find(thread => thread.id === activeId) ?? threads[0];
  const capability = OPERATOR_CAPABILITIES.find(item => item.id === active.capabilityId) ?? OPERATOR_CAPABILITIES[0];
  const enabled = available.some(item => item.id === active.capabilityId);
  const patch = (threadId: string, update: (thread: Conversation) => Conversation) => setThreads(previous => previous.map(thread => thread.id === threadId ? update(thread) : thread));
  function cancel() {
    generation.current++;
    timers.current.forEach(clearTimeout); timers.current = [];
    setThreads(previous => previous.map(thread => thread.running ? { ...thread, running: false,
      messages: [...thread.messages, { id: id(), authorId: "agent", createdAt: Date.now(), text: "演示已停止。你可以调整要求后重新发送。" }] } : thread));
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; timers.current.forEach(clearTimeout); }; }, []);
  function createConversation(capabilityId = available[0]?.id ?? permitted[0]?.id ?? "brief") {
    cancel(); const thread = newThread(capabilityId);
    setThreads(previous => [thread, ...previous].slice(0, 20)); setActiveId(thread.id); setView("chat");
    return thread.id;
  }
  function selectConversation(threadId: string) { if (activeId !== threadId) cancel(); setActiveId(threadId); setView("chat"); }
  function chooseCapability(capabilityId: string) {
    const previous = threadsRef.current.find(thread => thread.capabilityId === capabilityId);
    if (previous) selectConversation(previous.id); else createConversation(capabilityId);
  }
  function send(draft: ChatDraft, threadId = activeId, capabilityId = active.capabilityId) {
    if ((!draft.text.trim() && !draft.files.length) || !available.some(item => item.id === capabilityId)) return;
    cancel(); const token = generation.current;
    const selected = OPERATOR_CAPABILITIES.find(item => item.id === capabilityId)!;
    patch(threadId, thread => ({ ...thread, title: draft.text.trim().slice(0, 18) || "附件演示", artifact: undefined, receipt: undefined, running: true, step: 0,
      messages: [...thread.messages, { id: id(), authorId: "me", createdAt: Date.now(), text: draft.text,
        attachments: draft.files.map(file => ({ id: id(), name: file.name, kind: "file", size: file.size })) },
      { id: id(), authorId: "agent", createdAt: Date.now(), text: `我会演示如何整理「${selected.name}」的结果。当前未连接模型或业务数据${draft.files.length ? "；附件仅显示文件名，不会上传或解析" : ""}。` }] }));
    [400, 900, 1500].forEach((delay, index) => timers.current.push(setTimeout(() => {
      if (!alive.current || token !== generation.current) return;
      patch(threadId, thread => ({ ...thread, step: index + 1, running: index !== 2,
        ...(index === 2 ? { artifact: exampleArtifact(selected), messages: [...thread.messages,
          { id: id(), authorId: "agent", createdAt: Date.now(), text: `「${exampleArtifact(selected).title}」已在工作区展示。你可以核对示例结果，或继续提出要求。` }] } : {}) }));
    }, delay)));
  }
  function runTask(task: OperatorTask) {
    if (!available.some(item => item.id === task.capabilityId)) return;
    const threadId = createConversation(task.capabilityId);
    // State updates are queued in order; the local demo targets the newly created thread explicitly.
    send({ text: task.prompt, files: [] }, threadId, task.capabilityId);
  }
  function confirm() {
    if (!active.artifact || active.running) return;
    patch(activeId, thread => ({ ...thread, receipt: `演示回执 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · 已确认此示例，未提交真实业务。` }));
  }
  function togglePlugin(capabilityId: string, next: boolean) {
    if (!next && active.capabilityId === capabilityId) cancel();
    setDisabled(previous => next ? previous.filter(value => value !== capabilityId) : [...new Set([...previous, capabilityId])]);
  }
  return { permitted, available, disabled, togglePlugin, threads, active, capability, enabled, view, setView, createConversation, selectConversation, chooseCapability, send, cancel, confirm, tasks, setTasks, runTask };
}
type OperatorState = ReturnType<typeof useOperatorState>;
const OperatorContext = createContext<OperatorState | null>(null);
/** Mounted inside the authenticated tenant/workspace shell: no cross-scope persistence or API calls. */
export function OperatorProvider({ children }: { children: ReactNode }) { const state = useOperatorState(); return <OperatorContext.Provider value={state}>{children}</OperatorContext.Provider>; }
export function useOperator() { const value = useContext(OperatorContext); if (!value) throw new Error("OperatorProvider required"); return value; }
