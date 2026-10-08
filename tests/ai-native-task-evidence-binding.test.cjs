'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaTaskRunEvidenceRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-evidence.repository');
const lease = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', revision: 1, fencingToken: '1', expiresAt: '2099-01-01T00:00:00Z' };
const plan = { taskId: 'task-a', runId: 'run-a', taskRevision: 1, steps: [{ registrationRef: 'step-a', toolCode: 'rental.order.explain', toolVersion: '1', operation: 'readonly' }],
  limits: { maxSteps: 1, maxCalls: 1, maxTotalMs: 100, maxStepMs: 100, maxOutputBytes: 100, maxConcurrent: 1 } };
function setup(mutate) {
  const task = { id: 'task-a', scopeId: 'scope-a', revision: 1 }, run = { id: 'run-a', scopeId: 'scope-a', taskId: 'task-a',
    leaseOwnerId: 'worker-a', revision: 1, fencingToken: new Prisma.Decimal(1), status: 'RUNNING', leaseExpiresAt: new Date(lease.expiresAt) };
  mutate(task, run); let writes = 0;
  // Simulates a permissive collation/corrupt readback, not the authorization
  // algorithm. Product code must compare returned identities, not query presence.
  const tx = { $queryRaw: async () => [], aiTask: { findFirst: async () => task, updateMany: async () => ({ count: 1 }) },
    aiRun: { findFirst: async () => run, updateMany: async () => ({ count: 1 }) },
    aiTaskRunPlan: { findUnique: async () => null, create: async ({ data }) => { writes++; return data; } },
    aiTaskResultArtifact: { create: async () => assert.fail('not executing') } };
  const db = { ...tx, $transaction: async callback => callback(tx) };
  const scopes = { resolve: async () => ({ scopeId: 'scope-a', bindingKey: 'owner-a', taskWhere: { id: 'task-a', ownerId: 'user-a' } }) };
  const policies = { authorize: async () => ({ authorityHash: 'a'.repeat(64), policyVersion: '1', expiresAt: lease.expiresAt }) };
  return { service: new PrismaTaskRunEvidenceRepository(db, scopes, policies, () => new Date('2026-10-06T12:00:00Z')), writes: () => writes };
}
for (const [name, mutate] of [
  ['task case', t => { t.id = 'TASK-A'; }], ['task scope', t => { t.scopeId = 'other'; }],
  ['run case', (_t, r) => { r.id = 'RUN-A'; }], ['run task', (_t, r) => { r.taskId = 'other'; }],
  ['run scope', (_t, r) => { r.scopeId = 'other'; }], ['holder case', (_t, r) => { r.leaseOwnerId = 'WORKER-A'; }],
  ['run revision', (_t, r) => { r.revision = 2; }], ['run fence', (_t, r) => { r.fencingToken = new Prisma.Decimal(2); }],
  ['run expiry', (_t, r) => { r.leaseExpiresAt = new Date('2000-01-01'); }]
]) test(`actual evidence repository refuses mismatched ${name} before immutable plan write`, async () => {
  const h = setup(mutate);
  await assert.rejects(h.service.savePlan(plan, lease), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(h.writes(), 0);
});
