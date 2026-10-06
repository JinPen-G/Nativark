'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fixture = () => require('./fixtures/ai-native/lane-b-financial-db.cjs').fixture();
test('actual BudgetService and Prisma repository allow only one last-unit reservation', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.reserve(f.command('a')), f.service.reserve(f.command('b'))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  const failed = results.find(row => row.status === 'rejected'); assert.equal(failed.reason.code, 'EXHAUSTED');
  assert.equal(f.rows().reservations.length, 1); assert.equal(f.rows().allocations.length, 1);
  assert.equal(f.control.locks, 2); assert.deepEqual(f.networkAttempts(), []);
});
test('allocation failure rolls back the actual reservation write and remains unknown to the service', async () => {
  const f = fixture(); f.control.failAllocation = true;
  await assert.rejects(f.service.reserve(f.command('a')), { code: 'PENDING_RECONCILIATION' });
  assert.equal(f.rows().reservations.length, 0); assert.equal(f.rows().allocations.length, 0);
  assert.equal(f.control.attemptedReservations, 1);
});
test('foreign policy ownership cannot create a reservation despite a synthetically authorized caller', async () => {
  const f = fixture(); f.control.foreignPolicy = true;
  await assert.rejects(f.service.reserve(f.command('a')), { code: 'FORBIDDEN' });
  assert.equal(f.rows().reservations.length, 0); assert.equal(f.rows().allocations.length, 0);
});
