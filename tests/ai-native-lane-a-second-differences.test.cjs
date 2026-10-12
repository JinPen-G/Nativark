'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
test('real composition prepares current terminology and member name differences without persisting', async () => {
  const h = await setup();
  const profile = h.core.getProfile('tenant_001');
  const section = await h.tools.openingSection({ key: 'workspace_profile' });
  assert.equal(section.status, 'ready_for_human_review');
  assert.equal(section.persistence, 'not_attempted');
  assert.deepEqual(section.manual.navigation, 'host_existing_section');
  await assert.rejects(h.tools.openingSection({ key: '../../secrets' }));
  const out = await h.tools.openingActions.prepareDifference({ expectedVersion: profile.configVersion,
    changes: [{ field: 'itemLabel', value: '合成展示名称' }] });
  assert.equal(out.changes[0].before, profile.terminology.itemLabel); assert.equal(out.changes[0].after, '合成展示名称');
  assert.equal(h.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  const materials = await h.tools.openingActions.requiredMaterials();
  assert.ok(materials.rows.every(row => row.materialDefinition === 'not_loaded_use_original_form'));
  const member = await h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'Synthetic revised' });
  assert.equal(member.changes[0].before, 'Synthetic customer'); assert.equal(member.writeAuthorization, 'not_granted');
  assert.equal(member.revision, 'not_loaded');
});
test('unknown/sensitive fields, stale context and withdrawal refuse difference preparation', async () => {
  const h = await setup();
  await assert.rejects(h.tools.openingActions.prepareDifference({ expectedVersion: 'old', changes: [{ field: 'itemLabel', value: 'new' }] }));
  await assert.rejects(h.tools.openingActions.prepareDifference({ expectedVersion: h.core.getProfile('tenant_001').configVersion, changes: [{ field: 'apiKey', value: 'fake' }] }));
  await assert.rejects(h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'new', phone: 'fake' }));
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'new' }));
  await assert.rejects(h.tools.openingActions.requiredMaterials());
});
