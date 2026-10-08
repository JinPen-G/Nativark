'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load, mount, mountWithHost, deferred } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
  for (const [name, option] of [['ai-proposal-confirm','confirmHandler'], ['ai-supplement-input','submitHandler'], ['ai-knowledge-source','openHandler']]) {
    test(`${app}/${name}: scenario callbacks bind privately and never enter serialized data`, () => {
      const definition = load(`apps/${app}/src/components/ai-native/${name}/index.ts`);
      assert.equal(Object.hasOwn(definition.properties, option), false);
      const raw = mount(definition); assert.equal(raw.data.hostAvailable, false);
      const instance = mountWithHost(definition, { [option]: async () => {} });
      assert.equal(instance.data.hostAvailable, true); assert.equal(Object.hasOwn(instance.data, option), false);
      assert.equal(Object.values(instance.data).some(value => typeof value === 'function'), false);
      instance.update({ [option]: null }); assert.equal(instance.data.hostAvailable, false);
      assert.equal(Object.hasOwn(instance.data, option), false);
    });
  }
  test(`${app}: rebound confirmation callback invalidates old acknowledgement`, async () => {
    const definition = load(`apps/${app}/src/components/ai-native/ai-proposal-confirm/index.ts`), pending = deferred();
    const instance = mountWithHost(definition, { proposal: { id: 'proposal-1', revision: '1' }, disabled: false, confirmHandler: () => pending.promise });
    instance.onCheck({ detail: { value: ['read'] } }); const first = instance.onConfirm();
    instance.update({ confirmHandler: async () => {} }); pending.resolve(); await first;
    assert.equal(instance.events.filter(event => event.name === 'confirm').length, 0);
  });
}
