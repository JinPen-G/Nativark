'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { AiRetentionRestoreVerifier, signRetentionManifest } = require('../apps/api/src/modules/ai-native/privacy/retention-restore');
const { AiPlatformRetentionRestoreVerifier, signPlatformRetentionManifest } = require('../apps/api/src/modules/ai-native/privacy/platform-retention-restore');
const { AI_RETENTION_POLICY } = require('../apps/api/src/modules/ai-native/privacy/retention-policy');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
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
