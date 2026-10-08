'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mountWithHost: mount, deferred } = require('./fixtures/ai-native/b09-host.cjs');
// Host snapshots are synthetic, already-authorized display inputs, not a new HTTP DTO.
for (const app of ['miniprogram', 'staff-miniprogram']) {
 for (const resultLabel of ['已完成', '待核对：外部结果未知']) {
  test(app + ' actual composed flow reaches ' + resultLabel + ' and reset removes stale views', async () => {
   const prefix = 'apps/' + app + '/src/components/ai-native/';
   const card = mount(load(prefix + 'ai-task-card/index.ts'), { task: { id: 'synthetic-task', title: 'Synthetic task' }, available: true });
   const timeline = mount(load(prefix + 'ai-step-timeline/index.ts'), { taskId: 'synthetic-task', available: true, steps: [{ id: 's1', ordinal: 1, statusLabel: '已登记，未执行' }] });
   const inputPending = deferred(), confirmPending = deferred();
   let submits = 0, confirmations = 0;
   const input = mount(load(prefix + 'ai-supplement-input/index.ts'), {
    taskId: 'synthetic-task', inputRevision: '1', fields: [{ key: 'note', label: 'Synthetic note' }],
    submitHandler: () => { submits++; return inputPending.promise; }
   });
   const proposal = mount(load(prefix + 'ai-proposal-confirm/index.ts'), {
    proposal: { id: 'synthetic-proposal', revision: '1' }, disabled: false,
    confirmHandler: () => { confirmations++; return confirmPending.promise; }
   });
   const result = mount(load(prefix + 'ai-order-explanation/index.ts'), { available: true, order: { paid: null, availabilityLabel: '等待结果' } });
   card.onOpen(); assert.equal(card.events[0].detail.taskId, 'synthetic-task');
   assert.equal(timeline.data.visibleSteps[0].statusLabel, '已登记，未执行');
   input.onFieldInput({ currentTarget: { dataset: { key: 'note' } }, detail: { value: 'synthetic only' } });
   const submit = input.onSubmit(); await input.onSubmit(); assert.equal(submits, 1);
   inputPending.resolve(); await submit; assert.equal(input.events.filter(e => e.name === 'submit').length, 1);
   proposal.onCheck({ detail: { value: ['read'] } });
   const confirmation = proposal.onConfirm(); await proposal.onConfirm(); assert.equal(confirmations, 1);
   assert.equal(result.data.projection.paid, '未知');
   confirmPending.resolve(); await confirmation;
   assert.equal(proposal.events.filter(e => e.name === 'confirm').length, 1, 'host callback settled, not business approval proof');
   proposal.update({ disabled: true });
   const { initialCursorState } = load(prefix + 'cursor-adapter.ts');
   const { consumeCursorPage } = load(prefix + 'cursor-page.ts');
   const { AiPollingController } = load(prefix + 'polling-controller.ts');
   let state = initialCursorState('synthetic-task', 'fixture-v1');
   const reads = []; const pages = [];
   const controller = new AiPollingController(() => { const pending = deferred(); reads.push(pending); return pending.promise; }, page => {
    const next = consumeCursorPage(state, page.events, false, ['fixture.snapshot']);
    state = next.state; pages.push(state.sync);
    if (state.sync === 'unsynced') {
     card.update({ available: false }); timeline.update({ available: false }); result.update({ available: false }); proposal.update({ disabled: true });
    }
   });
   const context = { audience: app === 'miniprogram' ? 'client' : 'staff', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space', taskId: 'synthetic-task' };
   const poll = controller.poll(context); assert.equal(await controller.poll(context), 'skipped');
   reads[0].resolve({ cursor: '9007199254740993', version: 'fixture-v1', events: [{ taskId: 'synthetic-task', version: 'fixture-v1', type: 'fixture.snapshot', cursor: '9007199254740993' }] });
   assert.equal(await poll, 'started'); assert.equal(state.cursor, '9007199254740993');
   // Only the host supplies business labels/amounts; envelope consumption never computes them.
   timeline.update({ steps: [{ id: 's2', ordinal: 2, statusLabel: resultLabel }] });
   result.update({ order: { availabilityLabel: resultLabel, paid: null, refundStatus: '未确认' } });
   assert.equal(timeline.data.visibleSteps[0].statusLabel, resultLabel);
   assert.equal(result.data.projection.availabilityLabel, resultLabel);
   assert.equal(result.data.projection.paid, '未知');
   const reset = controller.poll(context);
   reads[1].resolve({ cursor: null, version: 'fixture-v1', events: [{ type: 'reset_required', taskId: 'synthetic-task', version: 'fixture-v1', cursor: '9007199254740994' }] });
   await reset; assert.equal(state.sync, 'unsynced'); assert.equal(state.cursor, null);
   assert.equal(card.data.projection, null); assert.equal(result.data.projection, null); assert.equal(timeline.data.visibleSteps.length, 0);
   proposal.onCheck({ detail: { value: ['read'] } }); await proposal.onConfirm(); assert.equal(confirmations, 1);
   const late = controller.poll(context); controller.changeContext();
   reads[2].resolve({ cursor: '9007199254740994', version: 'fixture-v1', events: [] });
   assert.equal(await late, 'stale'); assert.equal(pages.length, 2);
   controller.destroy(); for (const component of [card, timeline, input, proposal, result]) component.detach();
   assert.equal(await controller.poll(context), 'skipped');
  });
 }
}
