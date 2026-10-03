'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { InvocationAdmissionService } = require('../apps/api/src/modules/ai-native/invocation-admission.service');
const { UsageAccountingService } = require('../apps/api/src/modules/ai-native/usage-accounting.service');
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const scope = { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'space-a' };
// Default mode is a characterization run, NOT security acceptance. Set the
// strict flag to execute the intended requirements and obtain failing evidence.
const strict = process.argv.includes('--strict-b03') || process.env.AIN_B03_STRICT === '1';
function gap(name, body) { test(name, strict ? {} : { todo: 'KNOWN GAP: awaiting coordinator production patch' }, body); }

test('W01 migration must create referenced tables before adding their foreign keys', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261003160000_ai_provider_profiles/migration.sql'), 'utf8');
  const local = new Set([...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map(match => match[1]));
  const created = new Set();
  for (const match of sql.matchAll(/CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\) DEFAULT CHARACTER SET/g)) {
    for (const reference of match[2].matchAll(/REFERENCES `([^`]+)`/g)) {
      assert.ok(!local.has(reference[1]) || created.has(reference[1]) || reference[1] === match[1], `${match[1]} references ${reference[1]} before creation`);
    }
    created.add(match[1]);
  }
});
test('W05 duplicate callId with another actor must be rejected', async () => {
  const existing = { id: 'admission-a', scope, actorId: 'actor-a', callId: 'call-a', requestHash: 'hash-a', status: 'admitted', expiresAt: new Date(Date.now() + 60_000), profileId: null, dispatchId: null, unknownReason: null, admittedAt: new Date(), updatedAt: new Date(), revokedAt: null, completedAt: null };
  const service = new InvocationAdmissionService({ get: async () => existing, create: async () => { throw new Error('unexpected create'); }, transition: async () => null });
  assert.equal((await service.admit({ scope, actorId: 'actor-a', callId: 'call-a', requestHash: 'hash-a', expiresAt: existing.expiresAt })).id, existing.id);
  await assert.rejects(service.admit({ scope, actorId: 'actor-b', callId: 'call-a', requestHash: 'hash-a', expiresAt: existing.expiresAt }));
});
test('W07 settlement must select the requested reservation, not the first scope row', async () => {
  const rows = [{ id: 'usage-a', status: 'reserved' }, { id: 'usage-b', status: 'reserved' }];
  const reads = [];
  const service = new UsageAccountingService({ get: async (_scope, key) => { reads.push(key); return rows.find(row => row.id === key.id) ?? rows[0]; }, reserve: async () => { throw new Error('unused'); }, transition: async (_scope, id) => rows.find(row => row.id === id), appendLedger: async () => {} });
  const result = await service.settle(scope, 'usage-b', 'event-b', 1, 2);
  assert.equal(result.id, 'usage-b');
  assert.ok(reads.every(key => key.id === 'usage-b'));
});
function ports() {
  const events = [];
  return { events, ports: {
    router: { resolve: async () => { events.push('router'); return { profile: { id: 'profile-a' } }; } },
    admission: { admit: async () => { events.push('admit'); return { id: 'admission-a', scope }; }, transition: async () => { events.push('transition'); } },
    usage: { reserve: async () => { events.push('reserve'); return { id: 'usage-a' }; }, settle: async () => { events.push('settle'); }, markUnknown: async () => { events.push('unknown'); } },
    audit: { append: async () => { events.push('audit'); } },
    transport: { invoke: async () => { events.push('invoke'); return { text: 'synthetic', usage: { inputTokens: 1, outputTokens: 2 } }; }, stream: async function* () { events.push('stream'); yield { kind: 'result', result: { text: 'synthetic', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  } };
}
const context = { tenantId: 'tenant-a', workspaceId: 'space-a', actorId: 'actor-a' };
const request = { callId: 'call-a', model: 'synthetic-model', messages: [{ role: 'user', content: 'synthetic' }], maxOutputTokens: 4 };
test('W08 pre-aborted invocation must never dispatch', async () => {
  const h = ports(), controller = new AbortController(); controller.abort();
  await assert.rejects(new UnifiedAiGatewayService(h.ports, 100).invoke(context, request, controller.signal));
  assert.equal(h.events.includes('invoke'), false);
});
test('W09 stream must pass admission, reserve, audit and settlement', async () => {
  const h = ports(); for await (const _event of new UnifiedAiGatewayService(h.ports, 100).stream(context, request)) { /* drain */ }
  for (const event of ['admit', 'reserve', 'audit', 'settle']) assert.ok(h.events.includes(event), `${event} was bypassed`);
});
