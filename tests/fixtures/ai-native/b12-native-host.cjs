'use strict';
const assert = require('node:assert/strict');
const { load, mount, deferred, root } = require('./b09-host.cjs');
function serialOnly(value) {
  if (typeof value === 'function') throw new Error('function crossed native serialization boundary');
  if (value && typeof value === 'object') Object.values(value).forEach(serialOnly);
}
exports.mountWorkbench = function(app, generated = false) {
  const directory = `apps/${app}/${generated ? 'dist' : 'src'}/components/ai-native/`;
  const suffix = generated ? '.js' : '.ts';
  const childNames = { '#clarification': 'ai-supplement-input', '#confirmation': 'ai-proposal-confirm', '#sources': 'ai-knowledge-source', '#timeline': 'ai-step-timeline', '#memory': 'ai-memory-preference', '#card': 'ai-task-card', '#result': app === 'miniprogram' ? 'ai-order-explanation' : 'ai-inspection-draft' };
  const children = Object.fromEntries(Object.entries(childNames).map(([id, name]) => [id, mount(load(directory + name + '/index' + suffix))]));
  const instance = mount(load(directory + 'ai-task-workbench/index' + suffix));
  instance.selectComponent = id => children[id] ?? null;
  const original = instance.setData;
  let writes = 0;
  instance.setData = function(patch, callback) {
    serialOnly(patch); writes++;
    original.call(this, patch);
    // Explicit native property propagation; no business decisions in the test host.
    const mapping = {
      '#clarification': { fields: 'fields', inputRevision: 'inputRevision', taskId: 'selectedTaskId' },
      '#confirmation': { proposal: 'proposal', expired: 'proposalExpired', pending: 'pending' },
      '#sources': { sources: 'sources' }, '#timeline': { steps: 'steps', taskId: 'selectedTaskId', available: 'ready' },
      '#memory': { items: 'memories', available: 'ready' },
      '#result': app === 'miniprogram' ? { order: 'order', available: 'ready' } : { items: 'inspection' },
    };
    for (const [id, fields] of Object.entries(mapping)) {
      const updates = Object.fromEntries(Object.entries(fields).filter(([, key]) => Object.hasOwn(patch, key)).map(([prop, key]) => [prop, patch[key]]));
      if (Object.keys(updates).length) children[id].update(updates);
    }
    if (Object.hasOwn(patch, 'ready')) children['#clarification'].update({ disabled: !patch.ready });
    if (Object.hasOwn(patch, 'proposalEnabled') || Object.hasOwn(patch, 'ready')) children['#confirmation'].update({ disabled: !this.data.ready || !this.data.proposalEnabled });
    if (typeof callback === 'function') callback();
  };
  const card = children['#card'];
  const trigger = card.triggerEvent;
  card.triggerEvent = function(name, detail) { serialOnly(detail); trigger.call(this, name, detail); if (name === 'open') instance.selection = instance.selectTask({ detail }); };
  return { instance, children, get writes() { return writes; }, root, serialOnly };
};
exports.flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
exports.deferred = deferred;
