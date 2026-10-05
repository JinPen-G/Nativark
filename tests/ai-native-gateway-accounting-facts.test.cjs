'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaGatewayAccountingFacts } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const time = new Date('2026-10-05T12:00:00Z');
const config = { configId: 'profile', configRevision: 1, credentialRef: 'vault', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', serviceMode: 'tenant_managed', tenantId: 'tenant', configurationScope: { kind: 'tenant', tenantId: 'tenant' } };
const association = { requestId: 'call', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', priceVersion: 'price', scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config };
const call = { context: { actorId: 'actor', tenantId: 'tenant', workspaceId: 'workspace' }, binding: { id: 'admission', actorId: 'actor', callId: 'call', requestHash: 'a'.repeat(64), profileId: 'profile', dispatchId: 'dispatch', scope: { id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace' } }, request: { callId: 'call', model: 'model', maxOutputTokens: 32, intentHash: 'b'.repeat(64) }, expiresAt: new Date(time.getTime() + 60000) };

function harness() {
  const state = { revoked: false, writes: 0, fail: null, onRead: null, pricing: null, rows: {
    aiGatewayInvocation: { id: 'invocation', scopeId: 'scope', taskId: 'task', actorId: 'actor', callId: 'call', runId: 'run', stepId: 'step', actionId: 'action', sceneCode: 'scene', priceVersion: 'price', configuration: config, configurationHash: requestFingerprint(config), intentHash: call.request.intentHash, maxOutputTokens: 32 },
    aiBudgetReservation: { id: 'reservation', scopeId: 'scope', scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace', actorId: 'actor', callId: 'call', requestId: 'call', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', sceneCode: 'scene', priceVersion: 'price', configRevision: 1, configurationHash: requestFingerprint(config), status: 'reserved', dispatchState: 'dispatched', reservedTokens: 32n, reservedCalls: null, reservedMoney: null, actualTokens: null, actualCalls: null, actualMoney: null, moneyCurrency: null, unknownReason: null, expiresAt: call.expiresAt, updatedAt: time },
    aiInvocationAdmission: { id: 'admission', tenantId: 'tenant', workspaceId: 'workspace', actorId: 'actor', callId: 'call', requestHash: call.binding.requestHash, profileId: 'profile', dispatchId: 'dispatch' },
    aiGatewayAccountingReceipt: { id: 'receipt', invocationId: 'invocation', admissionId: 'admission', reservationId: 'reservation', taskId: 'task', scopeId: 'scope', scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace', dispatchToken: 'dispatch', requestHash: call.binding.requestHash, state: 'dispatched', usageHash: null, inputTokens: null, outputTokens: null }
  } };
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
  function delegates(rows) {
    return Object.fromEntries(Object.keys(rows).map(name => [name, {
      findUnique: async ({ where }) => { state.onRead?.(name); return matches(rows[name], where) ? structuredClone(rows[name]) : null; },
      updateMany: async ({ where, data }) => {
        if (!matches(rows[name], where)) return { count: 0 };
        state.writes++; Object.assign(rows[name], structuredClone(data));
        if (state.fail === 'write') throw Error('synthetic write failure');
        return { count: 1 };
      }
    }]));
  }
  const db = Object.fromEntries(Object.keys(state.rows).map(name => [name, Object.fromEntries(['findUnique', 'updateMany'].map(method => [method, args => delegates(state.rows)[name][method](args)]))]));
  db.$transaction = async fn => {
    const rows = structuredClone(state.rows), result = await fn(delegates(rows));
    if (state.fail === 'commit') throw Error('synthetic rollback');
    state.rows = rows;
    if (state.fail === 'ack') throw Error('synthetic lost commit acknowledgement');
    return result;
  };
  const bindings = { resolveForReserve: async () => ({ actorId: 'actor', association, sceneCode: 'scene', expiresAt: call.expiresAt }), resolveForReservation: async () => {
    if (state.revoked) throw Error('revoked');
    return { actorId: 'actor', association: structuredClone(association), sceneCode: 'scene', expiresAt: call.expiresAt };
  } };
  const scopes = { resolveCurrent: async () => {
    if (state.revoked) throw Error('revoked');
    return { context: { actor: { kind: 'user', userId: 'actor' }, scope: association.scope } };
  } };
  const source = () => new PrismaGatewayAccountingFacts(db, bindings, scopes, { quantity: async (record, usage) => {
    state.pricing?.(record);
    return { unit: 'tokens', value: usage.inputTokens + usage.outputTokens };
  } }, () => time);
  return { state, source };
}

test('actual accounting repository persists usage, replays it after recreation and rejects altered usage', async () => {
  const h = harness();
  assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
  assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
  assert.equal(h.state.writes, 1);
  assert.equal((await h.source().readUsage('reservation', 'receipt', false)).quantity.value, 3);
  await assert.rejects(h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 3 }), e => e.code === 'IDEMPOTENCY_CONFLICT');
});
for (const fail of ['write', 'commit', 'ack']) test(`actual accounting transaction ${fail} failure retains accurate persisted state`, async () => {
  const h = harness(); h.state.fail = fail;
  await assert.rejects(h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }));
  assert.equal(h.state.rows.aiGatewayAccountingReceipt.inputTokens, fail === 'ack' ? 1n : null);
  h.state.fail = null;
  if (fail === 'ack') assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
});
test('dispatch evidence rechecks authorization after repository reads', async () => {
  const h = harness(); h.state.onRead = () => { h.state.revoked = true; };
  await assert.rejects(h.source().readDispatch('reservation'));
});
test('usage pricing cannot mutate the stored association used in returned evidence', async () => {
  const h = harness(); await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 });
  h.state.pricing = record => { record.association.priceVersion = 'forged-price'; };
  const evidence = await h.source().readUsage('reservation', 'receipt', false);
  assert.equal(evidence.evidenceHash, requestFingerprint({ usageHash: h.state.rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'tokens', value: 3 } }));
});
test('linked price binding cannot change while asynchronous pricing resolves', async () => {
  const h = harness(); await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 });
  h.state.pricing = () => { h.state.rows.aiGatewayInvocation.priceVersion = 'changed'; h.state.rows.aiBudgetReservation.priceVersion = 'changed'; };
  await assert.rejects(h.source().readUsage('reservation', 'receipt', false));
});
