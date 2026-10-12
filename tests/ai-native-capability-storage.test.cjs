'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaProviderCapabilityEvidenceRepository } = require('../apps/api/src/modules/ai-native/provider-capability.repository');
const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
const { capabilityProfileFingerprint, capabilityNameSchema } = require('../apps/api/src/modules/ai-native/capability-verification');
const profile = { id: 'synthetic-profile', scopeId: 'synthetic-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
  serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic/model', credentialRef: 'synthetic-vault',
  configRevision: 2, enabled: true, disabledAt: null, allowedCapabilities: ['text'] };
const input = { profile, capability: 'text', status: 'unverified', source: 'connection_test', evidenceHash: 'synthetic-hash',
  checkedAt: new Date('2026-10-05T00:00:00Z'), expiresAt: new Date('2026-10-05T00:01:00Z') };
const clone = structuredClone;
function harness() {
  const state = { profile: clone(profile), rows: [], fail: null, writes: 0, beforeLock: null };
  const matches = (row, where) => row && Object.entries(where).every(([k, v]) => row[k] === v);
  const delegates = target => ({
    aiProviderProfile: { updateMany: async args => { if (state.beforeLock) await state.beforeLock(target); if (!matches(target.profile, args.where)) return { count: 0 }; return { count: 1 }; },
      findFirst: async args => matches(target.profile, args.where) ? clone(target.profile) : null },
    aiProviderCapabilityEvidence: {
      findMany: async args => clone(target.rows.filter(row => matches(row, args.where))),
      findUnique: async args => clone(target.rows.find(row => matches(row, args.where.profileId_capability)) ?? null),
      upsert: async args => {
        state.writes++; if (state.fail === 'write') throw Error('synthetic write failure');
        let row = target.rows.find(row => matches(row, args.where.profileId_capability));
        const data = Object.fromEntries(Object.entries(row ? args.update : args.create).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === Prisma.DbNull ? null : clone(v)]));
        if (row) Object.assign(row, data); else { row = data; target.rows.push(row); } return clone(row);
      }
    }
  });
  let tail = Promise.resolve();
  const db = { ...delegates(state), $transaction: operation => {
    const pending = tail.then(async () => {
      const draft = { profile: clone(state.profile), rows: clone(state.rows) };
      const result = await operation(delegates(draft));
      if (state.fail === 'commit') throw Error('synthetic rollback');
      state.rows = draft.rows;
      if (state.fail === 'ack') throw Error('synthetic committed response lost');
      return result;
    }); tail = pending.catch(() => {}); return pending;
  } };
  return { state, db, repository: () => new PrismaProviderCapabilityEvidenceRepository(db) };
}
test('all declared capabilities including audio round-trip without granting unverified support', async () => {
  const h = harness(), current = { ...profile, allowedCapabilities: [...capabilityNameSchema.options] };
  h.state.profile = clone(current);
  const repository = h.repository();
  for (const capability of current.allowedCapabilities) await repository.upsert({ ...input, profile: current, capability });
  assert.deepEqual((await repository.list(current)).map(row => row.capability).sort(), [...current.allowedCapabilities].sort());
  const service = new ProviderCapabilityService(repository, {}, () => new Date('2026-10-05T00:00:30Z'));
  const preflight = await service.preflight(current, current.allowedCapabilities);
  assert.equal(preflight.allowed, false);
  assert.deepEqual([...preflight.missing].sort(), [...current.allowedCapabilities].sort());
  h.state.rows.push(clone(h.state.rows[0]));
  await assert.rejects(repository.list(current));
});
test('older evidence cannot overwrite a newer revision or a newer probe on the current revision', async () => {
  const h = harness(); await h.repository().upsert(input);
  await assert.rejects(h.repository().upsert({ ...input, profile: { ...profile, configRevision: 1 } }));
  await assert.rejects(h.repository().upsert({ ...input, checkedAt: new Date('2026-10-04T23:59:00Z') }));
  assert.equal(h.state.rows[0].observedRevision, 2); assert.deepEqual(h.state.rows[0].checkedAt, input.checkedAt);
});
test('missing details replaces rather than retains an older verification proof', async () => {
  const h = harness(); await h.repository().upsert({ ...input, details: { verification: { evidence: 'synthetic-old-proof' } } });
  await h.repository().upsert({ ...input, checkedAt: new Date('2026-10-05T00:00:01Z') });
  assert.equal(h.state.rows[0].details, null);
});

test('same instant and identical measurement is idempotent; any content change conflicts', async () => {
  for (const details of [undefined, { verification: { evidence: 'synthetic-only' } }]) {
    const h = harness(); const value = { ...input, details };
    const first = await h.repository().upsert(value);
    assert.deepEqual(await h.repository().upsert(clone(value)), first); assert.equal(h.state.writes, 1);
    for (const change of [{ evidenceHash: 'changed' }, { status: 'supported' }, { source: 'manual' }, { expiresAt: null }, { details: { different: true } }]) {
      await assert.rejects(h.repository().upsert({ ...value, ...change }));
    }
    assert.equal(h.state.writes, 1);
  }
});

