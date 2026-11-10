'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
test('actual order pack produces inventory candidates, never execution permission or guessed navigation', async () => {
  const h = await setup(), facts = new AiOrderExplanationFactsService(h.authority, h.reader);
  const out = await new AiOrderNextStepsService(h.authority, facts).read();
  assert.equal(out.allowedActions, 'unavailable'); assert.ok(out.candidates.some(row => row.code === 'rental.order.explain'));
  assert.ok(out.candidates.every(row => row.executable === false)); assert.equal(out.manual.orderId, 'order-a');
  assert.equal('url' in out.manual, false); assert.equal(out.candidates.some(row => row.code.includes('refund')), false);
});
test('revoked order reader cannot obtain next-step candidates or manual reference', async () => {
  const h = await setup(); h.state.user.permissions = [];
  await assert.rejects(new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader)).read());
});

test('AIN13 current-source refuses a changed order after the first complete fact observation', async () => {
  for (const change of [h => { h.state.order.updatedAt = '2026-01-03T00:00:00Z'; },
    h => { h.state.order.status = 'renting'; }]) {
    const h = await setup(); let reads = 0;
    // Explicit scalar leaf timing, not SQL/ACL emulation. The actual Core and
    // Guard remain live; mutation occurs after the first pair of fact reads.
    h.state.afterRead = async () => { if (++reads === 2) change(h); };
    const service = new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader));
    await assert.rejects(service.read(), 'stale manual/candidate material must not cross the source fence');
  }
});

test('AIN13 current-source retains the original tenant-admin read grant, not an extra permission-array gate', async () => {
  const h = await setup(); h.state.user.isPlatformAdmin = true; h.state.user.permissions = [];
  const service = new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader));
  const out = await service.read(); assert.deepEqual(out.candidates.map(row => row.code), ['rental.order.explain']);
  assert.equal(out.allowedActions, 'unavailable'); assert.ok(out.candidates.every(row => row.executable === false));
});

test('current next-step source rejects changed identity and malformed fact binding without exposing actions', async () => {
  for (const change of [h => { h.state.member = false; }, h => { h.state.user.permissions = []; },
    h => { h.state.workspace = 'workspace-b'; }, h => { h.state.user.dataScope = 'own'; },
    h => { h.state.user.locationScope = { mode: 'selected', locationIds: ['location-b'] }; }]) {
    const h = await setup(); let changed = false;
    h.state.afterRead = async () => { if (!changed) { changed = true; change(h); } };
    await assert.rejects(new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader)).read());
  }
  for (const change of [row => { row.audience = 'staff'; }, row => { row.orderVersion = '2026-01-04T00:00:00Z'; },
    row => { row.order.source.resourceId = 'other-order'; }]) {
    const h = await setup(), facts = new AiOrderExplanationFactsService(h.authority, h.reader), read = facts.read.bind(facts);
    // Deliberately damaged output of the real reader; never a success adapter.
    facts.read = async (...args) => { const row = await read(...args); change(row); return row; };
    await assert.rejects(new AiOrderNextStepsService(h.authority, facts).read());
  }
});

test('manual next-step handoff only resolves its currently read R0 code and never an arbitrary business action', async () => {
  const h = await setup(), service = new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader));
  const current = await h.authority.resolve();
  await assert.rejects(service.read({ ...current, scope: { ...current.scope, workspaceId: 'workspace-b' } }));
  const refreshed = { ...current, requestId: 'another-read', authorizedAt: '2026-01-01T00:00:00Z' };
  const out = await service.read(refreshed); assert.equal(out.orderId, 'order-a');
  const opened = await service.manualHandoff({ code: 'rental.order.explain' });
  assert.equal(opened.status, 'manual_review'); assert.equal(opened.execution, 'not_attempted');
  for (const code of ['rental.quote.preview', 'rental.change.preview', 'rental.order.commit', 'refund', 'https://not-a-route.invalid']) {
    const result = await service.manualHandoff({ code }); assert.equal(result.status, 'unavailable'); assert.equal(result.execution, 'not_attempted');
  }
  await assert.rejects(service.manualHandoff({ code: 'rental.order.explain', url: '/funds/refund' }));
  const originalOrder = structuredClone(h.state.order);
  for (const [requested, replacement] of [['rental.order.commit', 'rental.order.explain'],
    ['rental.order.explain', 'rental.order.commit']]) {
    const command = { code: requested }; let mutations = 0;
    // Only the caller's object changes during an actual Core read. Authority,
    // allowed candidates and original order evidence stay live and unchanged.
    h.state.afterRead = async () => { mutations++; command.code = replacement; };
    try {
      const result = await service.manualHandoff(command);
      assert.ok(mutations > 0); assert.equal(command.code, replacement);
      assert.equal(result.status, requested === 'rental.order.explain' ? 'manual_review' : 'unavailable',
        'a completed source read must consume the original handoff intent, not the mutated caller object');
      assert.equal(result.execution, 'not_attempted');
      if (requested === 'rental.order.explain') {
        assert.equal(result.candidate.code, requested); assert.equal(result.candidate.executable, false);
        assert.equal(result.allowedActions, 'unavailable'); assert.equal(result.destinationReauthorization, 'required');
        assert.equal(result.manual.orderId, 'order-a'); assert.equal('url' in result.manual, false);
      } else assert.equal(result.reason, 'candidate_not_currently_verified');
      assert.deepEqual(h.state.order, originalOrder);
    } finally { h.state.afterRead = null; }
  }
  const revokedCommand = { code: 'rental.order.explain' };
  h.state.afterRead = async () => { revokedCommand.code = 'rental.order.commit'; h.state.user.permissions = []; };
  try { await assert.rejects(service.manualHandoff(revokedCommand), 'capturing intent cannot bypass live withdrawal'); }
  finally { h.state.afterRead = null; }
  assert.deepEqual(h.state.order, originalOrder);
});
