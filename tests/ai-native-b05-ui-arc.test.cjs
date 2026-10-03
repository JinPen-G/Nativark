'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('./fixtures/ai-native/b04-render.cjs').loadFeature;
const components = ['HumanConfirmShell', 'TaskList', 'MissingFieldsPanel', 'KnowledgeSources', 'MemoryPreferences', 'CancelRecoveryStatus'];
test('AI feature controls render through the UI adapter boundary in offline host mode', () => {
  for (const name of components) assert.equal(typeof load(`${name}.tsx`), 'object');
  const { HumanConfirmShell } = load('HumanConfirmShell.tsx');
  const { MissingFieldsPanel } = load('MissingFieldsPanel.tsx');
  const confirm = renderToStaticMarkup(React.createElement(HumanConfirmShell, { proposalId: 'p', revision: '1' }));
  const fields = renderToStaticMarkup(React.createElement(MissingFieldsPanel, { fields: [{ name: 'x', label: '字段', type: 'text', required: true }], draft: {} }));
  assert.ok(confirm.includes('disabled=""')); assert.ok(fields.includes('input')); assert.ok(fields.includes('disabled=""'));
});

test('supplement input keeps host draft controlled and exposes disabled/error states', () => {
  const { MissingFieldsPanel } = load('MissingFieldsPanel.tsx');
  const markup = renderToStaticMarkup(React.createElement(MissingFieldsPanel, {
    taskId: 'task-1', inputRevision: 3,
    fields: [
      { name: 'kind', label: '类型', type: 'select', required: true, options: ['A', 'B'], error: '请选择类型' },
      { name: 'count', label: '数量', type: 'number', required: true },
    ],
    draft: { kind: 'A', count: '2' }, readOnly: true, error: '暂不可提交',
  }));
  assert.ok(markup.includes('暂不可提交'));
  assert.ok(markup.includes('disabled=""'));
  assert.ok(markup.includes('请选择类型'));
  assert.ok(markup.includes('value="A"'));
});

test('task list disables navigation without a callback and retains rows during refresh errors', () => {
  const { TaskList } = load('TaskList.tsx');
  const markup = renderToStaticMarkup(React.createElement(TaskList, {
    tasks: [{ id: 't1', scene: 'chat', status: 'running', updatedAt: 'now' }],
    page: 0, hasNext: true, loading: true, error: '连接中断', paging: false,
  }));
  assert.ok(markup.includes('正在刷新任务'));
  assert.ok(markup.includes('连接中断'));
  assert.ok(markup.includes('t1'));
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
});

test('source and memory views redact content after withdrawal or expiry', () => {
  const { KnowledgeSources } = load('KnowledgeSources.tsx');
  const { MemoryPreferences } = load('MemoryPreferences.tsx');
  const source = renderToStaticMarkup(React.createElement(KnowledgeSources, {
    sources: [{ id: 's1', title: 'secret title', version: '2', status: 'withdrawn' }],
  }));
  const memory = renderToStaticMarkup(React.createElement(MemoryPreferences, {
    items: [{ id: 'm1', label: '偏好', value: 'secret value', status: 'revoked', actorKind: 'human', revision: '2' }],
  }));
  assert.ok(source.includes('来源内容不可用'));
  assert.ok(!source.includes('secret title'));
  assert.ok(memory.includes('内容不可用'));
  assert.ok(!memory.includes('secret value'));
});

test('AI service summary projects a whitelist and hides provider secrets/details', () => {
  const { AiServiceSummary, toSafeAiServiceSummary } = load('AiServiceSummary.tsx');
  const hostile = { draftVersion: 'ain-c07-draft-2', mode: 'platform_managed', enabled: true, availability: 'ready', connectionState: 'verified_live', baseUrl: 'https://secret.invalid', apiKey: 'secret-key', provider: 'private-provider' };
  const safe = toSafeAiServiceSummary(hostile);
  assert.deepEqual(safe, { mode: 'platform_managed', enabled: true, availability: 'ready', connectionState: 'verified_live' });
  const markup = renderToStaticMarkup(React.createElement(AiServiceSummary, { summary: hostile }));
  assert.ok(markup.includes('Rental OS AI'));
  assert.ok(!markup.includes('secret-key'));
  assert.ok(!markup.includes('secret.invalid'));
});

test('formatters preserve units and reject invalid numeric/time input', () => {
  const formatters = load('formatters.ts');
  assert.deepEqual(formatters.formatAmount(0, 'tokens'), { value: '0', source: 'host', unit: 'tokens', available: true });
  assert.equal(formatters.formatAmount(NaN, 'USD').available, false);
  assert.equal(formatters.formatAmount(-1, 'USD').value, '未知');
  assert.equal(formatters.formatAmount(9007199254740993n, 'calls').value, '9007199254740993');
  assert.equal(formatters.formatTimestamp('not-a-date').value, '时间不可用');
  assert.equal(formatters.formatUsage({ status: 'pending_reconciliation', amount: '0', unit: 'tokens' }).value, '未知用量');
});

test('model text and proposals remain bounded and mark candidates as unexecuted', () => {
  const { ModelText } = load('ModelText.tsx');
  const { ProposalPreview } = load('ProposalPreview.tsx');
  const text = renderToStaticMarkup(React.createElement(ModelText, { kind: 'tool_candidate', text: 'x'.repeat(30000) }));
  const changes = Array.from({ length: 201 }, (_, index) => ({ label: `f${index}`, before: 'a', after: 'b' }));
  const proposal = renderToStaticMarkup(React.createElement(ProposalPreview, { proposal: { title: '候选', risk: '中', changes } }));
  assert.ok(text.includes('工具动作候选（未执行）'));
  assert.ok(text.includes('内容超过展示上限'));
  assert.ok(proposal.includes('变更列表超过展示上限'));
});

test('interactive shells expose labelled controls and live status relationships', () => {
  const { HumanConfirmShell } = load('HumanConfirmShell.tsx');
  const { CancelRecoveryStatus } = load('CancelRecoveryStatus.tsx');
  const confirm = renderToStaticMarkup(React.createElement(HumanConfirmShell, { proposalId: 'p', revision: '1', available: true }));
  const action = renderToStaticMarkup(React.createElement(CancelRecoveryStatus, { status: 'unknown' }));
  assert.match(confirm, /for="proposal-confirm-/);
  assert.match(confirm, /aria-live="polite"/);
  assert.match(action, /aria-live="polite"/);
  assert.match(action, /aria-describedby="action-status-/);
});

test('timeline distinguishes an unknown enum from an unavailable step payload', () => {
  const { TaskTimeline } = load('TaskTimeline.tsx');
  const markup = renderToStaticMarkup(React.createElement(TaskTimeline, {
    taskId: 't1', steps: [
      { id: 's1', taskId: 't1', action: '未知动作', status: 'future_status' },
      { id: 's2', taskId: 't1', action: '等待核对', status: 'unknown' },
    ],
  }));
  assert.ok(markup.includes('无法识别／待刷新'));
  assert.ok(markup.includes('待核对'));
});
