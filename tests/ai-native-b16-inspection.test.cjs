'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'apps/admin/src/features/ai-native/inspection-draft-display.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = {};
vm.runInNewContext(output, { exports: mod, require, console });
test('inspection draft preserves candidate, human correction, source and missing states', () => {
  const rows = mod.toInspectionDraftRows([{ key: 'vin', label: 'VIN', candidate: 'CANDIDATE', sourceLabel: '照片 1' }, { key: 'mileage', label: '里程', humanValue: '100', sourceLabel: '人工输入' }, { key: 'hours', label: '工时' }]);
  assert.deepEqual(rows.map(row => row.state), ['candidate_only', 'human_value', 'empty']);
  assert.equal(rows[0].candidate, 'CANDIDATE');
  assert.equal(rows[1].humanValue, '100');
  assert.equal(rows[2].sourceLabel, null);
});
test('inspection draft rejects unsafe/unbounded rows instead of treating them as facts', () => {
  assert.equal(JSON.stringify(mod.toInspectionDraftRows([{ key: '__proto__', label: 'x' }, { key: 'ok', label: 'x', candidate: 'x'.repeat(5000) }, null])), JSON.stringify([{ key: 'ok', label: 'x', candidate: 'x'.repeat(4000), humanValue: null, sourceLabel: null, state: 'candidate_only' }]));
});
