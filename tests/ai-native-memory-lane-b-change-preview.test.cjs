'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
test.after(() => assert.deepEqual(h.attempts, []));
test('authorized change preview writes nothing and confirmed alternatives never choose latest winner', async () => {
  const { ports, f, db } = fixture(), memory = new PersistentMemoryConsentService(ports);
  const expiresAt = new Date(h.now + 3600000).toISOString();
  for (const [memoryId, value] of [['memory-a', 'zh-CN'], ['memory-b', 'en-US']]) {
    await memory.propose({ memoryId, operationId: `propose-${memoryId}`, expiresAt, preference: { kind: 'locale', value } });
    await memory.confirm({ memoryId, expectedRevision: 1, operationId: `confirm-${memoryId}`, expiresAt });
  }
  const input = { memoryId: 'memory-a', expectedRevision: 2, preference: { kind: 'locale', value: 'en-US' } };
  const count = db.state.memoryOperations.size;
  const preview = await memory.previewChange(input);
  assert.equal(preview.writePerformed, false); assert.equal(preview.current.value, 'zh-CN');
  assert.equal(preview.candidate.value, 'en-US'); assert.equal(db.state.memoryOperations.size, count);
  const listed = await memory.confirmedPreferences({ limit: 10 });
  assert.equal(listed.items.length, 2); assert.equal(listed.ambiguities[0].nextStep, 'human_selection');
  assert.equal(listed.businessCompatibility, 'unavailable');
  f.rule = (_context, request) => request.action !== 'modify';
  await assert.rejects(memory.previewChange(input), { code: 'unavailable' });
  f.rule = () => true;
  await memory.change('modify-a', { draftVersion: 'ain-c06-draft-1', ...input, operation: 'modify' });
  assert.equal((await memory.state('memory-a')).storageStatus, 'proposed');
  assert.deepEqual((await memory.confirmedPreferences({ limit: 10 })).items.map(item => item.memoryId), ['memory-b']);
  await assert.rejects(memory.propose({ memoryId: 'malicious', operationId: 'malicious', expiresAt,
    preference: { kind: 'locale', value: 'en-US', permanentPermission: true } }), { code: 'invalid_input' });
  // The shared test policy intentionally accepts only its fixed issue time.
  // Reissue that policy at the controlled later clock; do not weaken production auth.
  const later = new PersistentMemoryConsentService({ ...ports, clock: { now: () => h.now + 7200000 },
    authorization: { authorize: async (context, request) => context.authorizedAt === new Date(h.now + 7200000).toISOString()
      ? ports.authorization.authorize({ ...context, authorizedAt: new Date(h.now).toISOString() }, request) : null } });
  assert.equal((await later.state('memory-b')).usable, false);
  assert.deepEqual((await later.confirmedPreferences({ limit: 10 })).items, []);
  await assert.rejects(later.previewChange({ ...input, memoryId: 'memory-b' }), { code: 'unavailable' });
  assert.equal(db.state.confirmations.size, 2); // expiry never creates/renews consent
});
