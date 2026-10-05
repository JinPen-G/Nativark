'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaTaskTakeoverRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-takeover.repository');
const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const apiRequire = require('node:module').createRequire(require('node:path').resolve(__dirname, '../apps/api/package.json'));
const { AI_CONTRACT_DRAFT_VERSION, AI_TASK_DRAFT_VERSION } = apiRequire('@rental-os/shared');
const now = new Date('2026-10-06T10:00:00Z');
const input = { taskId: 'task-a', runId: 'run-a', previousHolderId: 'worker-a', holderId: 'human-a', expectedTaskRevision: 1,
  expectedRunRevision: 1, expectedFencingToken: '1', leaseMs: 30000 };

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'fencingToken') return String(row[key]) === String(value);
    if (value && typeof value === 'object' && 'is' in value) return matches(row[key], value.is);
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
    return row[key] === value;
  });
}
function harness() {
  const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'request-a', authorizedAt: now.toISOString(), audience: 'operator',
    actor: { kind: 'user', userId: 'user-a' }, scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    access: { permissions: ['rental-os:order:operate'], dataScope: 'all', locationScope: { mode: 'all' } } };
  const state = { task: { id: 'task-a', scopeId: 'scope-a', archivedAt: null, scopeKind: 'WORKSPACE', audience: 'OPERATOR', ownerKind: 'USER', ownerId: 'user-a',
    scope: { kind: 'WORKSPACE', scopeKey: 'workspace:8:tenant-a:11:workspace-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    revision: 1, contractVersion: AI_TASK_DRAFT_VERSION, status: 'RUNNING' },
    run: { id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', actorKind: 'USER', actorId: 'user-a', revision: 1, fencingToken: '1', status: 'RUNNING',
      leaseOwnerId: 'worker-a', leaseExpiresAt: new Date(now.getTime() + 60000) }, logs: [] };
  const control = { failAudit: false, loseReply: false, revoked: false, resolveCount: 0, revokeAt: 0, locks: [] };
  const authority = { resolve: async (_, operation) => { assert.ok(['takeover_run', 'release_run'].includes(operation));
    if (++control.resolveCount === control.revokeAt) control.revoked = true;
    if (control.revoked) throw new Error('revoked'); return structuredClone(context); } };
  function delegates(draft) {
    return { aiTask: { findFirst: async ({ where }) => matches(draft.task, where) ? structuredClone(draft.task) : null },
      aiRun: { updateMany: async ({ where, data }) => {
        const run = { ...draft.run, task: draft.task }; if (!matches(run, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) draft.run[key] = key === 'fencingToken'
            ? (BigInt(draft.run[key]) + BigInt(String(value.increment))).toString() : draft.run[key] + value.increment;
          else draft.run[key] = value;
        } return { count: 1 };
      } }, operationLog: { create: async ({ data }) => { if (control.failAudit) throw new Error('audit unavailable'); draft.logs.push(structuredClone(data)); return data; } },
      $queryRaw: async sql => { control.locks.push(sql.sql); return []; } };
  }
  let tail = Promise.resolve(); const db = delegates(state);
  db.$transaction = callback => { const work = tail.then(async () => {
    const draft = structuredClone(state); const result = await callback(delegates(draft)); Object.assign(state, draft);
    if (control.loseReply) { control.loseReply = false; throw new Error('commit reply lost'); } return result;
  }); tail = work.catch(() => {}); return work; };
  return { context, state, control, db, authority, make: () => new PrismaTaskTakeoverRepository(db, authority, () => now) };
}

test('same-owner takeover atomically fences the old worker and audits without changing business state', async () => {
  const h = harness(), receipt = await h.make().takeover(input);
  assert.equal(receipt.purpose, 'recovery_only'); assert.equal(receipt.fencingToken, '2');
  assert.equal(h.state.task.status, 'RUNNING'); assert.equal(h.state.task.revision, 1); assert.equal(h.state.logs.length, 1);
  assert.match(h.control.locks[0], /FOR UPDATE/u);
  await assert.rejects(new AiTaskRepository(h.db, h.authority, () => now).releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: 'worker-a',
    expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '1' }), e => e.code === 'AI_REVISION_CONFLICT');
});
test('competing takeovers have exactly one winner and one audit', async () => {
  const h = harness(); const results = await Promise.allSettled([h.make().takeover(input), h.make().takeover({ ...input, holderId: 'human-b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.state.logs.length, 1);
});
test('audit failure and current permission revocation roll back the fencing write', async () => {
  for (const mode of ['audit', 'revoked']) {
    const h = harness(); h.control.failAudit = mode === 'audit'; h.control.revokeAt = mode === 'revoked' ? 3 : 0;
    await assert.rejects(h.make().takeover(input), e => e.code === (mode === 'audit' ? 'AI_STORAGE_UNAVAILABLE' : 'AI_ACCESS_DENIED'));
    assert.equal(h.state.run.fencingToken, '1'); assert.equal(h.state.logs.length, 0);
  }
});
test('lost commit reply retains the new holder; restart cannot replay old CAS into another lease', async () => {
  const h = harness(); h.control.loseReply = true;
  await assert.rejects(h.make().takeover(input), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  assert.equal(h.state.run.leaseOwnerId, 'human-a');
  await assert.rejects(h.make().takeover(input), e => e.code === 'AI_REVISION_CONFLICT'); assert.equal(h.state.logs.length, 1);
});
test('other owner, workspace, run actor, terminal task and stale task revision cannot be taken over', async () => {
  for (const mutate of [h => { h.state.task.ownerId = 'user-b'; }, h => { h.state.task.scope.workspaceId = 'workspace-b'; },
    h => { h.state.run.actorId = 'user-b'; }, h => { h.state.task.status = 'SUCCEEDED'; }, h => { h.state.task.revision = 2; }]) {
    const h = harness(); mutate(h); await assert.rejects(h.make().takeover(input)); assert.equal(h.state.run.fencingToken, '1'); assert.equal(h.state.logs.length, 0);
  }
});
test('missing authority, overflow and same holder fail before writes', async () => {
  const h = harness(); assert.throws(() => new PrismaTaskTakeoverRepository(h.db, {}, () => now));
  for (const altered of [{ ...input, expectedFencingToken: '99999999999999999999' }, { ...input, holderId: 'worker-a' }, { ...input, leaseMs: 120001 }])
    await assert.rejects(h.make().takeover(altered), e => e.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.logs.length, 0);
});
