'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
 test(app + ' timeline mounts, isolates task switches and clears revoked/unmounted data', () => {
  const component = mount(load('apps/' + app + '/src/components/ai-native/ai-step-timeline/index.ts'), {
   taskId: 'task-a', available: true,
   steps: [{ id: 'step-a', ordinal: 1, label: 'Registered only', statusLabel: '登记不等于执行', sourceLabel: 'host', internal: 'secret' }]
  });
  assert.equal(component.data.visibleSteps.length, 1, 'initial attached projection');
  assert.equal(component.data.visibleSteps[0].internal, undefined);
  component.update({ taskId: 'task-b' });
  assert.equal(component.data.visibleSteps.length, 0, 'old task rows must disappear');
  component.update({ steps: [{ id: 'step-b', ordinal: 2, label: 'B', statusLabel: '待核对' }] });
  assert.equal(component.data.visibleSteps[0].id, 'step-b');
  component.update({ available: false });
  assert.equal(component.data.visibleSteps.length, 0);
  component.update({ available: true });
  assert.equal(component.data.visibleSteps.length, 0, 'reauthorization must not resurrect old rows');
  component.update({ steps: [{ id: 'new', ordinal: 3, label: 'fresh' }] });
  assert.equal(component.data.visibleSteps.length, 1);
  component.detach();
  assert.equal(component.data.visibleSteps.length, 0);
  assert.equal(component.events.length, 0);
 });
 test(app + ' timeline bounds rows/text and never fabricates ordinal or status', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: 's' + i, ordinal: NaN, label: '😀'.repeat(5000) + '\u202e', statusLabel: null }));
  const component = mount(load('apps/' + app + '/src/components/ai-native/ai-step-timeline/index.ts'), { taskId: 't', available: true, steps: rows });
  assert.equal(component.data.visibleSteps.length, 50);
  assert.equal(component.data.visibleSteps[0].ordinal, null);
  assert.equal(Array.from(component.data.visibleSteps[0].label).length, 4000);
  assert.equal(component.data.visibleSteps[0].statusLabel, '无法识别／待刷新');
  component.update({ steps: [null, { id: 'foreign', taskId: 'other', label: 'secret' }] });
  assert.equal(component.data.visibleSteps.length, 0);
 });
}
