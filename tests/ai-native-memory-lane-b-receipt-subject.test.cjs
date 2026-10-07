'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');

test.after(() => assert.deepEqual(h.attempts, []));

test('memory operation receipts cannot be replayed by another audience', async () => {
  const f = h.memoryHarness();
  const operator = h.context({ audience: 'operator' });
  await f.memory.propose(operator, h.memoryProposal());
  const staff = h.context({ audience: 'staff' });
  await assert.rejects(f.memory.propose(staff, h.memoryProposal()), { code: 'conflict' });
});
