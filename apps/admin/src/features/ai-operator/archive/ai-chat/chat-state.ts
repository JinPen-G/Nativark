export type ChatModel = { id: string; name: string; note?: string; color?: string; brand?: string };
export type ChatSource = { id: string; title: string; url: string; description?: string; brand?: string };
export type ChatTool = { id: string; name: string; status: 'running' | 'done' | 'error'; summary?: string; input?: string; output?: string; sources?: ChatSource[]; queries?: string[]; kind?: 'search' | 'query'; brand?: string };
export type ChatAttachment = { id: string; name: string; size: number; type: string; preview?: string };
export type AiChatMessage = {
  id: string; role: 'user' | 'assistant'; content: string;
  model?: ChatModel; reasoning?: string; thoughtFor?: number; tools?: ChatTool[];
  sources?: ChatSource[]; attachments?: ChatAttachment[];
  status?: 'thinking' | 'streaming' | 'done' | 'stopped' | 'error'; error?: string;
  feedback?: 'up' | 'down' | null;
};
export type ChatStreamEvent =
  | { type: 'reasoning'; delta: string }
  | { type: 'reasoning-end'; seconds?: number }
  | { type: 'text'; delta: string }
  | { type: 'tool'; tool: ChatTool }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'error'; message: string };
export type ChatRespond = (messages: AiChatMessage[], options: { signal: AbortSignal; model: ChatModel; chatId?: string }) => AsyncIterable<ChatStreamEvent>;
export type ChatNode = AiChatMessage & { parent: string };
export type ChatConversation = { id: string; title: string; group?: string; nodes: ChatNode[]; choices: Record<string, string> };
export type AiChatHistoryItem = { id: string; title: string; group?: string; messages: AiChatMessage[] };
export const ROOT = 'root';
export const uid = () => crypto.randomUUID();

export function fromMessages(id: string, title: string, messages: AiChatMessage[], group = 'Today'): ChatConversation {
  let parent = ROOT;
  const choices: Record<string, string> = {};
  const nodes = messages.map(message => {
    const node = { ...message, parent };
    choices[parent] = node.id;
    parent = node.id;
    return node;
  });
  return { id, title, group, nodes, choices };
}

export function visibleMessages(chat: ChatConversation): ChatNode[] {
  const result: ChatNode[] = [], visited = new Set<string>();
  let next = chat.choices[ROOT];
  while (next && !visited.has(next)) {
    visited.add(next);
    const node = chat.nodes.find(item => item.id === next);
    if (!node) break;
    result.push(node);
    next = chat.choices[node.id];
  }
  return result;
}

export function appendNode(chat: ChatConversation, node: ChatNode): ChatConversation {
  return { ...chat, nodes: [...chat.nodes, node], choices: { ...chat.choices, [node.parent]: node.id } };
}
export function updateNode(chat: ChatConversation, id: string, patch: Partial<AiChatMessage>): ChatConversation {
  return { ...chat, nodes: chat.nodes.map(node => node.id === id ? { ...node, ...patch } : node) };
}
export function applyEvent(message: AiChatMessage, event: ChatStreamEvent): Partial<AiChatMessage> {
  switch (event.type) {
    case 'reasoning': return { reasoning: (message.reasoning ?? '') + event.delta };
    case 'reasoning-end': return { thoughtFor: event.seconds ?? 2 };
    case 'text': return { content: message.content + event.delta, status: 'streaming' };
    case 'sources': return { sources: event.sources };
    case 'tool': return { tools: [...(message.tools ?? []).filter(tool => tool.id !== event.tool.id), event.tool] };
    case 'error': return { status: 'error', error: event.message };
  }
}

export function safeLink(url: string) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}
