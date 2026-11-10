'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: {
  module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { aiTaskHasUnresolvedEffects } = require('../apps/api/src/modules/ai-native/task-unresolved-effects');
const { inspectRetentionSource } = require('../apps/api/src/modules/ai-native/privacy/retention-model-sources');
const { isOriginalB02MigrationChain, prepareOriginalB02ScopeProjection } = require('../scripts/ops/ai-native-b02-upgrade-core.cjs');
const owner = { tenantId: 'tenant-b02-test', workspaceId: 'workspace-b02-test' };
function fixture(status = 'unknown', patch = {}, count = 1) {
  const original = { id: 'original-reservation', ...owner, callId: 'original-call', status,
    reservedUnits: 17, actualInput: null, actualOutput: null, unknownReason: 'original-dispatch-unknown',
    expiresAt: new Date('2000-01-01T00:00:00Z'), ...patch };
  const baseline = structuredClone(original);
  const matches = ({ where }) => where.tenantId === original.tenantId && where.workspaceId === original.workspaceId
    && (!where.callId || where.callId.in.includes(original.callId)) && where.status.in.includes(original.status);
  const neverWrite = () => { throw new Error('this read-only fixture provides no mutation success'); };
  const tx = {
    aiTask: { findFirst: async () => null, findMany: async () => [] },
    aiStep: { findFirst: async () => null, findMany: async () => [] },
    aiTaskExecutionCharge: { findFirst: async () => null, findMany: async () => [] },
    aiApprovalConsumption: { findFirst: async () => null },
    aiRun: { findMany: async () => [{ id: 'original-run' }] },
    aiGatewayInvocation: { findMany: async () => [{ callId: original.callId }], findUnique: async () => null },
    aiBudgetReservation: { findFirst: async () => null, findMany: async () => [] },
    aiInvocationAdmission: { findFirst: async () => null, findMany: async () => [] },
    aiUsageReservation: {
      findFirst: async input => matches(input) ? { id: original.id } : null,
      findMany: async input => {
        assert.equal(input.take, 51);
        assert.deepEqual(input.select, { callId: true });
        return matches(input) ? Array.from({ length: count }, () => ({ callId: original.callId })) : [];
      },
      update: neverWrite, updateMany: neverWrite, delete: neverWrite, deleteMany: neverWrite
    },
    fileAsset: { findFirst: async () => null }
  };
  return { tx, unchanged: () => assert.deepEqual(original, baseline) };
}
test('original unknown workspace usage still holds a terminal task after TTL, without changing the row or counters', async () => {
  const x = fixture();
  assert.equal(await aiTaskHasUnresolvedEffects(x.tx, 'scope-test', 'task-test', owner), true);
  x.unchanged();
});
for (const kind of ['knowledge', 'memory', 'attachment']) test(`unlinked original unknown usage keeps ${kind} deletion unavailable, never clear`, async () => {
  const x = fixture();
  assert.equal(await inspectRetentionSource(x.tx, 'scope-test', kind, 'resource-test', owner), 'unavailable');
  x.unchanged();
});
test('legacy holds keep exact workspace boundaries and do not hold settled/released usage', async () => {
  for (const [status, patch] of [['unknown', { workspaceId: 'other-workspace' }], ['settled', {}], ['released', {}]]) {
    const x = fixture(status, patch);
    assert.equal(await aiTaskHasUnresolvedEffects(x.tx, 'scope-test', 'task-test', owner), false);
    assert.equal(await inspectRetentionSource(x.tx, 'scope-test', 'knowledge', 'resource-test', owner), 'clear');
    x.unchanged();
  }
});
test('oversized legacy unknown bindings retain fail-closed source result', async () => {
  const x = fixture('unknown', {}, 51);
  assert.equal(await inspectRetentionSource(x.tx, 'scope-test', 'knowledge', 'resource-test', owner), 'unavailable');
  x.unchanged();
});
test('one B02 checksum, fake full chain or missing provenance cannot authorize a bridge projection', () => {
  const one = { name: '20261003160000_ai_provider_profiles', checksum: '9cc1a6b407974f7d8028d8bd07a8f12b98375eadb990da869ca9a372dc91ea2f' };
  assert.equal(isOriginalB02MigrationChain([one]), false);
  const fabricated = Array.from({ length: 178 }, (_, index) => ({ name: `fake_${index}`, checksum: 'a'.repeat(64) }));
  assert.equal(isOriginalB02MigrationChain(fabricated), false);
  assert.equal(isOriginalB02MigrationChain(Array(178).fill(one)), false);
  assert.throws(() => prepareOriginalB02ScopeProjection({ successfulMigrations: fabricated, scopes: [] }, () => {
    throw new Error('normalizer must not be called with unrecognized provenance');
  }), error => error.code === 'AI_B02_BRIDGE_SOURCE_UNAVAILABLE');
});
