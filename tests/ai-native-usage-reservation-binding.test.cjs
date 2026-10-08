'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { createRequire } = require('node:module'), path = require('node:path');
const { Prisma } = createRequire(path.resolve(__dirname, '../apps/api/package.json'))('@prisma/client');
const { UsageAccountingService } = require('../apps/api/src/modules/ai-native/usage-accounting.service');
const scope = { id: 'scope-usage', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'space-1' };
const input = () => ({ scope: { ...scope }, callId: 'call-1', idempotencyKey: 'key-1', reservedUnits: 20, expiresAt: new Date(Date.now() + 60000) });
const row = () => ({ ...input(), id: 'usage-1', status: 'reserved', actualInput: null, actualOutput: null, unknownReason: null });
function setup() {
  const state = { existing: null, gets: 0, reserves: 0, error: null, created: null, beforeGet: null, beforeReserve: null };
  const repository = {
    get: async () => { state.gets++; if (state.beforeGet) await state.beforeGet(); return state.existing; },
    reserve: async value => { state.reserves++; if (state.beforeReserve) await state.beforeReserve(value); if (state.error) throw state.error; return state.created ?? { ...row(), ...structuredClone(value) }; },
    transition: async () => null, commitUsage: async () => { throw Error('not used'); }
  };
  return { state, repository, service: new UsageAccountingService(repository) };
}
for (const [label, change] of [
  ['units', r => { r.reservedUnits++; }], ['scope id', r => { r.scope.id = 'other'; }],
  ['tenant', r => { r.scope.tenantId = 'other'; }], ['workspace', r => { r.scope.workspaceId = 'other'; }],
  ['scope kind', r => { r.scope.kind = 'TENANT'; }], ['key', r => { r.idempotencyKey = 'other'; }],
  ['call id', r => { r.callId = 'other'; }], ['expired', r => { r.expiresAt = new Date(0); }],
  ['settlement already present', r => { r.actualInput = 0; }], ['unknown reason', r => { r.unknownReason = 'lost'; }]
]) test(`reservation replay rejects different or stale ${label}`, async () => {
  const f = setup(); f.state.existing = row(); change(f.state.existing);
  await assert.rejects(f.service.reserve(input())); assert.equal(f.state.reserves, 0);
});
for (const error of [new Error('commit acknowledgement lost'), new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: '5.22.0' })]) test('uncertain write never resolves as success by reading a committed row', async () => {
  const f = setup(); f.state.error = error; f.state.beforeReserve = async value => { f.state.existing = { ...row(), ...value }; };
  await assert.rejects(f.service.reserve(input()), e => e.code === 'ACCOUNTING_PENDING'); assert.equal(f.state.gets, 1); assert.equal(f.state.reserves, 1);
});
test('only definite uniqueness failure can validate the fully bound winner', async () => {
  const f = setup(); f.state.error = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
  f.state.beforeReserve = async value => { f.state.existing = { ...row(), ...value }; };
  assert.equal((await f.service.reserve(input())).id, 'usage-1'); assert.equal(f.state.gets, 2); assert.equal(f.state.reserves, 1);
});
test('uniqueness winner with a changed reservation amount is still refused', async () => {
  const f = setup(); f.state.error = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
  f.state.beforeReserve = async value => { f.state.existing = { ...row(), ...value, reservedUnits: value.reservedUnits + 1 }; };
  await assert.rejects(f.service.reserve(input())); assert.equal(f.state.reserves, 1);
});
for (const value of [null, {}, { ...input(), scope: { kind: 'PLATFORM', id: 'platform' } }, { ...input(), reservedUnits: 4294967296 }, { ...input(), expiresAt: new Date(NaN) }]) test('malformed reservation is refused before repository access', async () => {
  const f = setup(); await assert.rejects(f.service.reserve(value), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.gets, 0); assert.equal(f.state.reserves, 0);
});
test('request snapshots prevent caller mutation across initial lookup', async () => {
  const f = setup(), value = input(); let release, entered;
  const ready = new Promise(r => { entered = r; });
  f.state.beforeGet = () => new Promise(r => { release = r; entered(); });
  const pending = f.service.reserve(value); await ready;
  value.reservedUnits = 1; value.scope.tenantId = 'other'; value.callId = 'other'; release();
  const out = await pending; assert.equal(out.reservedUnits, 20); assert.equal(out.scope.tenantId, 'tenant-1'); assert.equal(out.callId, 'call-1');
});
test('repository mutation cannot replace the expected binding or escape into returned state', async () => {
  const f = setup(); f.state.beforeReserve = async value => { value.reservedUnits = 1; };
  await assert.rejects(f.service.reserve(input()));
  const g = setup(); g.state.existing = row(); const result = await g.service.reserve(input()); result.scope.tenantId = 'changed';
  assert.equal(g.state.existing.scope.tenantId, 'tenant-1');
});
test('expiry during repository write is not returned as reusable admission', async () => {
  const f = setup(); f.state.created = row(); f.state.created.expiresAt = new Date(0);
  await assert.rejects(f.service.reserve(input())); assert.equal(f.state.reserves, 1);
});
test('unknown reservation is explicitly pending reconciliation', async () => {
  const f = setup(); f.state.existing = { ...row(), status: 'unknown', unknownReason: 'lost' };
  await assert.rejects(f.service.reserve(input()), e => e.code === 'ACCOUNTING_PENDING'); assert.equal(f.state.reserves, 0);
});
