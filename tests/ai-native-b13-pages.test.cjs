'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mountWorkbench } = require('./fixtures/ai-native/b12-native-host.cjs');
const { loadPage, lifecycleProbe } = require('./fixtures/ai-native/b13-page-entry.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = file => JSON.parse(read(file));

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`${app} real order page registers the native workbench and all required read-only slots`, () => {
    const json = parse(`apps/${app}/src/pages/order/index.json`);
    const wxml = read(`apps/${app}/src/pages/order/index.wxml`);
    for (const name of ['ai-task-workbench']) {
      assert.equal(typeof json.usingComponents[name], 'string', `${name} must be declared by the real page`);
      assert.match(wxml, new RegExp(`<${name}\\b`));
    }
    for (const slot of ['task-card', 'step-timeline', 'clarification', 'proposal-confirm', 'knowledge-sources', 'memory-preferences', 'status-panel', 'order-explanation']) assert.match(wxml, new RegExp(`slot="${slot}"`));
    if (app === 'staff-miniprogram') assert.match(wxml, /slot="inspection-draft"/);
    assert.match(wxml, /wx:if="\{\{aiNativeEntryVisible\}\}"/);
  });

  test(`${app} actual Page definition stays default-off and lifecycle cleanup is local`, () => {
    const page = loadPage(app);
    assert.equal(page.data.aiNativeEntryVisible, false);
    assert.deepEqual(Array.from(page.data.aiNativeTasks), []);
    const probe = lifecycleProbe(page);
    assert.deepEqual(probe.calls, ['hide', 'logout']);
  });

  test(`${app} actual workbench remains inert without explicit host enablement`, async () => {
    const { instance } = mountWorkbench(app);
    let reads = 0;
    instance.attachHost({ context: { audience: 'client', tenantId: 'tenant-synthetic', workspaceId: 'space-synthetic' }, readDetail: async () => { reads++; return {}; } });
    instance.hostShow(false);
    await instance.readSnapshot();
    assert.equal(reads, 0);
    instance.detachHost();
    assert.equal(instance.data.phase, 'no_host');
  });
}

test('admin order detail has a real imported but default-off workbench entry', () => {
  const source = read('apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx');
  assert.match(source, /from "@\/features\/ai-native\/AiTaskWorkbench"/);
  assert.match(source, /const AI_NATIVE_ORDER_ENTRY_ENABLED = false/);
  assert.match(source, /AI_NATIVE_ORDER_ENTRY_ENABLED \? <AiTaskWorkbench/);
  assert.match(source, /enabled=\{false\}/);
});
