'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { BudgetService } = require('../apps/api/src/modules/ai-native/budget/budget.service.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { quantityAtoms } = require('../apps/api/src/modules/ai-native/budget/budget-quantity.ts');
const { validateBudgetSettings } = require('../apps/api/src/modules/ai-native/budget/budget-settings.ts');
const { assertBudgetSettingsPermit } = require('../apps/api/src/modules/ai-native/budget/budget-settings.ts');

const now = new Date('2026-10-04T12:00:00.000Z');
const association = {
  requestId: 'req-1', runId: 'run-1', stepId: 'step-1', actionId: 'action-1', idempotencyKey: 'idem-1', priceVersion: 'price-1',
  scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' },
  config: { configId: 'config-1', configRevision: 1, credentialRef: 'vault-1', protocol: 'openai-compatible', provider: 'synthetic', model: 'model-1', tenantId: 'tenant-1', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant-1' } }
};
const context = {
  contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth-1', authorizedAt: now.toISOString(), audience: 'staff',
  actor: { kind: 'user', userId: 'actor-1' }, scope: association.scope,
  access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }
};
const settings = {
  draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant-1' }, config: association.config,
  gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
  sceneCode: 'rental.order.explain', allowedModels: ['model-1'], allowedScenes: ['rental.order.explain'],
  budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 1
};
function clone(value) { return JSON.parse(JSON.stringify(value)); }
class MemoryBudgetRepository {
  constructor() { this.record = null; this.revision = 0; this.ledger = new Map(); }
  async settings() { return null; }
  async saveSettings(_key, value, expected) { if (expected !== this.revision) throw new BudgetError('REVISION_CONFLICT'); this.revision += 1; return { id: 'policy-1', scopeId: 'scope-1', scopeKind: 'TENANT', sceneCode: value.sceneCode, revision: this.revision, settings: value }; }
  async reserve(quote, _command) {
    const requestHash = JSON.stringify(quote);
    if (this.record) { if (this.record.requestHash === requestHash) return this.record.value; throw new BudgetError('IDEMPOTENCY_CONFLICT'); }
    this.record = { requestHash, value: { id: 'reservation-1', scopeId: 'scope-1', scopeKind: 'WORKSPACE', revision: 1, storageVersion: now, association: quote.association, callId: quote.callId, sceneCode: quote.sceneCode, status: 'reserved', reserved: quote.quantity, actual: null, dispatched: false, unknownReason: null, expiresAt: quote.expiresAt } };
    return this.record.value;
  }
  async get() { return this.record?.value ?? null; }
  async mutate(record, input) {
    const ledgerKey = `${record.id}:${input.eventKey}`;
    if (this.ledger.has(ledgerKey)) return record;
    this.ledger.set(ledgerKey, input);
    if (input.action === 'dispatch') record.dispatched = true;
    if (input.action === 'unknown') { record.status = 'pending_reconciliation'; record.dispatched = true; record.unknownReason = input.reason; }
    if (input.action === 'settle' || input.action === 'reconcile') { record.status = 'settled'; record.actual = input.usage.quantity; }
    if (input.action === 'release') record.status = 'released';
    return record;
  }
}
function harness({ changing = false } = {}) {
  const repository = new MemoryBudgetRepository(); let resolveCount = 0;
  const authority = { resolve: async () => { resolveCount += 1; if (changing && resolveCount > 2) throw new Error('revoked'); return { context: clone(context), authorizationKey: 'grant-1', expiresAt: new Date(now.getTime() + 60_000), entitled: true }; } };
  const quotes = { quote: async command => ({ association: clone(command.association), callId: command.callId, sceneCode: command.sceneCode, model: 'model-1', quantity: { unit: 'tokens', value: 5 }, policies: [{ scopeId: 'tenant-scope-1', scopeKind: 'TENANT', sceneCode: command.sceneCode }, { scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: command.sceneCode }], consumerScope: { scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: command.sceneCode }, evidenceHash: 'a'.repeat(64), expiresAt: command.expiresAt }) };
  const evidence = { dispatch: async record => record.dispatched ? 'dispatched' : 'not_dispatched', usage: async () => ({ quantity: { unit: 'tokens', value: 4 }, evidenceHash: 'b'.repeat(64) }) };
  return { service: new BudgetService(repository, authority, quotes, evidence, () => now), repository };
}
function command() { return { association: clone(association), callId: 'call-1', sceneCode: 'rental.order.explain', expiresAt: new Date(now.getTime() + 30_000) }; }

test('quantity and settings reject zero/unconfigured as admission', () => {
  assert.equal(quantityAtoms({ unit: 'money', amount: '1.250000', currency: 'CNY', scale: 6 }), 1250000n);
  assert.throws(() => assertBudgetSettingsPermit({ ...settings, budget: { state: 'not_configured' } }, 'model-1', 'rental.order.explain'), BudgetError);
  assert.throws(() => validateBudgetSettings({ ...settings, budget: { state: 'zero', quantity: { unit: 'tokens', value: 1 } } }), BudgetError);
});

test('reserve is durable at the port, binds association and rejects changed idempotent payload', async () => {
  const { service } = harness();
  const first = await service.reserve(command());
  assert.equal(first.status, 'reserved');
  const replay = await service.reserve(command());
  assert.equal(replay.id, first.id);
  await assert.rejects(() => service.reserve({ ...command(), callId: 'call-other' }), (error) => error instanceof BudgetError && error.code === 'IDEMPOTENCY_CONFLICT');
});

test('unknown retains reservation and release is refused until reconciliation', async () => {
  const { service } = harness();
  const first = await service.reserve(command());
  await service.dispatch(first.id, association, 'dispatch-1');
  await service.markUnknown(first.id, association, 'unknown-1', 'provider_timeout');
  await assert.rejects(() => service.release(first.id, association, 'release-1'), (error) => error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION');
  const settled = await service.reconcile(first.id, association, 'reconcile-1', 'evidence-1');
  assert.equal(settled.status, 'settled');
});

test('authority change after reserve is rejected before mutation', async () => {
  const { service } = harness({ changing: true });
  const first = await service.reserve(command());
  await assert.rejects(() => service.dispatch(first.id, association, 'dispatch-1'), (error) => error instanceof BudgetError && error.code === 'FORBIDDEN');
});

