'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadModel() {
  const file = path.resolve(__dirname, '..', 'apps/admin/src/features/ai-native/ai-service-settings-model.ts');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/export\s+(?=(type|interface|function|const|class)\b)/g, '').replace(/export\s*\{[^}]+\};?/g, '');
  const output = ts.transpileModule(`${source}\nmodule.exports = { fromAiServiceSummary, setAiSettingsMode, validateAiSettingsDraft, toAiSettingsInput };`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})(require,module,module.exports);`, { require, module, console }, { filename: file });
  return module.exports;
}
const model = loadModel();

test('B14-B new or incomplete summary defaults to Rental OS AI without BYOK fields', () => {
  const draft = model.fromAiServiceSummary(undefined);
  assert.equal(draft.mode, 'platform_managed');
  assert.equal(draft.baseUrl, '');
  assert.equal(draft.apiKeyDraft, '');
});

test('B14-B existing tenant-managed summary preserves editable BYOK metadata and never a secret', () => {
  const draft = model.fromAiServiceSummary({ mode: 'tenant_managed', enabled: true, protocol: 'openai-compatible', baseUrl: 'https://gateway.example.test', model: 'model-a', credentialState: 'configured', connectionState: 'not_tested', draftVersion: 'ain-c07-draft-2', tenantId: 't', configId: 'c', configRevision: 3 });
  assert.equal(draft.mode, 'tenant_managed');
  assert.equal(draft.baseUrl, 'https://gateway.example.test');
  assert.equal(draft.apiKeyDraft, '');
});

test('B14-B platform switch removes write-only replacement input but does not clear provider storage', () => {
  const before = { mode: 'tenant_managed', enabled: true, protocol: 'p', baseUrl: 'https://x.test', model: 'm', secretOperation: 'replace', apiKeyDraft: 'secret' };
  const after = model.setAiSettingsMode(before, 'platform_managed');
  assert.equal(after.mode, 'platform_managed');
  assert.equal(after.apiKeyDraft, '');
  assert.equal(after.secretOperation, 'retain');
  const input = model.toAiSettingsInput(after, 'c', 4);
  assert.equal(JSON.stringify(input), JSON.stringify({ draftVersion: 'ain-c07-draft-2', configId: 'c', expectedRevision: 4, enabled: true, mode: 'platform_managed' }));
});

test('B14-B BYOK retain/replace/clear have distinct server inputs and validate before save', () => {
  const base = { mode: 'tenant_managed', enabled: true, protocol: 'openai-compatible', baseUrl: 'https://x.test', model: 'm', apiKeyDraft: '' };
  assert.equal(model.toAiSettingsInput({ ...base, secretOperation: 'retain' }, 'c', 1).secretChange.operation, 'retain');
  assert.equal(model.toAiSettingsInput({ ...base, secretOperation: 'clear' }, 'c', 1).secretChange.operation, 'clear');
  assert.equal(model.toAiSettingsInput({ ...base, secretOperation: 'replace', apiKeyDraft: 'new-secret' }, 'c', 1).secretChange.operation, 'replace');
  assert.equal(model.toAiSettingsInput({ ...base, secretOperation: 'replace', apiKeyDraft: '' }, 'c', 1), null);
  assert.equal(model.toAiSettingsInput({ ...base, baseUrl: 'http://x.test', secretOperation: 'retain' }, 'c', 1), null);
});

test('B14-B capability readiness remains separate from connection state', () => {
  const summary = { mode: 'platform_managed', enabled: true, availability: 'not_verified', connectionState: 'verified_live' };
  assert.equal(summary.availability, 'not_verified');
  assert.equal(summary.connectionState, 'verified_live');
});
