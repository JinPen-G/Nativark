'use strict';
const assert = require('node:assert/strict');
const h = require('./knowledge-service.cjs');
const { load } = require('./rental-compatibility-source.cjs');
const { BudgetService } = load('@rental-os/ai-native-server/runtime/budget/budget.service');
const { PrismaBudgetRepository } = load('@rental-os/ai-native-server/runtime/budget/prisma-budget.repository');
// Database execution substitute only. There is no quota/permission/price
// calculation here; those are executed by the actual service and repository.
exports.fixture = () => {
  const now = new Date(h.now), expiresAt = new Date(h.now + 60000), ctx = h.context();
  const config = { configId: 'synthetic-config', configRevision: 1, credentialRef: 'synthetic-vault',
    protocol: 'openai-compatible', provider: 'synthetic', model: 'synthetic-model', tenantId: h.scope.tenantId,
    serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: h.scope.tenantId } };
  const policyKey = { scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: 'scene-1' };
  const policyKeys = [
    { scopeId: 'scope-platform', scopeKind: 'PLATFORM', sceneCode: 'scene-1' },
    { scopeId: 'scope-tenant', scopeKind: 'TENANT', sceneCode: 'scene-1' }, policyKey
  ];
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: h.scope.tenantId }, config,
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(key => [key, { enabled: true, revision: 1 }])),
    sceneCode: 'scene-1', allowedModels: ['synthetic-model'], allowedScenes: ['scene-1'],
    budget: { state: 'limited', quantity: { unit: 'tokens', value: 1 } }, maxConcurrent: 10, maxCallsPerRun: 10 };
  const policies = policyKeys.map(key => ({ id: `policy-${key.scopeKind.toLowerCase()}`, ...key,
    configRevision: 1, settingsJson: { ...settings, scope: key.scopeKind === 'PLATFORM' ? { kind: 'platform' } : settings.scope } }));
  const control = { locks: 0, failAllocation: false, foreignPolicy: false, attemptedReservations: 0 };
  let state = { reservations: [], allocations: [] }, lockTail = Promise.resolve();
  const db = { $transaction: async callback => {
    let release, working;
    const reservations = where => {
      assert.ok(working, 'actual adapter must lock before aggregating reservations');
      return working.reservations.filter(row => where.status.in.includes(row.status)
        && (where.runId === undefined || row.runId === where.runId)
        && working.allocations.some(link => link.reservationId === row.id && link.policyId === where.allocations.some.policyId));
    };
    const tx = {
      aiBudgetPolicy: { findUnique: async ({ where }) => {
        const key = where.scopeId_scopeKind_sceneCode ?? where;
        return structuredClone(policies.find(row => Object.entries(key).every(([field, value]) => row[field] === value)) ?? null);
      } },
      aiScope: { findUnique: async ({ where }) => {
        const key = policyKeys.find(row => row.scopeId === where.id);
        return key ? { id: key.scopeId, kind: key.scopeKind,
          tenantId: key.scopeKind === 'PLATFORM' ? null : control.foreignPolicy && key.scopeKind === 'WORKSPACE' ? 'foreign-tenant' : h.scope.tenantId,
          workspaceId: key.scopeKind === 'WORKSPACE' ? h.scope.workspaceId : null } : null;
      } },
      $queryRaw: async sql => {
        assert.match(sql.sql, /FOR UPDATE/);
        const rows = /FROM ai_scopes/.test(sql.sql) ? policyKeys.map(key => ({ id: key.scopeId })) : policies;
        assert.match(sql.sql, /FROM ai_(scopes|budget_policies) WHERE id = \? FOR UPDATE/);
        const row = rows.find(item => item.id === sql.values[0]); assert.ok(row);
        // One queue lease represents this transaction's ordered row locks.
        if (!release) {
          const previous = lockTail; lockTail = new Promise(resolve => { release = resolve; });
          await previous; control.locks++; working = structuredClone(state);
        }
        return [{ id: row.id }];
      },
      aiBudgetAllocation: {
        findMany: async input => { assert.ok(working, 'actual adapter must lock before reading allocations'); return working.allocations.filter(row => row.policyId === input.where.policyId).map(row => ({ reservation: structuredClone(working.reservations.find(reservation => reservation.id === row.reservationId)) })); },
        createMany: async input => { if (control.failAllocation) throw Error('synthetic allocation write failure'); working.allocations.push(...structuredClone(input.data)); return { count: input.data.length }; },
      },
      aiBudgetReservation: {
        findUnique: async ({ where }) => {
          const key = where.scopeId_scopeKind_idempotencyKey;
          return structuredClone(working.reservations.find(row => Object.entries(key).every(([field, value]) => row[field] === value)) ?? null);
        },
        groupBy: async ({ where, by, _count, _sum, take }) => {
          const groups = new Map();
          for (const row of reservations(where)) {
            const key = JSON.stringify(by.map(field => row[field]));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
          }
          return [...groups.values()].slice(0, take).map(rows => ({
            ...Object.fromEntries(by.map(field => [field, rows[0][field]])),
            _count: Object.fromEntries(Object.keys(_count).map(field => [field, field === '_all' ? rows.length : rows.filter(row => row[field] !== null).length])),
            _sum: Object.fromEntries(Object.keys(_sum).map(field => {
              const values = rows.map(row => row[field]).filter(value => value !== null);
              return [field, values.length ? values.reduce((sum, value) => sum + value) : null];
            }))
          }));
        },
        count: async ({ where }) => reservations(where).length,
        create: async ({ data }) => {
        control.attemptedReservations++;
        const row = { reservedTokens: null, reservedCalls: null, reservedMoney: null, actualTokens: null, actualCalls: null, actualMoney: null, moneyCurrency: null, unknownReason: null, updatedAt: now, ...data };
        working.reservations.push(structuredClone(row)); return structuredClone(row);
      } },
    };
    try { const result = await callback(tx); state = working; return result; }
    finally { release?.(); }
  } };
  const repository = new PrismaBudgetRepository(db, () => now);
  const authority = { resolve: async (action, resource) => {
    if (action !== 'reserve' || JSON.stringify(resource.association?.scope) !== JSON.stringify(ctx.scope)) throw Error('synthetic denied');
    return { context: structuredClone(ctx), authorizationKey: 'synthetic-current-grant', entitled: true, expiresAt };
  } };
  const quotes = { quote: async command => ({ ...structuredClone(command), model: 'synthetic-model', actorId: ctx.actor.userId,
    quantity: { unit: 'tokens', value: 1 }, policies: policyKeys, consumerScope: policyKey, evidenceHash: 'a'.repeat(64) }) };
  const unavailable = async () => { throw Error('not configured for this reservation-only test'); };
  return { control, rows: () => structuredClone(state), networkAttempts: () => h.attempts,
    service: new BudgetService(repository, authority, quotes, { dispatch: unavailable, usage: unavailable }, () => now),
    command: suffix => ({ callId: `call-${suffix}`, sceneCode: 'scene-1', expiresAt,
      association: { requestId: `request-${suffix}`, runId: `run-${suffix}`, stepId: `step-${suffix}`, actionId: `action-${suffix}`,
        idempotencyKey: `key-${suffix}`, priceVersion: 'price-1', scope: structuredClone(h.scope), config } }) };
};
