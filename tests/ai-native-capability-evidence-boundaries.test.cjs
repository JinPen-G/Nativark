'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
const now = new Date('2026-10-04T00:00:00Z');
const profile = { id: 'p', scopeId: 's', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT', serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'm', credentialRef: 'vault:x', configRevision: 2, enabled: true, disabledAt: null, allowedCapabilities: ['text','tools'] };
const row = () => ({ id: 'e', profileId: 'p', scope: { id: 's', kind: 'TENANT' }, capability: 'tools', status: 'supported', source: 'connection_test', observedRevision: 2,
  evidenceHash: 'synthetic', checkedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 60000),
  details: { verification: { evidence: 'mock', methodVersion: 'synthetic-tools-1', capability: 'tools', profileFingerprint: capabilityProfileFingerprint(profile) } } });
function setup(allowMock = false, liveEvidenceVerifier) {
  const state = { rows: [row()], writes: [], calls: 0 }, options = { allowMock, liveEvidenceVerifier };
  const repo = { list: async () => { state.calls++; return state.rows; }, upsert: async v => { state.writes.push(v); return v; } };
  return { state, options, service: new ProviderCapabilityService(repo, options, () => new Date(now)) };
}
test('mock evidence is denied by default and allowed only by explicit offline policy', async () => {
  assert.equal((await setup().service.preflight(profile, ['tools'])).allowed, false);
  assert.equal((await setup(true).service.preflight(profile, ['tools'])).allowed, true);
});
test('caller cannot mutate the constructor policy into allowing mocks', async () => {
  const f = setup(); f.options.allowMock = true; assert.equal((await f.service.preflight(profile, ['tools'])).allowed, false);
});
test('a live label and a matching fingerprint are not evidence authenticity', async () => {
  for (const allowMock of [false, true]) {
    const f = setup(allowMock); f.state.rows[0].details.verification.evidence = 'live';
    assert.equal((await f.service.preflight(profile, ['tools'])).allowed, false);
    assert.equal(f.state.writes.length, 0);
  }
});
for (const patch of [{ model: 'changed' }, { protocol: 'changed' }, { credentialRef: 'rotated' }, { serviceMode: 'platform_managed' }, { allowedCapabilities: ['text'] }]) test('profile change invalidates otherwise supported evidence', async () => {
  const f = setup(true); assert.equal((await f.service.preflight({ ...profile, ...patch }, ['tools'])).allowed, false);
});
for (const mutate of [r => { r.profileId = 'other'; }, r => { r.scope.id = 'other'; }, r => { r.scope.kind = 'PLATFORM'; }]) test('foreign evidence cannot confer support', async () => {
  const f = setup(true); mutate(f.state.rows[0]); await assert.rejects(f.service.preflight(profile, ['tools']), e => e.code === 'CONFIG_INVALID');
});
for (const mutate of [r => { r.details = undefined; }, r => { r.source = 'declared'; }, r => { r.source = 'manual'; },
  r => { r.expiresAt = null; }, r => { r.expiresAt = now; }, r => { r.checkedAt = new Date(now.getTime() + 1); },
  r => { r.details.verification.capability = 'text'; }, r => { r.details.verification.methodVersion = ''; }]) test('incomplete, expired or non-probe metadata remains unverified', async () => {
  const f = setup(true); mutate(f.state.rows[0]); assert.equal((await f.service.preflight(profile, ['tools'])).allowed, false);
});
test('duplicate current records reject instead of letting the last row win', async () => {
  const f = setup(true); f.state.rows.push({ ...row(), status: 'unsupported' });
  await assert.rejects(f.service.preflight(profile, ['tools']), e => e.code === 'CONFIG_INVALID');
});
test('valid current evidence is not marked stale merely because old history exists', async () => {
  const f = setup(true); f.state.rows.push({ ...row(), id: 'older', observedRevision: 1 });
  assert.deepEqual(await f.service.preflight(profile, ['tools']), { allowed: true, required: ['tools'], missing: [], stale: [] });
});
test('disabled or invalid profile fails before evidence reads', async () => {
  for (const patch of [{ enabled: false }, { configRevision: 0 }, { disabledAt: now }]) {
    const f = setup(true); await assert.rejects(f.service.preflight({ ...profile, ...patch }, ['tools'])); assert.equal(f.state.calls, 0);
  }
});
test('legacy supported record without verification is persisted as unverified', async () => {
  const f = setup(true); await f.service.record({ profile, capability: 'tools', status: 'supported', source: 'connection_test', evidenceHash: 'old', checkedAt: now });
  assert.equal(f.state.writes[0].status, 'unverified');
});
test('verified mock record needs explicit policy and expiry', async () => {
  for (const allow of [false,true]) {
    const f = setup(allow), r = row();
    await f.service.record({ profile, capability: r.capability, status: r.status, source: r.source, evidenceHash: r.evidenceHash, checkedAt: r.checkedAt, expiresAt: r.expiresAt, details: r.details });
    assert.equal(f.state.writes[0].status, allow ? 'supported' : 'unverified');
  }
});
test('malformed dates and unknown required capabilities fail closed', async () => {
  const f = setup(true);
  for (const checkedAt of [new Date(NaN), new Date(now.getTime() + 1000)]) await assert.rejects(f.service.record({ profile, capability: 'text', status: 'supported', source: 'connection_test', evidenceHash: 'x', checkedAt }), e => e.code === 'CONFIG_INVALID');
  await assert.rejects(f.service.preflight(profile, ['invented']), e => e.code === 'CONFIG_INVALID');
  assert.equal(f.state.writes.length, 0);
});
const recordInput = r => ({ profile, capability: r.capability, status: r.status, source: r.source, evidenceHash: r.evidenceHash, checkedAt: r.checkedAt, expiresAt: r.expiresAt, details: r.details });
const invalid = e => e.code === 'CONFIG_INVALID' && e.message === e.code;
test('trusted live verifier receives the full evidence binding as an isolated snapshot', async () => {
  let received;
  const f = setup(false, { verify: async value => { received = structuredClone(value); value.profile.model = 'mutated'; value.details.verification.capability = 'text'; return true; } });
  f.state.rows[0].details.verification.evidence = 'live';
  assert.equal((await f.service.preflight(profile, ['tools'])).allowed, true);
  assert.deepEqual(received, recordInput(f.state.rows[0]));
  assert.equal(profile.model, 'm'); assert.equal(f.state.rows[0].details.verification.capability, 'tools');
  assert.equal(f.state.writes.length, 0, 'injected verifier is an offline double, not provider evidence');
});
for (const response of [false, undefined, 'true', { verified: true }]) test('only an explicit verifier boolean true permits live evidence', async () => {
  const f = setup(false, { verify: async () => response }); f.state.rows[0].details.verification.evidence = 'live';
  assert.equal((await f.service.preflight(profile, ['tools'])).allowed, false);
});
test('verifier failures do not expose credentials or promote evidence', async () => {
  const f = setup(false, { verify: async () => { throw Error('secret-provider-error'); } }); f.state.rows[0].details.verification.evidence = 'live';
  await assert.rejects(f.service.preflight(profile, ['tools']), invalid);
  await assert.rejects(f.service.record(recordInput(f.state.rows[0])), invalid);
  assert.equal(f.state.writes.length, 0);
});
test('recording an unauthenticated live label persists unverified, not supported', async () => {
  const f = setup(true); f.state.rows[0].details.verification.evidence = 'live';
  await f.service.record(recordInput(f.state.rows[0])); assert.equal(f.state.writes[0].status, 'unverified');
});
test('null SQL JSON details are an absent proof rather than a corrupt row', async () => {
  const f = setup(true); f.state.rows[0].details = null;
  assert.deepEqual(await f.service.preflight(profile, ['tools']), { allowed: false, required: ['tools'], missing: ['tools'], stale: [] });
});
test('malformed or noncloneable record inputs fail with a safe error before any write', async () => {
  const f = setup(true), valid = recordInput(row());
  for (const value of [null, undefined, {}, { ...valid, profile: null }, { ...valid, details: [] }, { ...valid, details: { callback() {} } }, { ...valid, extra: 'private' }]) {
    await assert.rejects(f.service.record(value), invalid);
  }
  assert.equal(f.state.writes.length, 0);
});
test('a missing profile key fails before reading evidence', async () => {
  const f = setup(true), incomplete = { ...profile }; delete incomplete.profileKey;
  await assert.rejects(f.service.preflight(incomplete, ['tools']), invalid); assert.equal(f.state.calls, 0);
});
test('waiting for a verifier cannot retain evidence that expires during that wait', async () => {
  let time = now.getTime(); const r = row(); r.details.verification.evidence = 'live';
  const writes = [], service = new ProviderCapabilityService({ list: async () => [r], upsert: async value => { writes.push(value); return value; } },
    { liveEvidenceVerifier: { verify: async () => { time = r.expiresAt.getTime(); return true; } } }, () => new Date(time));
  assert.deepEqual(await service.preflight(profile, ['tools']), { allowed: false, required: ['tools'], missing: ['tools'], stale: ['tools'] });
  time = now.getTime(); await service.record(recordInput(r)); assert.equal(writes[0].status, 'unverified');
});
test('a later verifier cannot leave an earlier capability expired but allowed', async () => {
  let time = now.getTime(); const first = row(), second = row();
  first.details.verification.evidence = 'live'; second.details.verification.evidence = 'live';
  second.id = 'text-e'; second.capability = 'text'; second.details.verification.capability = 'text';
  second.expiresAt = new Date(now.getTime() + 120000);
  const service = new ProviderCapabilityService({ list: async () => [first, second], upsert: async value => value },
    { liveEvidenceVerifier: { verify: async value => { if (value.capability === 'text') time = first.expiresAt.getTime(); return true; } } }, () => new Date(time));
  assert.deepEqual(await service.preflight(profile, ['tools','text']), { allowed: false, required: ['tools','text'], missing: ['tools'], stale: ['tools'] });
});
test('superseded evidence cannot authorize while its original receipt is being verified', async () => {
  for (const replace of [
    rows => [{ ...rows[0], status: 'unsupported', checkedAt: new Date(now.getTime() - 500) }],
    () => [],
    rows => [{ ...rows[0], checkedAt: new Date(now.getTime() - 500) }],
    rows => [{ ...rows[0], expiresAt: new Date(now.getTime() + 30000) }],
    rows => [{ ...rows[0], evidenceHash: 'replacement' }],
    rows => [{ ...rows[0], details: { ...rows[0].details, receiptId: 'replacement' } }]
  ]) {
    let verifications = 0;
    const f = setup(false, { verify: async () => {
      verifications++; f.state.rows = replace(f.state.rows); return true;
    } });
    f.state.rows[0].details.verification.evidence = 'live';
    await assert.rejects(f.service.preflight(profile, ['tools']), invalid);
    assert.equal(verifications, 1); assert.equal(f.state.calls, 2); assert.equal(f.state.writes.length, 0);
  }
  const f = setup(false, { verify: async value => {
    if (value.capability === 'text') f.state.rows[0].status = 'unsupported';
    return true;
  } });
  const second = { ...row(), id: 'text-e', capability: 'text' };
  second.details = { verification: { ...second.details.verification, capability: 'text', evidence: 'live' } };
  f.state.rows[0].details.verification.evidence = 'live'; f.state.rows.push(second);
  await assert.rejects(f.service.preflight(profile, ['tools','text']), invalid);
});
test('evidence reread is bounded, ignores unrelated history and checks final expiry', async () => {
  let reads = 0, time = now.getTime(); const r = row();
  const service = new ProviderCapabilityService({
    list: async () => { reads++; if (reads === 2) time = r.expiresAt.getTime(); return [r]; },
    upsert: async () => assert.fail('preflight must not write')
  }, { allowMock: true }, () => new Date(time));
  assert.deepEqual(await service.preflight(profile, ['tools']), { allowed: false, required: ['tools'], missing: ['tools'], stale: ['tools'] });
  assert.equal(reads, 2);
  const f = setup(false, { verify: async () => {
    f.state.rows.push({ ...row(), id: 'old', observedRevision: 1 });
    return true;
  } });
  f.state.rows[0].details.verification.evidence = 'live';
  assert.equal((await f.service.preflight(profile, ['tools'])).allowed, true);
  assert.equal(f.state.calls, 2);
  let failedReads = 0;
  const failing = new ProviderCapabilityService({
    list: async () => { if (++failedReads === 2) throw Error('private-persistence-detail'); return [row()]; },
    upsert: async () => assert.fail('preflight must not write')
  }, { allowMock: true }, () => new Date(now));
  await assert.rejects(failing.preflight(profile, ['tools']), invalid); assert.equal(failedReads, 2);
});
test('policy dependencies cannot be replaced after service construction', async () => {
  const f = setup(); f.options.liveEvidenceVerifier = { verify: async () => true }; f.state.rows[0].details.verification.evidence = 'live';
  assert.equal((await f.service.preflight(profile, ['tools'])).allowed, false);
});
test('malformed dependency options are rejected', () => {
  const repo = { list: async () => [], upsert: async value => value };
  for (const options of [{ liveEvidenceVerifier: {} }, { liveEvidenceVerifier: { verify: true } }, { extra: true }]) assert.throws(() => new ProviderCapabilityService(repo, options), invalid);
  assert.throws(() => new ProviderCapabilityService(repo, {}, null), invalid);
});
test('write failures are sanitized and are not retried', async () => {
  let writes = 0;
  const service = new ProviderCapabilityService({ list: async () => [], upsert: async () => { writes++; throw Error('sql-and-secret'); } }, {}, () => new Date(now));
  await assert.rejects(service.record(recordInput(row())), invalid); assert.equal(writes, 1);
});
