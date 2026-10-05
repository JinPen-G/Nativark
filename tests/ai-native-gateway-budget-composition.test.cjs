'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');

const { PersistentGatewayBudget } = require('../apps/api/src/modules/ai-native/budget/persistent-gateway-budget.ts');

const call = {
  context: { tenantId: 'tenant-1', workspaceId: 'workspace-1', actorId: 'actor-1' },
  binding: {
    id: 'admission-1', actorId: 'actor-1', callId: 'call-1', requestHash: 'a'.repeat(64),
    profileId: 'profile-1', dispatchId: 'dispatch-1',
    scope: { kind: 'WORKSPACE', id: 'scope-1', tenantId: 'tenant-1', workspaceId: 'workspace-1' }
  },
  request: { callId: 'call-1', model: 'model-1', maxOutputTokens: 32, intentHash: 'b'.repeat(64) },
  expiresAt: new Date('2026-10-05T12:00:00.000Z')
};

function record(status = 'reserved', dispatched = false) {
  return { id: 'reservation-1', status, dispatched, scopeId: 'scope-1', scopeKind: 'WORKSPACE', actorId: 'actor-1',
    revision: 1, storageVersion: new Date('2026-10-05T11:00:00.000Z'), association: {}, callId: 'call-1', sceneCode: 'scene',
    reserved: { unit: 'tokens', value: 3 }, actual: null, unknownReason: null, expiresAt: call.expiresAt };
}

function harness({ linkError = false } = {}) {
  const events = [];
  const lifecycle = {
    reserve: async () => { events.push('reserve'); return 'reservation-1'; },
    dispatch: async () => { events.push('dispatch'); return record('reserved', true); },
    settle: async () => { events.push('settle'); return record('settled', true); },
    release: async () => { events.push('release'); return record('released', false); },
    markUnknown: async () => { events.push('unknown'); return record('pending_reconciliation', true); },
    reconcile: async () => { events.push('reconcile'); return record('settled', true); }
  };
  const facts = {
    assertClaim: async () => events.push('assert'),
    link: async () => { events.push('link'); if (linkError) throw new Error('receipt link uncertain'); },
    dispatch: async () => events.push('receipt:dispatch'),
    cancelIfUnsent: async () => { events.push('receipt:cancel?'); return false; },
    recordUsage: async () => { events.push('receipt:usage'); return 'receipt-1'; }
  };
  return { events, budget: new PersistentGatewayBudget(lifecycle, facts) };
}

test('one composition uses reserve, dispatch, usage evidence and settle exactly once', async () => {
  const h = harness();
  const reserved = await h.budget.reserve(call);
  await h.budget.dispatch(call, reserved.id);
  await h.budget.settle(call, reserved.id, 'provider:event-1', { inputTokens: 1, outputTokens: 2 });
  assert.deepEqual(h.events, ['assert', 'reserve', 'link', 'assert', 'dispatch', 'receipt:dispatch', 'receipt:usage', 'settle']);
});

test('abandon after dispatch never releases and retains unknown for reconciliation', async () => {
  const h = harness();
  await h.budget.abandon(call, 'reservation-1', 'provider_timeout');
  assert.deepEqual(h.events, ['receipt:cancel?', 'unknown']);
});

test('receipt link failure is surfaced as a pending accounting outcome', async () => {
  const h = harness({ linkError: true });
  await assert.rejects(() => h.budget.reserve(call), error => error.code === 'ACCOUNTING_PENDING');
  assert.deepEqual(h.events, ['assert', 'reserve', 'link']);
});

test('a malformed composition fails closed before lifecycle calls', () => {
  assert.throws(() => new PersistentGatewayBudget({ reserve: () => {} }, {}), error => error.code === 'CONFIG_INVALID');
});
