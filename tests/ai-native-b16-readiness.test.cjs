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
const { toReadinessDiagnostics } = load('apps/admin/src/features/ai-native/readiness-diagnostics.ts');
const base = {
  tenantId: 'tenant-synthetic', workspaceId: 'workspace-synthetic', status: 'configuring', ready: false, quoteBlockers: ['营业日历'],
  items: [
    { key: 'space', title: '经营空间', done: true, missing: '', nextHref: '/space', summary: '当前空间已读取' },
    { key: 'calendar', title: '营业日历', done: false, missing: '缺少已发布年度日历', nextHref: '/calendar' },
    { key: 'member', title: '会员方案', done: false, optional: true, missing: '暂无会员方案', nextHref: '/members' },
    { key: 'external', title: '外部服务', done: false, unavailable: true, missing: '连接结果不可用', nextHref: '/external' }
  ]
};

test('readiness preserves required, optional, unavailable and completed distinctions', () => {
  const display = toReadinessDiagnostics(base);
  assert.equal(display.rows.map((row) => row.state).join(','), 'completed,required,optional,unavailable');
  assert.equal(display.ready, false);
  assert.deepEqual(display.quoteBlockers, ['营业日历']);
  assert.equal(display.unavailable, true);
});

test('malformed or missing server projection is unavailable, not success', () => {
  assert.equal(toReadinessDiagnostics(undefined), null);
  assert.equal(toReadinessDiagnostics({ ...base, ready: 'yes' }), null);
  assert.equal(toReadinessDiagnostics({ ...base, items: [{ ...base.items[0], done: 'yes' }] }), null);
});
