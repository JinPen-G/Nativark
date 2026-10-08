'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mountWithHost: mount } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' malformed resource events neither throw nor dispatch a host action', async () => {
    let calls = 0;
    const instance = mount(load('apps/' + app + '/src/components/ai-native/ai-knowledge-source/index.ts'), {
      sources: [{ id: 'synthetic-resource', version: '1', status: 'published', title: 'Synthetic' }],
      openHandler: async () => { calls++; },
    });
    for (const event of [null, undefined, {}, { currentTarget: null }, { currentTarget: {} }, { currentTarget: { dataset: null } }, { currentTarget: { dataset: {} } }, { currentTarget: { dataset: { id: {}, version: '1' } } }]) {
      await assert.doesNotReject(instance.onOpen(event));
    }
    assert.equal(calls, 0); assert.equal(instance.events.length, 0);
    await instance.onOpen({ currentTarget: { dataset: { id: 'synthetic-resource', version: '1' } } });
    assert.equal(calls, 1); assert.equal(instance.events.length, 1);
    instance.detach();
    await assert.doesNotReject(instance.onOpen(null));
    assert.equal(calls, 1);
  });
}
