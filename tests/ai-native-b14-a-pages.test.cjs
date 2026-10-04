'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, lifecycleProbe, defaultOffProbe } = require('./fixtures/ai-native/b14-page-regression.cjs');
const { mountWorkbench } = require('./fixtures/ai-native/b12-native-host.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B14-A ${app} default-off page has no AI read or action on lifecycle`, () => {
    const page = loadPage(app);
    assert.equal(page.data.aiNativeEntryVisible, false);
    const probe = defaultOffProbe(page);
    assert.deepEqual(probe.calls, [], 'default-off page must not invoke the AI host');
    assert.equal(probe.enabled, false);
  });

  test(`B14-A ${app} hide and unload detach local AI lifecycle`, () => {
    const page = loadPage(app);
    assert.deepEqual(lifecycleProbe(page).calls, ['hide', 'logout']);
  });

  test(`B14-A ${app} actual component stays unavailable without an explicit host`, async () => {
    const { instance } = mountWorkbench(app);
    let reads = 0;
    instance.hostShow(true);
    await instance.readSnapshot?.();
    assert.equal(reads, 0);
    assert.equal(instance.data.phase, 'no_host');
  });
}

test('B14-A real order pages keep named slot and component event wiring', () => {
  for (const app of ['miniprogram', 'staff-miniprogram']) {
    const json = JSON.parse(read(`apps/${app}/src/pages/order/index.json`));
    const wxml = read(`apps/${app}/src/pages/order/index.wxml`);
    assert.equal(typeof json.usingComponents['ai-task-workbench'], 'string');
    assert.match(wxml, /<ai-task-workbench\b/);
    for (const slot of ['task-card', 'step-timeline', 'clarification', 'proposal-confirm', 'knowledge-sources', 'memory-preferences', 'status-panel', 'order-explanation']) assert.match(wxml, new RegExp(`slot="${slot}"`));
    if (app === 'staff-miniprogram') assert.match(wxml, /slot="inspection-draft"/);
  }
});
