'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount } = require('./fixtures/ai-native/b09-host.cjs');
for (const app of ['miniprogram', 'staff-miniprogram']) {
 const file = 'apps/' + app + '/src/components/ai-native/ai-task-card/index.ts';
 test(app + ' card has a bounded whitelist and no automatic open', () => {
  const input = { id: 'synthetic-task', title: '😀'.repeat(1000), summary: 'x'.repeat(10000), partial: 'false', statusLabel: '登记不等于执行', updatedAt: 'not-a-date', internalAuthorization: 'secret', apiKey: 'secret' };
  const instance = mount(load(file), { task: input, available: true });
  assert.equal(instance.events.length, 0);
  assert.ok(instance.data.projection, 'initial safe projection');
  assert.equal(Array.from(instance.data.projection.title).length, 200);
  assert.equal(instance.data.projection.summary.length, 4000);
  assert.equal(instance.data.projection.partial, false);
  assert.equal(instance.data.projection.updatedLabel, '时间不可用');
  assert.equal(instance.data.projection.statusLabel, '登记不等于执行');
  assert.doesNotMatch(JSON.stringify(instance.data.projection), /secret/);
  instance.onOpen();
  assert.deepEqual(instance.events[0].detail.taskId, 'synthetic-task');
  assert.deepEqual(Object.keys(instance.events[0].detail), ['taskId']);
  assert.equal(input.title.length, 2000, 'does not mutate host input');
 });
 test(app + ' card fails closed for unavailable/malformed/revoked/detached props', () => {
  const instance = mount(load(file), { task: { id: 'synthetic-task', title: 'private' } });
  instance.onOpen(); assert.equal(instance.events.length, 0, 'host must explicitly enable availability');
  instance.update({ available: true, task: { id: 'synthetic-task', title: 'fresh' } });
  assert.ok(instance.data.projection);
  instance.update({ disabled: true }); instance.onOpen(); assert.equal(instance.events.length, 0);
  instance.update({ disabled: false, available: false });
  assert.equal(instance.data.projection, null);
  instance.update({ available: true });
  assert.equal(instance.data.projection, null, 'must receive freshly authorized data');
  instance.onOpen(); assert.equal(instance.events.length, 0);
  for (const task of [null, [], { id: {} }, { id: 'x'.repeat(129) }, { id: 'bad\nidentifier' }]) {
   instance.update({ task }); instance.onOpen(); assert.equal(instance.events.length, 0);
  }
  instance.update({ task: { id: 'fresh-task', summary: { private: 'secret' } } });
  assert.equal(instance.data.projection.summary, '暂无摘要');
  instance.detach(); instance.onOpen();
  assert.equal(instance.data.projection, null);
  assert.equal(instance.events.length, 0);
 });
}
