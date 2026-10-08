'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'apps/admin/src/features/ai-native/proposal-preview-state.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const modExports = {};
vm.runInNewContext(output, { exports: modExports, require, console });
test('proposal display refuses missing time evidence and marks expired/stale without recalculation', () => {
  assert.equal(modExports.proposalDisplayState({ expiresAt: '2026-10-04T10:00:00Z', nowIso: '2026-10-04T09:59:00Z' }), 'available');
  assert.equal(modExports.proposalDisplayState({ expiresAt: '2026-10-04T10:00:00Z', nowIso: '2026-10-04T10:00:00Z' }), 'expired');
  assert.equal(modExports.proposalDisplayState({ expiresAt: '2026-10-04T10:00:00Z', nowIso: '2026-10-04T09:59:00Z', stale: true }), 'stale');
  assert.equal(modExports.proposalDisplayState({ expiresAt: '2026-10-04T10:00:00Z' }), 'unavailable');
});
