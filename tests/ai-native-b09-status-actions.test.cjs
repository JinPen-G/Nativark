'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' status actions need explicit host availability and cannot run after detach', () => {
    const instance = mount(load('apps/' + app + '/src/components/ai-native/ai-status-panel/index.ts'), { state: 'unknown', actionText: 'Refresh' });
    instance.onAction(); instance.onManual();
    assert.equal(instance.events.length, 0, 'defaults must not offer an executable host action');
    instance.update({ actionAvailable: true, manualAvailable: true });
    instance.onAction(); instance.onManual();
    assert.deepEqual(instance.events.map(event => event.name), ['action', 'manual']);
    instance.update({ disabled: true }); instance.onAction(); instance.onManual();
    assert.equal(instance.events.length, 2);
    instance.update({ disabled: false, actionAvailable: false, manualAvailable: false });
    instance.onAction(); instance.onManual(); assert.equal(instance.events.length, 2);
    instance.update({ actionAvailable: true, manualAvailable: true }); instance.detach();
    instance.onAction(); instance.onManual(); assert.equal(instance.events.length, 2);
  });
}
