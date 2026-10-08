'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount, deferred } = require('./fixtures/ai-native/b09-host.cjs');

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' workbench binds host only through instance methods and isolates late detail', async () => {
    const definition = load('apps/' + app + '/src/components/ai-native/ai-task-workbench/index.ts');
    const children = new Map();
    const instance = mount(definition, { tasks: [{ id: 'task-1' }] });
    const rawSetData = instance.setData;
    instance.setData = (patch, callback) => { rawSetData.call(instance, patch); if (typeof callback === 'function') callback(); };
    instance.selectComponent = selector => children.get(selector) ?? null;
    for (const selector of ['#clarification', '#confirmation', '#sources']) {
      children.set(selector, { attached: 0, detached: 0, attachHost(fn) { this.attached += 1; this.fn = fn; }, detachHost() { this.detached += 1; this.fn = undefined; } });
    }
    let reads = 0;
    const pending = deferred();
    const host = {
      context: { audience: app === 'miniprogram' ? 'client' : 'staff', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      readDetail: async () => { reads += 1; return pending.promise; },
      submitInput: async () => {},
    };
    instance.attachHost(host);
    assert.equal(instance.data.phase, 'paused');
    instance.hostShow(true);
    const selecting = instance.selectTask({ detail: { taskId: 'task-1' } });
    assert.equal(reads, 1);
    instance.detachHost();
    pending.resolve({ steps: [], inputRevision: 'r1' });
    await selecting;
    await Promise.resolve(); await Promise.resolve();
    assert.equal(instance.data.phase, 'no_host');
    assert.equal(instance.data.ready, false);
    assert.equal(children.get('#clarification').detached > 0, true);
    assert.equal(children.get('#clarification').fn, undefined);
  });

  test(app + ' workbench default lifecycle has no host read or polling side effect', () => {
    const definition = load('apps/' + app + '/src/components/ai-native/ai-task-workbench/index.ts');
    let reads = 0;
    const instance = mount(definition, { tasks: [{ id: 'task-1' }] });
    instance.selectComponent = () => null;
    instance.hostShow(true);
    assert.equal(reads, 0);
    assert.equal(instance.data.phase, 'no_host');
  });
}
