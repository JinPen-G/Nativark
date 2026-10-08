'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { mountWorkbench, deferred, flush } = require('./fixtures/ai-native/b12-native-host.cjs');
const scene = require('./fixtures/ai-native/b12-scenes.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const app of ['miniprogram', 'staff-miniprogram']) test(app + ' workbench declares named slots without serializable callbacks', () => {
  const dir = path.join(root, 'apps', app, 'src/components/ai-native/ai-task-workbench');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');
  assert.deepEqual(json.usingComponents, {});
  for (const slot of ['task-card', 'step-timeline', 'clarification', 'proposal-confirm', 'knowledge-sources', 'memory-preferences', 'status-panel']) assert.match(wxml, new RegExp(`slot name="${slot}"`));
  assert.doesNotMatch(wxml, /function|handler=/);
});
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' private-host confirmation and clarification are actually enabled without function properties', async () => {
    const { instance, children } = mountWorkbench(app);
    let submits = 0, confirms = 0;
    instance.attachHost({ context: scene.context, readDetail: async () => scene.snapshot(), submitInput: async () => { submits++; }, confirmProposal: async () => { confirms++; } });
    instance.hostShow(true);
    children['#card'].update({ task: { id: 'task-1' }, available: true });
    children['#card'].onOpen(); await instance.selection;
    assert.equal(children['#clarification'].data.hostAvailable, true);
    assert.equal(children['#confirmation'].data.hostAvailable, true);
    children['#clarification'].onFieldInput({ currentTarget: { dataset: { key: 'note' } }, detail: { value: 'synthetic input' } });
    await children['#clarification'].onSubmit(); assert.equal(submits, 1);
    children['#confirmation'].onCheck({ detail: { value: ['read'] } });
    await children['#confirmation'].onConfirm(); assert.equal(confirms, 1);
    assert.equal(instance.data.actionState, 'unknown', 'callback completion is not business success');
  });
  test(app + ' real existing poll loop preserves large cursor and reset clears actionable snapshot', async () => {
    const { instance } = mountWorkbench(app);
    let pages = 0;
    instance.attachHost({ context: scene.context, readDetail: async () => scene.snapshot(), readPage: async () => { pages++; return { cursor: '9007199254740994', version: 'v1', events: [{ cursor: '9007199254740994', taskId: 'task-1', version: 'v1', type: 'reset_required' }] }; }, clock: { schedule() { return {}; }, clear() {} }, knownEventTypes: ['step.registered'] });
    instance.hostShow(true); await instance.selectTask({ detail: { taskId: 'task-1' } }); await flush();
    assert.equal(pages, 1); assert.equal(instance.data.ready, false); assert.equal(instance.data.phase, 'unsynced');
  });
}
