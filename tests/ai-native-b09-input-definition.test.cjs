'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' ambiguous and over-limit clarification definitions cannot silently submit a partial form', async () => {
    let calls = 0;
    const file = 'apps/' + app + '/src/components/ai-native/ai-supplement-input/index.ts';
    const duplicate = [{ key: 'note', label: 'First', value: 'given' }, { key: 'note', label: 'Second', required: true, readonly: true }];
    const overflow = Array.from({ length: 31 }, (_, i) => ({ key: 'field' + i, label: 'Synthetic ' + i, required: i === 30 }));
    const instance = mount(load(file), { taskId: 'synthetic-task', inputRevision: '1', fields: duplicate, submitHandler: async () => { calls++; } });
    for (const fields of [duplicate, overflow, null]) {
      instance.update({ fields }); await instance.onSubmit();
      assert.equal(calls, 0, 'must not choose one duplicate or omit a required overflow field');
      assert.equal(instance.events.length, 0);
      assert.match(instance.data.errorLabel, /字段定义不可用/);
    }
    instance.update({ fields: [{ key: 'note', label: 'Valid', value: 'synthetic', required: true }], inputRevision: '2' });
    assert.equal(instance.data.errorLabel, ''); await instance.onSubmit();
    assert.equal(calls, 1); assert.equal(instance.events.length, 1);
    instance.detach();
  });
}
