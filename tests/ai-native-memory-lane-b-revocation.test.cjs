'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
test.after(() => assert.deepEqual(h.attempts, []));
test('confirmation revoked during final memory reread cannot return a confirmed preference', async () => {
  const f = h.memoryHarness(), ctx = h.context();
  const proposed = await f.memory.propose(ctx, h.memoryProposal()); f.confirm(proposed);
  await f.memory.change(ctx, 'confirm-op', h.memoryChange('confirm', 1, { confirmationRecordId: 'confirm-1' }));
  const read = f.memoryRepository.read; let reads = 0;
  f.memoryRepository.read = async (...args) => {
    const result = await read(...args);
    if (++reads === 2) f.confirmations.get('confirm-1').status = 'revoked';
    return result;
  };
  await assert.rejects(f.memory.read(ctx, 'memory-1'), { code: 'unavailable' });
});
test('memory authorization cannot switch audience while the dependency awaits', async () => {
  const f = h.memoryHarness(), ctx = h.context(), base = f.authorization.authorize;
  f.authorization.authorize = async (context, request) => { ctx.audience = 'staff'; return base(context, request); };
  await assert.rejects(f.memory.propose(ctx, h.memoryProposal()), { code: 'unavailable' });
  assert.equal(f.memoryReceipts.size, 0);
});
