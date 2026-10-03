'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const confirmChange = revision => h.memoryChange('confirm', revision, { confirmationRecordId: 'confirm-1' });
async function fixture() { const f = h.memoryHarness(); f.proposal = await f.memory.propose(h.context(), h.memoryProposal()); return f; }
test.after(() => assert.deepEqual(h.attempts, []));
test('propose, server-confirm, modify invalidates confirmation and delete drops preference', async () => {
  const f = await fixture(), ctx = h.context(); f.confirm(f.proposal);
  const confirmed = await f.memory.change(ctx, 'confirm-op', confirmChange(1));
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.revision, 2); assert.ok(f.confirmationReads >= 2);
  assert.deepEqual(await f.memory.change(ctx, 'confirm-op', confirmChange(1)), confirmed);
  const modified = await f.memory.change(ctx, 'modify-op', h.memoryChange('modify', 2, { preference: { kind: 'display_density', value: 'compact' } }));
  assert.equal(modified.status, 'proposed'); assert.equal('confirmationRecordId' in modified, false);
  const deleted = await f.memory.change(ctx, 'delete-op', h.memoryChange('delete', 3));
  assert.equal(deleted.status, 'deleted'); assert.equal('preference' in deleted, false); assert.equal('confirmationRecordId' in deleted, false);
  assert.equal(f.memoryReceipts.size, 4);
});
test('unbacked confirmation ID is not approval and does not write', async () => {
  const f = await fixture();
  await assert.rejects(f.memory.change(h.context(), 'confirm-op', confirmChange(1)), { code: 'unavailable' });
  assert.equal(f.memoryReceipts.size, 1);
});
test('server record must bind actor, scope, audience, content, revision, ACL and validity', async () => {
  const variants = [
    { owner: { actorKind: 'user', actorId: 'other' } }, { scope: { ...h.scope, tenantId: 'other' } },
    { scope: { ...h.scope, workspaceId: 'other' } }, { audience: 'staff' }, { memoryId: 'other' },
    { revision: 2 }, { aclRevision: 2 }, { preference: { kind: 'locale', value: 'en-US' } },
    { status: 'revoked' }, { issuedAt: '2026-10-05T00:00:00Z' }, { expiresAt: new Date(h.now).toISOString() },
    { memoryExpiresAt: '2026-10-06T00:00:00Z' }, { expiresAt: '2026-10-06T00:00:00Z' },
  ];
  for (const invalid of variants) {
    const f = await fixture(); f.confirm(f.proposal, invalid);
    await assert.rejects(f.memory.change(h.context(), 'confirm-op', confirmChange(1)), { code: 'unavailable' });
    assert.equal(f.memoryReceipts.size, 1);
  }
});
test('modify-back to identical preference still rejects old confirmation revision', async () => {
  const f = await fixture(); f.confirm(f.proposal);
  await f.memory.change(h.context(), 'modify-op', h.memoryChange('modify', 1, { preference: f.proposal.preference }));
  await assert.rejects(f.memory.change(h.context(), 'confirm-op', confirmChange(2)), { code: 'unavailable' });
});
test('same operation with different payload or concurrent CAS cannot change approved value', async () => {
  const f = await fixture(), ctx = h.context();
  await assert.rejects(f.memory.propose(ctx, h.memoryProposal({ preference: { kind: 'locale', value: 'en-US' } })), { code: 'conflict' });
  const results = await Promise.allSettled(['compact', 'comfortable'].map(value => f.memory.change(ctx, `modify-${value}`, h.memoryChange('modify', 1, { preference: { kind: 'display_density', value } }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.memoryReceipts.size, 2);
});
test('current owner/scope checks reject cross-person/tenant/workspace and hostile repo records', async () => {
  const f = await fixture();
  for (const ctx of [h.context({ actor: { kind: 'user', userId: 'other' } }), h.context({ scope: { ...h.scope, tenantId: 'other' } }), h.context({ scope: { ...h.scope, workspaceId: 'other' } })]) {
    await assert.rejects(f.memory.read(ctx, 'memory-1'), { code: 'unavailable' });
    await assert.rejects(f.memory.change(ctx, 'delete-op', h.memoryChange('delete', 1)), { code: 'unavailable' });
  }
  f.memoryRepository.read = async () => ({ ...f.proposal, owner: { actorKind: 'user', actorId: 'other' } });
  await assert.rejects(f.memory.read(h.context(), 'memory-1'), { code: 'unavailable' });
});
test('revoked authorization or server confirmation blocks reads and replay', async () => {
  const f = await fixture(), ctx = h.context(); f.confirm(f.proposal);
  await f.memory.change(ctx, 'confirm-op', confirmChange(1));
  f.confirmations.get('confirm-1').status = 'revoked';
  await assert.rejects(f.memory.read(ctx, 'memory-1'), { code: 'unavailable' });
  await assert.rejects(f.memory.change(ctx, 'confirm-op', confirmChange(1)), { code: 'unavailable' });
  f.denied = true; await assert.rejects(f.memory.change(ctx, 'delete-op', h.memoryChange('delete', 2)), { code: 'unavailable' });
});
test('confirmation changing during commit is rejected by repository contract', async () => {
  const f = await fixture(); f.confirm(f.proposal); const commit = f.memoryRepository.commit;
  f.memoryRepository.commit = async input => { f.confirmations.get('confirm-1').status = 'revoked'; return commit(input); };
  await assert.rejects(f.memory.change(h.context(), 'confirm-op', confirmChange(1)), { code: 'conflict' });
  assert.equal(f.memoryReceipts.size, 1);
});
test('fixed preferences reject secrets, free JSON, permanent grants; location remains preference only', async () => {
  const f = h.memoryHarness();
  for (const preference of [{ kind: 'api_key', value: 'synthetic' }, { kind: 'locale', value: 'zh-CN', permission: 'all' }, { kind: 'chat', messages: [] }, { kind: 'fulfillment_location', locationId: 'https://example.invalid' }]) await assert.rejects(f.memory.propose(h.context(), h.memoryProposal({ preference })), { code: 'invalid_input' });
  const location = await f.memory.propose(h.context(), h.memoryProposal({ preference: { kind: 'fulfillment_location', locationId: 'not-authorized-location' } }));
  assert.equal(location.status, 'proposed'); assert.equal('permissions' in location, false);
});
test('expiry boundary blocks consumption but permits authorized deletion; no unlimited TTL', async () => {
  const f = await fixture(); f.now = Date.parse(f.proposal.expiresAt);
  await assert.rejects(f.memory.read(h.context(), 'memory-1'), { code: 'unavailable' });
  assert.equal((await f.memory.change(h.context(), 'delete-op', h.memoryChange('delete', 1))).status, 'deleted');
  await assert.rejects(f.memory.propose(h.context(), h.memoryProposal({ memoryId: 'forever', expiresAt: '2036-01-01T00:00:00Z' })), { code: 'invalid_input' });
});
test('no production defaults and no automation self-confirmation', async () => {
  const f = await fixture(), { StructuredMemoryService } = h.load('structured-memory.service');
  for (const key of ['repository', 'authorization', 'clock', 'confirmations']) assert.throws(() => new StructuredMemoryService({ ...f.memoryPorts, [key]: undefined }), { code: 'unavailable' });
  await assert.rejects(f.memory.propose(h.context({ audience: 'automation', actor: { kind: 'automation', subjectId: 'bot', policyId: 'policy', policyRevision: 1, expiresAt: '2026-10-04T00:00:00Z' } }), h.memoryProposal()), { code: 'unavailable' });
});
