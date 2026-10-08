'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { createRequire } = require('node:module'), path = require('node:path');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const { Prisma } = apiRequire('@prisma/client');
const { InvocationAdmissionService } = require('../apps/api/src/modules/ai-native/invocation-admission.service');
const { PrismaAdmissionRepository } = require('../apps/api/src/modules/ai-native/invocation-admission.repository');
const now = new Date('2026-10-03T12:00:00Z');
const scope = { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'space-1' };
const input = () => ({ scope: structuredClone(scope), actorId: 'actor-1', callId: 'call-1', requestHash: 'a'.repeat(64), profileId: 'profile-1', expiresAt: new Date(now.getTime() + 60000) });
const row = () => ({ ...input(), id: 'admission-1', status: 'admitted', dispatchId: null, unknownReason: null, admittedAt: new Date(now), updatedAt: new Date(now), revokedAt: null, completedAt: null });
const unique = () => new Prisma.PrismaClientKnownRequestError('synthetic unique', { code: 'P2002', clientVersion: 'test' });
function setup() {
  const state = { rows: [row()], gets: 0, creates: 0, createError: null, now: new Date(now), onGet: null, onCreate: null };
  const repository = { get: async s => { state.gets++; if (state.onGet) await state.onGet(s); return state.rows[0] ? structuredClone(state.rows[0]) : null; },
    create: async value => { state.creates++; if (state.onCreate) await state.onCreate(value); if (state.createError) throw state.createError; return { ...row(), ...value, profileId: value.profileId ?? null }; }, transition: async () => null };
  return { state, repository, service: new InvocationAdmissionService(repository, () => new Date(state.now)) };
}
for (const [label, change] of [
  ['actor', r => { r.actorId = 'other'; }], ['callId', r => { r.callId = 'other'; }], ['request hash', r => { r.requestHash = 'b'.repeat(64); }],
  ['profile', r => { r.profileId = 'other'; }], ['scope id', r => { r.scope.id = 'other'; }], ['tenant', r => { r.scope.tenantId = 'other'; }],
  ['workspace', r => { r.scope.workspaceId = 'other'; }], ['scope kind', r => { r.scope.kind = 'TENANT'; }]
]) test(`existing admission with changed ${label} cannot be replayed`, async () => {
  const f = setup(); change(f.state.rows[0]); await assert.rejects(f.service.admit(input()), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.creates, 0);
});
for (const [label, change, code] of [
  ['expired', r => { r.expiresAt = now; }, 'INVALID_REQUEST'], ['revoked marker', r => { r.revokedAt = now; }, 'INVALID_REQUEST'],
  ['completed marker', r => { r.completedAt = now; }, 'INVALID_REQUEST'], ['dispatch already assigned', r => { r.dispatchId = 'dispatch-1'; }, 'INVALID_REQUEST'],
  ['unknown', r => { r.status = 'unknown'; }, 'ACCOUNTING_PENDING'], ['completed', r => { r.status = 'completed'; }, 'INVALID_REQUEST'],
  ['invalid status', r => { r.status = 'invented'; }, 'CONFIG_INVALID']
]) test(`${label} admission is never returned as reusable`, async () => {
  const f = setup(); change(f.state.rows[0]); await assert.rejects(f.service.admit(input()), e => e.code === code); assert.equal(f.state.creates, 0);
});
test('same identity replay preserves original expiry and returns an isolated value', async () => {
  const f = setup(), value = input(); value.expiresAt = new Date(now.getTime() + 120000);
  const result = await f.service.admit(value); assert.equal(result.expiresAt.getTime(), now.getTime() + 60000);
  result.scope.tenantId = 'mutated'; assert.equal(f.state.rows[0].scope.tenantId, 'tenant-1'); assert.equal(f.state.creates, 0);
});
test('unique race validates the winning actor, not only its hash', async () => {
  for (const actor of ['actor-1', 'other']) {
    const f = setup(); f.state.rows = []; f.state.createError = unique(); f.state.onCreate = () => { const r = row(); r.actorId = actor; f.state.rows = [r]; };
    if (actor === 'actor-1') assert.equal((await f.service.admit(input())).id, 'admission-1');
    else await assert.rejects(f.service.admit(input()), e => e.code === 'CONFIG_INVALID');
    assert.equal(f.state.creates, 1); assert.equal(f.state.gets, 2);
  }
});
test('ambiguous create failure is not retried or silently replaced by a winner read', async () => {
  const f = setup(); f.state.rows = []; f.state.createError = Error('synthetic sensitive connection info');
  await assert.rejects(f.service.admit(input()), e => e.code === 'CONFIG_INVALID' && !e.message.includes('sensitive'));
  assert.equal(f.state.creates, 1); assert.equal(f.state.gets, 1);
});
test('caller mutations while lookup is pending cannot change actor, scope or profile', async () => {
  const f = setup(), value = input(); f.state.onGet = () => { value.actorId = 'other'; value.scope.workspaceId = 'other'; value.profileId = 'other'; };
  assert.equal((await f.service.admit(value)).actorId, 'actor-1');
});
test('repository cannot mutate input scope while lookup is pending', async () => {
  const f = setup(); f.state.onGet = passed => { passed.tenantId = 'other'; };
  assert.equal((await f.service.admit(input())).scope.tenantId, 'tenant-1');
});
test('expiry during lookup blocks fresh creation', async () => {
  const f = setup(); f.state.rows = []; f.state.onGet = () => { f.state.now = new Date(now.getTime() + 60001); };
  await assert.rejects(f.service.admit(input()), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.creates, 0);
});
test('malformed request and unsupported platform/tenant storage fail before reads', async () => {
  for (const patch of [{ actorId: '' }, { callId: 'x'.repeat(129) }, { requestHash: '' }, { expiresAt: new Date(NaN) }, { expiresAt: now }, { approved: true },
    { scope: { id: 'platform', kind: 'PLATFORM' } }, { scope: { id: 'tenant', kind: 'TENANT', tenantId: 'tenant-1' } }]) {
    const f = setup(); await assert.rejects(f.service.admit({ ...input(), ...patch }), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.gets, 0);
  }
  assert.throws(() => new InvocationAdmissionService({}), e => e.code === 'CONFIG_INVALID');
});

