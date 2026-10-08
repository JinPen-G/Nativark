'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const scenarios = require('./fixtures/ai-native/b16-scenarios.cjs');
const root = path.resolve(__dirname, '..');
function load(relative) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = {};
  vm.runInNewContext(output, { exports: mod, require, console });
  return mod;
}
const facts = load('apps/admin/src/features/ai-native/order-facts-display.ts');
const proposal = load('apps/admin/src/features/ai-native/proposal-preview-state.ts');
const inspection = load('apps/admin/src/features/ai-native/inspection-draft-display.ts');

test('cross-context same task id remains scoped by host projection', () => {
  assert.notEqual(scenarios.contexts[0].tenantId, scenarios.contexts[1].tenantId);
  assert.notEqual(scenarios.contexts[0].workspaceId, scenarios.contexts[1].workspaceId);
  assert.equal(facts.toDisplayOrderFacts(scenarios.orderFacts).sourceScope, 'space-a');
});
test('unknown or expired inputs remain unavailable and do not become success', () => {
  assert.equal(facts.toDisplayOrderFacts({ ...scenarios.orderFacts, paymentEvidence: 'loaded' }), null);
  assert.equal(proposal.proposalDisplayState(scenarios.proposal), 'expired');
  assert.equal(inspection.toInspectionDraftRows([{ key: 'status', label: '状态', candidate: '' }])[0].state, 'empty');
});
test('shared scenario fixture uses only synthetic identifiers and bounded fields', () => {
  assert.match(scenarios.contexts[0].tenantId, /^tenant-/);
  assert.ok(scenarios.inspection.length <= 50);
  assert.ok(scenarios.inspection.every(row => row.label.length <= 200));
});
