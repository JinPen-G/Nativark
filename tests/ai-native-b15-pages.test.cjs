'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, lifecycleProbe, defaultOffProbe } = require('./fixtures/ai-native/b14-page-regression.cjs');

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B15-A ${app} actual order page keeps AI entry default-off and loads business data`, async () => {
    const definition = loadPage(app);
    const probe = defaultOffProbe(definition);
    assert.deepEqual(probe.calls, ['business-load']);
    assert.equal(probe.enabled, false);
  });

  test(`B15-D ${app} actual order page tears down native host on hide/unload`, () => {
    const definition = loadPage(app);
    const probe = lifecycleProbe(definition);
    assert.deepEqual(probe.calls, ['hide', 'logout']);
  });
}
