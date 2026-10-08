'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(file) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = {};
  vm.runInNewContext(output, { exports: mod, require, console });
  return mod;
}
const { toCategoryDifferenceRows, toCategoryGovernanceDisplay } = load('apps/admin/src/features/ai-native/category-governance-display.ts');
const summary = { code: 'photo', name: '摄影设备', openingScope: 'pilot', openingRevision: 2, recommendedVersionId: 'v2', recommendedVersionLabel: '2.0', latestPublished: { id: 'v1', versionLabel: '1.0' }, drafts: [{ id: 'd1', versionLabel: '2.1' }], adoptedSpaces: 3, adoptedTenants: 2 };

test('governance summary preserves published, draft and adoption facts', () => {
  const display = toCategoryGovernanceDisplay(summary);
  assert.equal(display.recommendedVersion, '2.0');
  assert.equal(display.latestPublished, '1.0');
  assert.equal(display.draftCount, 1);
  assert.equal(display.adoptedSpaces, 3);
});

test('category differences preserve before/after and missing values without action semantics', () => {
  const rows = toCategoryDifferenceRows([{ section: 'pricing', path: 'deposit', label: '押金', kind: 'scope_narrowed', before: 0, after: null }, { section: 'basic', path: 'name', label: '名称', kind: 'changed', before: undefined, after: '新名称' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].before, '0');
  assert.equal(rows[0].after, '未提供');
  assert.equal(rows[1].after, '新名称');
});

test('malformed governance projections remain unavailable', () => {
  assert.equal(toCategoryGovernanceDisplay({ ...summary, openingRevision: 2.5 }), null);
  assert.equal(toCategoryDifferenceRows([{ section: 'pricing', kind: 'unknown' }]), null);
});