function dbSetup() {
  const record = row(), { scope: _, ...fields } = record;
  const state = { row: { ...fields, tenantId: scope.tenantId, workspaceId: scope.workspaceId }, calls: [], scopeRow: { ...scope }, count: 1, failCommit: false };
  const scopes = { findFirst: async args => { state.calls.push(['scope', args]); return structuredClone(state.scopeRow); } };
  const matches = (r, where) => Object.entries(where).every(([k,v]) => v instanceof Date ? r[k]?.getTime() === v.getTime() : r[k] === v);
  const read = async (r, args) => { state.calls.push(['read', args]); return matches(r, args.where) ? structuredClone(r) : null; };
  const db = { aiScope: scopes, aiInvocationAdmission: { findFirst: args => read(state.row, args), create: async args => { state.calls.push(['create', args]); return { ...state.row, ...args.data }; } },
    $transaction: async (fn, options) => { state.calls.push(['transaction', options]); const w = structuredClone(state.row);
      const result = await fn({ aiScope: scopes, aiInvocationAdmission: { findFirst: args => read(w, args), updateMany: async args => {
        state.calls.push(['update', args]); if (state.count !== 1 || !matches(w, args.where)) return { count: state.count === 1 ? 0 : state.count };
        Object.assign(w, args.data); return { count: 1 }; } } });
      if (state.failCommit) throw Error('synthetic commit loss'); state.row = w; return result; }
  };
  return { state, repository: new PrismaAdmissionRepository(db) };
}
test('real Prisma adapter validates stored scope and preserves its ID instead of concatenation', async () => {
  const f = dbSetup(); const result = await f.repository.get(scope, 'call-1');
  assert.equal(result.scope.id, 'scope-1'); assert.equal(f.state.calls[0][1].where.kind, 'WORKSPACE');
  assert.deepEqual(f.state.calls[1][1].where, { tenantId: 'tenant-1', workspaceId: 'space-1', callId: 'call-1' });
  f.state.scopeRow.tenantId = 'other'; await assert.rejects(f.repository.get(scope, 'call-1'), e => e.code === 'CONFIG_INVALID');
});
test('malformed adapter scope never becomes an unfiltered query', async () => {
  const f = dbSetup(); await assert.rejects(f.repository.get({ id: 'x', kind: 'WORKSPACE' }, 'call-1'), e => e.code === 'INVALID_REQUEST');
  assert.equal(f.state.calls.length, 0);
});
test('adapter transition CAS and readback share one bounded transaction', async () => {
  const f = dbSetup(), result = await f.repository.transition(scope, 'call-1', 'admitted', 'cancelled');
  assert.equal(result.status, 'cancelled'); assert.ok(result.revokedAt instanceof Date);
  const update = f.state.calls.find(c => c[0] === 'update')[1];
  assert.equal(update.where.actorId, 'actor-1'); assert.equal(update.where.requestHash, 'a'.repeat(64)); assert.equal(update.where.id, 'admission-1');
  assert.equal(update.where.profileId, 'profile-1'); assert.equal(update.where.status, 'admitted');
  assert.deepEqual(f.state.calls[0][1], { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  assert.deepEqual(f.state.calls.map(c => c[0]), ['transaction', 'scope', 'read', 'update', 'read']);
});
test('adapter zero/duplicate matches and commit failure expose no successful transition', async () => {
  for (const count of [0, 2]) { const f = dbSetup(); f.state.count = count; await assert.rejects(f.repository.transition(scope, 'call-1', 'admitted', 'cancelled')); assert.equal(f.state.row.status, 'admitted'); }
  const f = dbSetup(); f.state.failCommit = true; await assert.rejects(f.repository.transition(scope, 'call-1', 'admitted', 'completed')); assert.equal(f.state.row.status, 'admitted');
});
test('adapter refuses arbitrary patch fields rather than spreading them into writes', async () => {
  const f = dbSetup(); await assert.rejects(f.repository.transition(scope, 'call-1', 'admitted', 'cancelled', { actorId: 'forged' }), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.calls.length, 0);
});
