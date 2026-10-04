'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mountWithHost: mount, deferred } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
  const file = 'apps/' + app + '/src/components/ai-native/ai-supplement-input/index.ts';
  test(app + ' disabled during submission invalidates a late success even after reenable', async () => {
    const pending = deferred(); let calls = 0;
    const instance = mount(load(file), { taskId: 'synthetic-task', inputRevision: '1', fields: [{ key: 'note', label: 'Note' }], submitHandler: () => { calls++; return pending.promise; } });
    const submit = instance.onSubmit();
    instance.update({ disabled: true }); instance.update({ disabled: false });
    pending.resolve(); await submit;
    assert.equal(calls, 1); assert.equal(instance.events.length, 0);
  });
  test(app + ' detached clarification rejects late projection and malformed events', async () => {
    const instance = mount(load(file), { taskId: 'synthetic-task', inputRevision: '1', fields: [{ key: 'note', label: 'Note' }] });
    for (const event of [null, {}, { currentTarget: null }, { currentTarget: {} }]) assert.doesNotThrow(() => instance.onFieldInput(event));
    assert.doesNotThrow(() => instance.update({ fields: null }));
    assert.equal(instance.data.visibleFields.length, 0);
    instance.detach(); let writes = 0;
    const setData = instance.setData; instance.setData = patch => { writes++; setData.call(instance, patch); };
    instance.update({ fields: [{ key: 'note', label: 'private old content' }], taskId: 'synthetic-other' });
    instance.refreshFields();
    assert.equal(writes, 0); assert.equal(instance.data.visibleFields.length, 0);
  });
}
