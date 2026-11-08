const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), result, result.exports);
  return result.exports;
}

const variables = load('apps/admin/src/features/settings/governance/notificationTemplateForm.ts');

test('template variable editing preserves names, required flags and existing definition metadata', () => {
  const original = JSON.parse('{"orderNo":{"label":"订单号","required":true},"optional_note":{"label":"","required":false,"source":"legacy","name":"original metadata"},"__proto__":{"label":"原变量","required":false}}');
  const rows = variables.notificationVariableRows(original);
  rows[0].definition.label = '订单编号';
  rows[1].definition.required = true;
  const result = variables.notificationVariableSchema(rows);
  assert.deepEqual(Object.keys(result), Object.keys(original));
  assert.deepEqual(result.orderNo, { label: '订单编号', required: true });
  assert.deepEqual(result.optional_note, { label: '', required: true, source: 'legacy', name: 'original metadata' });
  assert.deepEqual(result.__proto__, { label: '原变量', required: false });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(original.orderNo.label, '订单号', 'Editing a form row must not mutate the query snapshot.');
  assert.equal(original.optional_note.required, false);
});

test('blank or duplicate names cannot silently discard a template variable', () => {
  const row = { name: 'customerName', definition: { label: '客户名称', required: true } };
  assert.throws(() => variables.notificationVariableSchema([row, { ...row, definition: { ...row.definition, required: false } }]), /变量名不能重复/);
  assert.throws(() => variables.notificationVariableSchema([{ ...row, name: '  ' }]), /请填写变量名/);
  assert.deepEqual(variables.notificationVariableSchema([]), {}, 'Templates without placeholders remain valid.');
});

test('manual notification management is independent of rule editing, publishing and pricing', () => {
  let granted = [];
  const governance = load('apps/admin/src/features/settings/governance/shared.ts', {
    react: { useMemo: compute => compute() },
    '@/features/auth/authStore': { useAuthStore: select => select({ hasPermission: code => granted.includes(code) }) },
  });
  for (const permission of ['rental-os:rules:manage', 'rental-os:rules:publish', 'rental-os:price:manage', 'system:params:manage']) {
    granted = [permission];
    assert.equal(governance.useGovernancePermissions().canManageNotifications, false, permission);
  }
  granted = ['system:integration:manage'];
  const integration = governance.useGovernancePermissions();
  assert.equal(integration.canManageNotifications, true);
  assert.equal(integration.canEditRules, false);
  assert.equal(integration.canPublishRules, false);
  assert.equal(integration.canManagePrice, false);
});
