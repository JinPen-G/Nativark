'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
test.after(() => assert.deepEqual(h.attempts, []));

test('confirmation detail suppresses stale consent or identity after final memory read', async () => {
  for (const change of ['identity', 'consent']) {
    const { ports, flags, db } = fixture(), api = new PersistentMemoryConsentService(ports);
    const expiresAt = new Date(h.now + 3600000).toISOString();
    await api.propose({ memoryId: 'detail-memory', operationId: 'detail-propose', expiresAt,
      preference: { kind: 'locale', value: 'zh-CN' } });
    await api.confirm({ memoryId: 'detail-memory', expectedRevision: 1, operationId: 'detail-confirm', expiresAt });
    assert.equal((await api.confirmationDetail('detail-memory')).status, 'confirmed');
    const read = db.aiStructuredMemory.findFirst; let reads = 0;
    db.aiStructuredMemory.findFirst = async args => {
      const row = await read(args);
      if (++reads === 2) {
        if (change === 'identity') flags.active = false;
        else for (const proof of db.state.confirmations.values()) {
          proof.status = 'revoked'; proof.state.status = 'revoked';
        }
      }
      return row;
    };
    await assert.rejects(api.confirmationDetail('detail-memory'));
  }
});
test('confirmed preference enumeration checks each current consent and audience, excludes proposals/revocations', async () => {
  const { ports, flags } = fixture(), api = new PersistentMemoryConsentService(ports);
  const expiresAt = new Date(h.now + 3600000).toISOString();
  const propose = memoryId => ({ memoryId, operationId: `propose-${memoryId}`, expiresAt, preference: { kind: 'locale', value: 'zh-CN' } });
  const confirm = memoryId => ({ memoryId, expectedRevision: 1, operationId: `confirm-${memoryId}`, expiresAt });
  await api.propose(propose('memory-a')); await api.confirm(confirm('memory-a'));
  await api.propose(propose('memory-b'));
  const staff = new PersistentMemoryConsentService({ ...ports,
    credentials: { current: async () => ({ authorization: 'synthetic-staff', requestId: 'request-1', audience: 'staff' }) } });
  await staff.propose(propose('memory-c')); await staff.confirm(confirm('memory-c'));
  const list = await api.confirmedPreferences({ limit: 10 });
  assert.deepEqual(list.items.map(v => v.memoryId), ['memory-a']);
  assert.equal(list.semantics, 'preference_not_authority');
  await api.revoke({ memoryId: 'memory-a', expectedRevision: 2 });
  const state = await api.state('memory-a');
  assert.equal(state.storageStatus, 'confirmed'); assert.equal(state.consentStatus, 'revoked');
  assert.equal(state.usable, false); assert.equal(state.preference, undefined);
  const deletion = { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-a', expectedRevision: 2, operation: 'delete' };
  await api.change('delete-a', deletion);
  assert.equal((await api.state('memory-a')).storageStatus, 'deleted');
  assert.equal((await api.changeStatus('delete-a', deletion)).status, 'committed_current');
  await assert.rejects(api.changeStatus('delete-a', { ...deletion, expectedRevision: 1 }), { code: 'conflict' });
  assert.deepEqual((await api.confirmedPreferences({ limit: 10 })).items, []);
  flags.active = false;
  await assert.rejects(api.confirmedPreferences({ limit: 10 }), { code: 'unavailable' });
});
