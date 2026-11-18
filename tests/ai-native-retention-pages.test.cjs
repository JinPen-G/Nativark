'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { AiRetentionRestoreVerifier, signRetentionManifest } = require('../apps/api/src/modules/ai-native/privacy/retention-restore');
const { AiPlatformRetentionRestoreVerifier, signPlatformRetentionManifest } = require('../apps/api/src/modules/ai-native/privacy/platform-retention-restore');
const { AI_RETENTION_POLICY } = require('../apps/api/src/modules/ai-native/privacy/retention-policy');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
test('retention observations preserve partial coverage, holds, unknown deadlines and cursor continuity', () => {
  const { retentionCandidate, retentionPageObservation } = require('../apps/api/src/modules/ai-native/privacy/retention-page-observation');
  const now = new Date('2026-11-18T12:00:00Z'), old = new Date('2026-10-18T12:00:00Z');
  const scope = { scopeKind: 'workspace', scopeId: 'private-scope', kind: 'material' };
  const rows = ['erased','withdrawn','held','unknown','unavailable'].map((id, index) => retentionCandidate(id, index === 4 ? null : old));
  const page = retentionPageObservation(scope, now, rows, rows.map(({id}) => ({state:id})), 'private-cursor');
  assert.deepEqual([page.scanned,page.erased,page.withdrawn,page.held,page.pending,page.overdue,page.oldestOverdueMs,page.missingDeadline], [5,1,1,1,2,2,86400000,1]);
  assert.equal(page.coverage,'bounded_candidate_page'); assert.doesNotMatch(JSON.stringify(page), /private-/u);
  const last = retentionPageObservation({...scope,after:'private-cursor'}, now, [], [], null);
  assert.equal(last.afterHash, page.nextHash); assert.equal(last.nextHash,null); assert.equal(last.oldestOverdueMs,null);
});
test('restore barrier verifies 501 distinct workspaces and the platform in one restored snapshot', () => {
  const { verifyRestoredAiScopes } = require('../scripts/ops/ai-retention.cjs');
  const { sign } = require('node:crypto');
  const now = new Date(), database = 'restored', snapshotSha256 = 'a'.repeat(64);
  const scopes = [...Array.from({length:501}, (_, index) => ({tenantId:'tenant',workspaceId:`space-${index}`})),
    {scopeKind:'PLATFORM',scopeId:'platform',tenantId:null,workspaceId:null}];
  const certificates = scopes.map(scope => {
    const payload = JSON.stringify({...scope, version:scope.scopeKind ? 'ai-restored-platform-scope-1' : 'ai-restored-scope-1',
      policyVersion:AI_RETENTION_POLICY.version,database,snapshotSha256,manifestHash:'b'.repeat(64),verifiedAt:now.toISOString()});
    return {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
  });
  const input = {certificates,publicKey,database,snapshotSha256,scopes,now};
  assert.equal(verifyRestoredAiScopes(input).scopes,502);
  for (const invalid of [certificates.slice(0,-1), [...certificates.slice(0,-1),certificates[0]]]) assert.throws(() => verifyRestoredAiScopes({...input,certificates:invalid}));
  assert.throws(() => verifyRestoredAiScopes({...input,snapshotSha256:'c'.repeat(64)}));
});
for (const platform of [false, true]) {
  test(`${platform ? 'platform' : 'workspace'} restores 501 markers only with the complete ordered signed manifest`, () => {
    const now = new Date(), sign = platform ? signPlatformRetentionManifest : signRetentionManifest;
    const verifier = platform ? new AiPlatformRetentionRestoreVerifier(publicKey, () => now) : new AiRetentionRestoreVerifier(publicKey, () => now);
    const base = { policyVersion: AI_RETENTION_POLICY.version, snapshotId: randomUUID(), snapshotSha256: 'a'.repeat(64),
      snapshotCreatedAt: now.toISOString(), issuedAt: now.toISOString(), complete: true, ...(platform ? {
        version: 'ai-platform-restore-tombstones-1', tenantId: null, workspaceId: null, scopeKind: 'PLATFORM', scopeId: 'platform',
      } : { version: 'ai-restore-tombstones-1', tenantId: 'tenant', workspaceId: 'workspace' }) };
    const tombstones = Array.from({ length: 501 }, (_, index) => ({ kind: 'task', resourceId: `task-${index}`, targetHash: 'b'.repeat(64) }));
    const signed = sign({ ...base, tombstones }, privateKey);
    assert.equal(verifier.verify(signed).manifest.tombstones.length, 501);
    assert.equal(verifier.verify(sign({ ...base, tombstones: tombstones.slice(0, 2) }, privateKey)).manifest.tombstones.length, 2);
    for (const pages of [signed.pages.slice(1), [...signed.pages].reverse(), [signed.pages[0], signed.pages[0], signed.pages[2]]]) {
      assert.throws(() => verifier.verify({ ...signed, pages }));
    }
    assert.throws(() => verifier.verify({ ...signed, payload: signed.payload.replace(base.snapshotId, randomUUID()) }));
  });
}
