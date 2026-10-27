import type { ChatModel, ChatSource, ChatTool } from './archive/ai-chat/chat-state';
import type { RunStep } from './archive/agent-run/agent-run-state';
import { exampleArtifact, type OperatorCapability } from './capabilities';

/** Local presentation fixtures. These labels never invoke HTTP, SQL, a model or a scheduler. */
export const OPERATOR_MODELS: ChatModel[] = [
  { id: 'everyday', name: '日常助手', note: '快速整理经营事项 · 演示', brand: 'openai' },
  { id: 'reasoning', name: '深度分析', note: '比较方案与梳理复杂问题 · 演示', brand: 'anthropic' },
  { id: 'quick', name: '快速回复', note: '查询摘要与简短回复 · 演示', brand: 'google' },
];
export function demoResources(capability: OperatorCapability): ChatSource[] {
  return [
    { id: `${capability.id}-list`, title: `${capability.name} · 示例资料`, url: `${location.origin}${capability.route}`, description: '本地演示来源，不代表读取了当前业务数据。', brand: 'web' },
    { id: `${capability.id}-rules`, title: '业务规则与操作指引', url: `${location.origin}/rental/settings`, description: '演示中的规则参考入口，未调用业务接口。', brand: 'web' },
  ];
}
export function demoSteps(capability: OperatorCapability): RunStep[] {
  const artifact = exampleArtifact(capability);
  return [
    { id: 'scope', mark: 'think', verb: '确定', doneVerb: '已确定', target: '任务范围', status: 'running', text: `整理「${capability.name}」的示例资料，重点是${capability.description}。这里只展示执行摘要，不是模型内部思考。` },
    { id: 'read', mark: 'read', verb: '读取', doneVerb: '已读取', target: `${capability.name}示例资料`, status: 'running', io: { input: `本地数据集：${capability.id}`, output: artifact.rows.map(row => row.join(' · ')) } },
    { id: 'lookup', mark: 'search', verb: '核对', doneVerb: '已核对', target: '业务规则与关联资料', status: 'running', progress: { value: 0, total: 2 }, text: '演示资源检索、关联资料和返回结果的展开效果。没有发出 API 请求。' },
    { id: 'compose', mark: 'review', verb: '整理', doneVerb: '已整理', target: artifact.title, status: 'running', io: { input: '生成可核对的结果草稿', output: [artifact.summary, `呈现形式：${artifact.columns.join(' / ')}`, '保留原有结果页，确认仅生成本地演示回执。'] } },
  ];
}
export function demoTool(capability: OperatorCapability, index: number, status: ChatTool['status']): ChatTool {
  const steps = demoSteps(capability), step = steps[index];
  return { id: `${capability.id}-${index}`, name: index === 2 ? '检索关联资料' : '读取业务示例', kind: index === 2 ? 'search' : 'query', brand: 'web', status,
    summary: status === 'running' ? '本地演示中' : `${exampleArtifact(capability).rows.length} 条示例`,
    input: index === 2 ? undefined : step.io?.input,
    output: status === 'done' ? (step.io?.output.join('\n') ?? '已找到两份示例资料，未访问真实服务。') : undefined,
    queries: index === 2 ? [`${capability.name}相关业务规则`, '可核对的记录与处理建议'] : undefined,
    sources: index === 2 && status === 'done' ? demoResources(capability) : undefined };
}
export function demoAnswer(capability: OperatorCapability) {
  const artifact = exampleArtifact(capability);
  return `## ${artifact.title}\n\n${artifact.summary}\n\n${artifact.rows.map(row => `- **${row[0]}**：${row.slice(1).join(' · ')}`).join('\n')}\n\n资料入口见 [1]、[2]。右侧工作区保留完整结果。\n\n\`\`\`text\n${artifact.columns.join(' / ')}\n${artifact.rows[0].join(' / ')}\n\`\`\`\n\n${artifact.note}`;
}

/** Abortable local delay: stopping or switching conversations cannot publish a stale result. */
export function demoPause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已停止', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('已停止', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
