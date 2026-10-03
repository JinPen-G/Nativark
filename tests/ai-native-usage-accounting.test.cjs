'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test); require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { UsageAccountingService } = require('../apps/api/src/modules/ai-native/usage-accounting.service'); const scope = { id: 'tenant-a:space-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'space-a' };
function harness() {
  const f = require('./fixtures/ai-native/usage-settlement.cjs').setup(); f.state.rows = [];
  f.state.scope = structuredClone(scope); f.state.grant.context.scope = { kind: 'workspace', tenantId: scope.tenantId, workspaceId: scope.workspaceId };
  const repo = {
    get: async (s, key) => f.state.rows.find(r => r.tenantId === s.tenantId && r.workspaceId === s.workspaceId && (!key.id || r.id === key.id) && (!key.callId || r.callId === key.callId) && (!key.idempotencyKey || r.idempotencyKey === key.idempotencyKey)) ?? null,
    reserve: async value => { const row = { ...value, id: `usage-${value.callId}`, tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId, status: 'reserved', actualInput: null, actualOutput: null, unknownReason: null, updatedAt: new Date(), settledAt: null }; f.state.rows.push(row); return row; },
    transition: async (s, id, from, to, patch = {}) => { const row = f.state.rows.find(r => r.id === id && r.tenantId === s.tenantId && r.workspaceId === s.workspaceId && r.status === from); if (!row) return null; Object.assign(row, { status: to, unknownReason: patch.reason ?? null }); return row; },
    commitUsage: value => f.adapter.commitUsage(value)
  };
  return { get ledger() { return f.state.entries; }, service: new UsageAccountingService(repo) };
}
const input = (callId = 'call-u1') => ({ scope, callId, idempotencyKey: `key-${callId}`, reservedUnits: 100, expiresAt: new Date(Date.now() + 60_000) });
test('reservation and settlement are idempotent and ledger-backed', async () => { const h = harness(); const first = await h.service.reserve(input()); assert.equal((await h.service.reserve(input())).id, first.id); const settled = await h.service.settle(scope, first.id, 'event-1', 20, 30); assert.equal(settled.status, 'settled'); assert.equal((await h.service.settle(scope, first.id, 'event-1', 20, 30)).status, 'settled'); assert.equal(h.ledger.length, 1); });
test('unknown usage requires reconciliation and cannot be released as reserved', async () => { const h = harness(); const row = await h.service.reserve(input('call-u2')); await h.service.markUnknown(scope, row.id, 'transport_lost'); await assert.rejects(h.service.settle(scope, row.id, 'event-2', 1, 1), e => e.code === 'ACCOUNTING_PENDING'); const settled = await h.service.reconcile(scope, row.id, 'reconcile-1', 4, 5); assert.equal(settled.status, 'settled'); });
test('cross-tenant and expired reservations are rejected', async () => { const h = harness(); await assert.rejects(h.service.reserve({ ...input('call-u3'), expiresAt: new Date(Date.now() - 1) }), e => e.code === 'INVALID_REQUEST'); const row = await h.service.reserve(input('call-u4')); await assert.rejects(h.service.release({ ...scope, tenantId: 'tenant-b' }, row.id), e => e.code === 'BUDGET_UNAVAILABLE'); });
