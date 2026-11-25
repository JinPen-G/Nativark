import { fromMessages, type AiChatHistoryItem, type ChatModel, type ChatRespond, type ChatSource } from './chat-state';

export const demoModels: ChatModel[] = [
  { id: 'balanced', name: 'Everyday', note: 'Balanced for everyday work', color: '#bd7758' },
  { id: 'reasoning', name: 'Reasoning', note: 'More time for complex questions', color: '#527c67' },
  { id: 'fast', name: 'Quick', note: 'Short answers, less waiting', color: '#587baf' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Anthropic', brand: 'anthropic' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Anthropic', brand: 'anthropic' },
  { id: 'gpt-6-1-sol', name: 'GPT-6.1 Sol', note: 'OpenAI', brand: 'openai' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', note: 'Google', brand: 'google' },
  { id: 'mistral-large-4', name: 'Mistral Large 4', note: 'Mistral AI', brand: 'mistral' },
];
export const demoSources: ChatSource[] = [
  { id: 'pg-alter', title: 'PostgreSQL 17: ALTER TABLE', url: 'https://www.postgresql.org/docs/17/sql-altertable.html', description: 'Changing table definitions, constraints and NOT NULL validation.', brand: 'postgresql' },
  { id: 'pg-lock', title: 'PostgreSQL 17: Explicit locking', url: 'https://www.postgresql.org/docs/17/explicit-locking.html', description: 'Table-level lock modes and their conflicts.', brand: 'postgresql' },
  { id: 'strong-migrations', title: 'strong_migrations: Setting NOT NULL on an existing column', url: 'https://github.com/ankane/strong_migrations', description: 'Safe migration patterns for existing columns.', brand: 'github' },
  { id: 'pg-client', title: 'PostgreSQL 17: Client connection defaults', url: 'https://www.postgresql.org/docs/17/runtime-config-client.html', description: 'Client settings including statement and lock timeouts.', brand: 'postgresql' },
];
export const demoQueries = ['postgres 17 set not null without table scan', 'validate constraint lock level'];
export const demoSearchTool = { id: 'web-search', name: 'Searched the web', kind: 'search' as const, status: 'done' as const, summary: '4 sources', queries: demoQueries, sources: demoSources };
export const demoQueryTool = { id: 'orders-query', name: 'Queried orders', kind: 'query' as const, brand: 'postgresql', status: 'done' as const, summary: '40,213,880 rows', input: 'SELECT count(*) FROM orders;', output: '40,213,880' };
export const demoQuestion = 'We need a non-null region column on our 40M row orders table in Postgres 17. How do we add it without blocking writes?';
export const demoAnswer = `Split it into four short steps, so no single statement holds a heavy lock for long.

1. **Add the column as nullable.** With no default, this only touches the catalog and returns at once.
2. **Backfill in batches** of about 5,000 rows, committing each batch so transactions stay short and autovacuum keeps up.
3. **Add a NOT VALID check, then validate it.** Validation scans the table under a SHARE UPDATE EXCLUSIVE lock, so reads and writes keep flowing. [1] [2]
4. **Set NOT NULL.** Postgres sees the validated check and skips the full scan, so this lock lasts milliseconds. [1] [3]

\`\`\`sql
ALTER TABLE orders ADD COLUMN region text;

ALTER TABLE orders ADD CONSTRAINT orders_region_not_null
  CHECK (region IS NOT NULL) NOT VALID;

ALTER TABLE orders VALIDATE CONSTRAINT orders_region_not_null;
ALTER TABLE orders ALTER COLUMN region SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_region_not_null;
\`\`\`

Run each ALTER with a short \`lock_timeout\`, such as \`2s\`, so a statement stuck behind a long query gives up instead of queueing every write behind it. [4]`;
export const demoFollowUp = 'How long will the backfill take at 5,000 rows per batch?';
export const demoFollowUpAnswer = `About **23 minutes**. The table has 40,213,880 rows, so 5,000 rows per batch makes 8,043 batches.

- **Per batch:** about 120 ms for the update and a 50 ms pause so replicas keep up
- **Total:** 8,043 × 170 ms ≈ 1,367 s, or just under 23 minutes
- **Lag:** if replication lag passes 5 s, double the pause instead of shrinking the batch

Walk the primary key in ranges, so every batch uses the index and never rescans finished rows:

\`\`\`sql
UPDATE orders o
SET region = c.region
FROM customers c
WHERE c.id = o.customer_id
  AND o.id >= $1 AND o.id < $1 + 5000
  AND o.region IS NULL;
\`\`\``;

export const demoHistory: AiChatHistoryItem[] = [
  { id: 'schema', title: 'Add region to orders', group: 'Today', messages: [
    { id: 'schema-user', role: 'user', content: demoQuestion },
    { id: 'schema-answer', role: 'assistant', content: demoAnswer, model: demoModels[0], status: 'done', reasoning: 'The table is large, so separate the metadata change from the backfill. Check PostgreSQL 17 constraint validation and lock levels before choosing the final NOT NULL step.', thoughtFor: 4, tools: [demoSearchTool], sources: demoSources },
    { id: 'backfill-user', role: 'user', content: demoFollowUp },
    { id: 'backfill-answer', role: 'assistant', content: demoFollowUpAnswer, model: demoModels[0], status: 'done', reasoning: 'Count the rows, calculate the number of batches, then include a short pause per batch to account for replication lag.', thoughtFor: 2, tools: [demoQueryTool] },
  ] },
  { id: 'partition', title: 'Partition the events table', group: 'Today', messages: [
    { id: 'partition-user', role: 'user', content: 'Should we partition events by month or by week? It grows by about 90M rows a month.' },
    { id: 'partition-answer', role: 'assistant', model: demoModels[3], status: 'done', thoughtFor: 3, reasoning: 'Compare partition size, maintenance time, retention and query pruning before choosing the interval.', content: '**By month.** At about 90M rows a month, each partition stays small enough for quick vacuums and index builds, and the partition count stays low.\n\n- **Retention:** dropping a month is one `DETACH PARTITION` and a `DROP TABLE`, with no bulk delete\n- **Queries:** filters on `created_at` prune to one or two partitions\n- Weekly partitions only pay off once a single month gets slow to vacuum' },
  ] },
  { id: 'incident', title: 'Status page incident draft', group: 'Previous 7 days', messages: [
    { id: 'incident-user', role: 'user', content: 'Draft a status page update for the checkout slowdown on October 14. It was resolved at 15:40 UTC.' },
    { id: 'incident-answer', role: 'assistant', model: demoModels[3], status: 'done', thoughtFor: 2, reasoning: 'State the impact, time window, recovery and prevention step in plain language.', content: '### Resolved: slower checkout\n\nBetween 14:55 and 15:40 UTC on October 14, some customers saw checkout take longer than usual. No payment was lost or charged twice. A database migration held a lock for longer than expected; we stopped it, and checkout recovered at 15:40 UTC.\n\nWe are adding lock timeouts to every migration, so a schema change cannot hold up checkout again.' },
  ] },
  { id: 'churn', title: 'Churn interview themes', group: 'Previous 7 days', messages: [
    { id: 'churn-user', role: 'user', content: 'Summarize the themes from the 12 churn interviews in three bullets.' },
    { id: 'churn-answer', role: 'assistant', model: demoModels[3], status: 'done', thoughtFor: 5, reasoning: 'Group the interview findings into recurring themes and preserve the reported counts.', content: '- **Setup took too long:** 7 of 12 never finished connecting their data in the first week\n- **Pricing jumped at 10 seats:** 4 left at renewal when the team plan started\n- **Exports were missing:** 3 needed CSV exports for finance and moved to a tool that had them' },
  ] },
];
export const makeDemoChats = () => demoHistory.map(chat => fromMessages(chat.id, chat.title, chat.messages, chat.group));

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export const sampleResponder: ChatRespond = async function* (messages, { signal, model }) {
  const prompt = messages.at(-1)?.content ?? '';
  const chinese = /[\u3400-\u9fff]/.test(prompt);
  const database = /schema|orders|postgres|database|region|数据库|字段/i.test(prompt);
  const backfill = /backfill.*take|5,?000 rows per batch|回填.*多久/i.test(prompt);
  yield { type: 'reasoning', delta: backfill ? demoHistory[0].messages[3].reasoning! : database ? demoHistory[0].messages[1].reasoning! : chinese ? '先整理你的目标，再把任务拆成可执行、可验证的步骤。这里演示的是本地生成流程。' : 'I will identify the goal, break it into practical steps, and call out what to verify. This reasoning is part of the local demonstration.' };
  await pause(900, signal);
  yield { type: 'reasoning-end', seconds: backfill ? 2 : database ? 4 : 1 };
  if (/\[error\]/i.test(prompt)) { yield { type: 'error', message: 'Simulated connection failure. Retry to run the local reply again.' }; return; }
  if (backfill) {
    yield { type: 'tool', tool: { ...demoQueryTool, name: 'Querying orders', status: 'running', output: undefined, summary: undefined } };
    await pause(700, signal);
    yield { type: 'tool', tool: demoQueryTool };
  } else if (database) {
    yield { type: 'tool', tool: { ...demoSearchTool, name: 'Searching the web', status: 'running', sources: [], summary: undefined } };
    await pause(700, signal);
    yield { type: 'tool', tool: demoSearchTool };
    yield { type: 'sources', sources: demoSources };
  }
  const answer = backfill ? demoFollowUpAnswer : database ? demoAnswer : chinese
    ? `可以，我们先把这件事拆成几个步骤。\n\n### 建议的推进方式\n\n1. **明确目标**：记录预期结果、使用场景和限制条件。\n2. **先做一个小版本**：把核心流程跑通，再逐步补全细节。\n3. **逐项验证**：检查正常状态、异常状态和手机上的展示。\n\n你刚才的输入是：\n\n${prompt.slice(0, 600)}\n\n这是一条本地模拟回复；接入业务项目后，可通过 \`respond\` 替换为真实的流式接口。`
    : `Let's turn that into a practical next step.\n\n### A useful starting point\n\n1. **Define the outcome.** Write down the result you need and the constraints.\n2. **Build a small version.** Complete the main flow before adding details.\n3. **Verify the result.** Check the happy path, failures, and a narrow screen.\n\nYour message: ${prompt.slice(0, 600)}\n\nThis is a scripted local reply. You can replace \`respond\` with your own streaming service when integrating the component.`;
  const chunks = answer.match(chinese ? /[\s\S]{1,6}/gu : /(?:\S+\s*){1,3}|\s+/g) ?? [answer];
  for (const delta of chunks) {
    await pause(model.id === 'fast' ? 20 : 42, signal);
    yield { type: 'text', delta };
  }
};
