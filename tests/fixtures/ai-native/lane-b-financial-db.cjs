'use strict';
const assert = require('node:assert/strict');
const h = require('./knowledge-service.cjs');
const { BudgetService } = require('../../../apps/api/src/modules/ai-native/budget/budget.service');
const { PrismaBudgetRepository } = require('../../../apps/api/src/modules/ai-native/budget/prisma-budget.repository');
// Database execution substitute only. There is no quota/permission/price
// calculation here; those are executed by the actual service and repository.
exports.fixture = () => {
  const now = new Date(h.now), expiresAt = new Date(h.now + 60000), ctx = h.context();
  const config = { configId: 'synthetic-config', configRevision: 1 };
  const policyKey = { scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: 'scene-1' };
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: h.scope.tenantId }, config,
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(key => [key, { enabled: true, revision: 1 }])),
    sceneCode: 'scene-1', allowedModels: ['synthetic-model'], allowedScenes: ['scene-1'],
    budget: { state: 'limited', quantity: { unit: 'tokens', value: 1 } }, maxConcurrent: 10, maxCallsPerRun: 10 };
  const policy = { id: 'policy-1', ...policyKey, configRevision: 1, settingsJson: settings };
  const control = { locks: 0, failAllocation: false, foreignPolicy: false, attemptedReservations: 0 };
  let state = { reservations: [], allocations: [] }, lockTail = Promise.resolve();
  const db = { $transaction: async callback => {
    let release, working;
    const tx = {
      aiBudgetPolicy: { findUnique: async () => structuredClone(policy) },
      aiScope: { findUnique: async () => ({ id: policyKey.scopeId, kind: 'WORKSPACE', tenantId: control.foreignPolicy ? 'foreign-tenant' : h.scope.tenantId, workspaceId: h.scope.workspaceId }) },
      $queryRaw: async sql => {
        assert.match(sql.sql, /FOR UPDATE/); assert.equal(release, undefined);
        const previous = lockTail; lockTail = new Promise(resolve => { release = resolve; });
        await previous; control.locks++; working = structuredClone(state);
        return [{ id: policy.id }];
      },
      aiBudgetAllocation: {
        findMany: async input => { assert.ok(working, 'actual adapter must lock before reading allocations'); return working.allocations.filter(row => row.policyId === input.where.policyId).map(row => ({ reservation: structuredClone(working.reservations.find(reservation => reservation.id === row.reservationId)) })); },
        createMany: async input => { if (control.failAllocation) throw Error('synthetic allocation write failure'); working.allocations.push(...structuredClone(input.data)); return { count: input.data.length }; },
      },
      aiBudgetReservation: { create: async ({ data }) => {
        control.attemptedReservations++;
        const row = { reservedTokens: null, reservedCalls: null, reservedMoney: null, actualTokens: null, actualCalls: null, actualMoney: null, moneyCurrency: null, unknownReason: null, updatedAt: now, ...data };
        working.reservations.push(structuredClone(row)); return structuredClone(row);
      } },
    };
    try { const result = await callback(tx); state = working; return result; }
    finally { release?.(); }
  } };
  const repository = new PrismaBudgetRepository(db);
  const authority = { resolve: async (action, resource) => {
    if (action !== 'reserve' || JSON.stringify(resource.association?.scope) !== JSON.stringify(ctx.scope)) throw Error('synthetic denied');
    return { context: structuredClone(ctx), authorizationKey: 'synthetic-current-grant', entitled: true, expiresAt };
  } };
  const quotes = { quote: async command => ({ ...structuredClone(command), model: 'synthetic-model', actorId: ctx.actor.userId,
    quantity: { unit: 'tokens', value: 1 }, policies: [policyKey], consumerScope: policyKey, evidenceHash: 'a'.repeat(64) }) };
  const unavailable = async () => { throw Error('not configured for this reservation-only test'); };
  return { control, rows: () => structuredClone(state), networkAttempts: () => h.attempts,
    service: new BudgetService(repository, authority, quotes, { dispatch: unavailable, usage: unavailable }, () => now),
    command: suffix => ({ callId: `call-${suffix}`, sceneCode: 'scene-1', expiresAt,
      association: { requestId: `request-${suffix}`, runId: `run-${suffix}`, stepId: `step-${suffix}`, actionId: `action-${suffix}`,
        idempotencyKey: `key-${suffix}`, priceVersion: 'price-1', scope: structuredClone(h.scope), config } }) };
};
