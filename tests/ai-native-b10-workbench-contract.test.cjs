'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('workbench imports the existing feature components and exposes host-only boundaries', () => {
  const source = read('apps/admin/src/features/ai-native/AiTaskWorkbench.tsx');
  for (const name of ['TaskList', 'TaskTimeline', 'MissingFieldsPanel', 'ProposalPreview', 'HumanConfirmShell', 'CancelRecoveryStatus', 'KnowledgeSources', 'MemoryPreferences', 'AiServiceSummary', 'CapabilityStatus']) {
    assert.match(source, new RegExp(`import \\{[^}]*${name}`));
    assert.match(source, new RegExp(`<${name}\\b`));
  }
  for (const boundary of ['readTask?', 'onResync?', 'onConfirm?', 'onCancel?', 'onRecover?']) assert.match(source, new RegExp(boundary));
  assert.doesNotMatch(source, /fetch\s*\(|axios\.|localStorage|sessionStorage|setInterval|setTimeout|window\./);
});

test('detail reads are epoch-gated and visibility-gated', () => {
  const source = read('apps/admin/src/features/ai-native/AiTaskWorkbench.tsx');
  assert.match(source, /setDetail\(null\)/);
  assert.match(source, /setDetailError\(null\)/);
  assert.match(source, /const currentEpoch = epoch\.current/);
  assert.match(source, /currentEpoch !== epoch\.current \|\| abort\.signal\.aborted/);
  assert.match(source, /if \(!visible\)/);
  assert.match(source, /return \(\) => \{\s*abort\.abort\(\);/s);
});

test('status and confirmation output stays host-gated', () => {
  const source = read('apps/admin/src/features/ai-native/AiTaskWorkbench.tsx');
  assert.match(source, /available=\{Boolean\(onConfirm\)\}/);
  assert.match(source, /canCancel=\{Boolean\(onCancel\)\}/);
  assert.match(source, /canRecover=\{Boolean\(onRecover\)\}/);
  assert.match(source, /宿主未提供任务详情读取能力/);
});

test('workbench uses the existing event consumer and exposes resync instead of inventing cursor fallback', () => {
  const source = read('apps/admin/src/features/ai-native/AiTaskWorkbench.tsx');
  assert.match(source, /consumePolledEvents/);
  assert.match(source, /resyncRequired/);
  assert.match(source, /重新读取快照/);
  assert.doesNotMatch(source, /cursor\s*\+\+|Number\([^)]*cursor|parseInt\([^)]*cursor/);
});