test('current profile scope, credentials, model, policy and disabled state fence a stored probe', async () => {
  for (const changed of [{ scopeId: 'other' }, { scopeKind: 'PLATFORM' }, { credentialRef: 'other-vault' },
    { model: 'synthetic/changed' }, { allowedCapabilities: [] }, { enabled: false }, { disabledAt: new Date() }]) {
    const h = harness(); Object.assign(h.state.profile, changed);
    await assert.rejects(h.repository().upsert(input)); assert.equal(h.state.rows.length, 0);
  }
  const h = harness(); h.state.beforeLock = async target => { target.profile.configRevision = 3; };
  await assert.rejects(h.repository().upsert(input)); assert.equal(h.state.writes, 0);
});

test('competing probe timestamps cannot let an older result overwrite a later completed probe', async () => {
  const h = harness(); const newer = { ...input, checkedAt: new Date('2026-10-05T00:00:02Z'), evidenceHash: 'newer' };
  const result = await Promise.allSettled([h.repository().upsert(newer), h.repository().upsert(input)]);
  assert.deepEqual(result.map(row => row.status), ['fulfilled', 'rejected']);
  assert.equal(h.state.rows[0].evidenceHash, 'newer');
});

test('transaction write and commit failure roll back; lost acknowledgement is reread rather than blind write retry', async () => {
  for (const failure of ['write', 'commit']) {
    const h = harness(); h.state.fail = failure;
    await assert.rejects(h.repository().upsert(input)); assert.equal(h.state.rows.length, 0); assert.equal(h.state.writes, 1);
  }
  const h = harness(); h.state.fail = 'ack'; await assert.rejects(h.repository().upsert(input));
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.writes, 1); h.state.fail = null;
  assert.equal((await h.repository().list(profile))[0].observedRevision, 2);
  await h.repository().upsert(input); assert.equal(h.state.writes, 1);
});

test('column limits, malformed inputs and non-JSON or oversized details fail before any storage write', async () => {
  const h = harness();
  for (const value of [{ ...input, profile: { ...profile, id: 'x'.repeat(37) } }, { ...input, capability: 'unknown' },
    { ...input, profile: { ...profile, enabled: false } }, { ...input, profile: { ...profile, disabledAt: input.checkedAt } },
    { ...input, evidenceHash: 'x'.repeat(129) }, { ...input, expiresAt: input.checkedAt },
    { ...input, profile: { ...profile, configRevision: 4294967296 } }, { ...input, caller: 'forged' },
    { ...input, details: { large: 'x'.repeat(32769) } }, { ...input, details: { invalid: NaN } }]) {
    await assert.rejects(h.repository().upsert(value));
  }
  assert.equal(h.state.writes, 0); assert.equal(h.state.rows.length, 0);
});

test('actual capability service and persistent adapter keep mock/live separate and invalidate changed revision', async () => {
  const h = harness(), clock = () => new Date('2026-10-05T00:00:20Z');
  const service = new ProviderCapabilityService(h.repository(), { allowMock: true }, clock);
  const proof = { evidence: 'mock', methodVersion: 'synthetic-test-v1', capability: 'text', profileFingerprint: capabilityProfileFingerprint(profile) };
  await service.record({ ...input, status: 'supported', details: { verification: proof } });
  assert.equal((await service.preflight(profile, ['text'])).allowed, true);
  assert.equal((await new ProviderCapabilityService(h.repository(), {}, clock).preflight(profile, ['text'])).allowed, false);
  h.state.profile.configRevision = 3;
  const stale = await service.preflight(clone(h.state.profile), ['text']);
  assert.equal(stale.allowed, false); assert.deepEqual(stale.stale, ['text']);
  await assert.rejects(service.record({ ...input, status: 'supported', details: { verification: proof } }));
});

test('input objects cannot be mutated into another destination while Profile lock awaits', async () => {
  const h = harness(), value = clone(input);
  h.state.beforeLock = async () => { value.profile.scopeId = 'forged'; value.profile.model = 'forged'; value.evidenceHash = 'forged'; };
  const saved = await h.repository().upsert(value);
  assert.equal(saved.scope.id, profile.scopeId); assert.equal(saved.evidenceHash, input.evidenceHash);
});

test('read projection rejects corrupt enums, invalid dates, owner mismatch and duplicate capability', async () => {
  for (const change of [row => { row.status = 'invented'; }, row => { row.checkedAt = new Date(NaN); },
    row => { row.details = 'not-an-object'; }]) {
    const h = harness(); await h.repository().upsert(input); change(h.state.rows[0]);
    await assert.rejects(h.repository().list(profile));
  }
  const h = harness(); await h.repository().upsert(input); h.state.rows.push(clone(h.state.rows[0]));
  await assert.rejects(h.repository().list(profile));
});
