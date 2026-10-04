'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mountWorkbench, deferred, flush } = require('./fixtures/ai-native/b12-native-host.cjs');

function host(tenantId, readDetail, extra = {}) {
  return { context: { audience: 'staff', tenantId, workspaceId: `${tenantId}-space` }, readDetail, ...extra };
}

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B14-C ${app} late detail result is discarded after host/context replacement`, async () => {
    const { instance } = mountWorkbench(app);
    const first = deferred();
    instance.attachHost(host('tenant-a', () => first.promise));
    instance.hostShow(true);
    const reading = instance.selectTask({ detail: { taskId: 'task-a' } });
    instance.attachHost(host('tenant-b', async () => ({ actionState: 'unknown' })));
    first.resolve({ actionState: 'succeeded', steps: [{ id: 'late', taskId: 'task-a', status: 'succeeded' }] });
    await reading; await flush();
    assert.notEqual(instance.data.selectedTaskId, 'task-a');
    assert.equal(instance.data.phase, 'paused');
  });

  test(`B14-C ${app} missing reconcile handler keeps unknown state unavailable`, async () => {
    const { instance } = mountWorkbench(app);
    instance.attachHost(host('tenant-a', async () => ({ actionState: 'unknown', steps: [] })));
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-unknown' } });
    assert.equal(instance.data.actionState, 'unknown');
    assert.equal(instance.data.manualEnabled, false);
    assert.equal(instance.data.phase, 'snapshot_only');
  });

  test(`B14-C ${app} read failure remains failed and does not become success`, async () => {
    const { instance } = mountWorkbench(app);
    instance.attachHost(host('tenant-a', async () => { throw new Error('offline'); }));
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-failed' } });
    assert.equal(instance.data.phase, 'failed');
    assert.notEqual(instance.data.actionState, 'succeeded');
  });

  test(`B14-C ${app} rejected action is visible and never advances business state`, async () => {
    const { instance } = mountWorkbench(app);
    instance.attachHost(host('tenant-a', async () => ({
      actionState: 'waiting_confirmation', proposal: { id: 'proposal-a', revision: '7' }, proposalAvailable: true, proposalExpired: false,
    }), { confirmProposal: async () => { throw new Error('rejected'); } }));
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-proposal' } });
    await assert.rejects(() => instance.runHostAction('confirmProposal', { proposalId: 'proposal-a', revision: '7' }));
    assert.equal(instance.data.actionState, 'waiting_confirmation');
    assert.match(instance.data.errorLabel, /失败/);
  });

  test(`B14-C ${app} two workbench instances do not share task or context`, async () => {
    const left = mountWorkbench(app).instance;
    const right = mountWorkbench(app).instance;
    left.attachHost(host('tenant-left', async () => ({ actionState: 'unknown' })));
    right.attachHost(host('tenant-right', async () => ({ actionState: 'unknown' })));
    left.hostShow(true); right.hostShow(true);
    await left.selectTask({ detail: { taskId: 'left-task' } });
    assert.equal(left.data.selectedTaskId, 'left-task');
    assert.equal(right.data.selectedTaskId, '');
    assert.equal(right.data.phase, 'no_task');
  });
}
