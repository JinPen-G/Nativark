'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mountWorkbench, deferred, flush } = require('./fixtures/ai-native/b12-native-host.cjs');

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B14-E ${app} expired proposal cannot be confirmed`, async () => {
    const { instance, children } = mountWorkbench(app);
    let calls = 0;
    instance.attachHost({ context: { audience: 'tenant', tenantId: 't', workspaceId: 'w' }, readDetail: async () => ({
      actionState: 'waiting_confirmation', proposal: { id: 'p', revision: '1' }, proposalAvailable: true, proposalExpired: true,
    }), confirmProposal: async () => { calls++; } });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 't' } });
    await assert.rejects(() => instance.runHostAction('confirmProposal', { proposalId: 'p', revision: '1' }));
    assert.equal(calls, 0);
    assert.equal(children['#confirmation'].data.expired, true);
  });

  test(`B14-E ${app} confirmation is bound to complete proposal reference and UI pending prevents duplicate action`, async () => {
    const { instance } = mountWorkbench(app);
    const pending = deferred();
    let calls = 0;
    instance.attachHost({ context: { audience: 'tenant', tenantId: 't', workspaceId: 'w' }, readDetail: async () => ({
      actionState: 'waiting_confirmation', proposal: { id: 'p', revision: '2' }, proposalAvailable: true, proposalExpired: false,
    }), confirmProposal: async (_context, input) => { calls++; assert.equal(input.revision, '2'); return pending.promise; } });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 't' } });
    const first = instance.runHostAction('confirmProposal', { proposalId: 'p', revision: '2' });
    await assert.rejects(() => instance.runHostAction('confirmProposal', { proposalId: 'p', revision: '2' }));
    assert.equal(calls, 1);
    pending.resolve();
    await first; await flush();
    assert.equal(instance.data.actionState, 'waiting_confirmation');
  });

  test(`B14-E ${app} stale proposal reference is rejected before host action`, async () => {
    const { instance } = mountWorkbench(app);
    let calls = 0;
    instance.attachHost({ context: { audience: 'tenant', tenantId: 't', workspaceId: 'w' }, readDetail: async () => ({ proposal: { id: 'p', revision: '3' }, proposalAvailable: true, proposalExpired: false }), confirmProposal: async () => { calls++; } });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 't' } });
    await assert.rejects(() => instance.runHostAction('confirmProposal', { proposalId: 'p', revision: '2' }));
    assert.equal(calls, 0);
  });

  test(`B14-E ${app} business result is a host projection and keeps unknown fields out`, async () => {
    const { instance, children } = mountWorkbench(app);
    instance.attachHost({ context: { audience: 'client', tenantId: 't', workspaceId: 'w' }, readDetail: async () => ({
      ...(app === 'miniprogram' ? { order: { title: '订单', receivable: '100.00', paid: '0.00', deposit: '20.00', preAuth: '0.00', refundStatus: 'pending', availabilityLabel: '待分配', customerPhone: 'secret' } } : { inspection: [{ key: 'mileage', label: '里程', candidate: '100', humanValue: '', sourceLabel: '现场' , customerPhone: 'secret' }] }),
    }) });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 't' } });
    await flush();
    if (app === 'miniprogram') {
      assert.equal(children['#result'].data.order.customerPhone, undefined);
      assert.equal(children['#result'].data.order.receivable, '100.00');
    } else {
      assert.equal(children['#result'].data.items[0].customerPhone, undefined);
      assert.equal(children['#result'].data.items[0].candidate, '100');
    }
  });
}
