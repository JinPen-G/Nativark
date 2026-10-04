'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiApprovalConsumptionService } = require('../apps/api/src/modules/ai-native/approval-consumption.service');

const base = {
  context: { contractVersion: 'ain-c03-draft-1', requestId: 'req-1', authorizedAt: new Date(Date.now() - 1000).toISOString(), audience: 'staff', actor: { kind: 'user', userId: 'user-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' } },
  scopeId: 'scope-1', taskId: 'task-1', actionId: 'action-1', approvalId: 'approval-1', proposalId: 'proposal-1', proposalRevision: 2,
  actionFingerprint: 'a'.repeat(64), businessIdempotencyKey: 'business-key-1'
};

function repoHarness() {
  const rows = new Map();
  return {
    rows,
    reserve: async input => {
      const key = `${input.scopeId}:${input.taskId}:${input.actionId}`;
      const old = rows.get(key);
      if (old) {
        if (old.businessIdempotencyKey !== input.businessIdempotencyKey || old.actionFingerprint !== input.actionFingerprint) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
        return old;
      }
      const row = { ...input, status: 'reserved', resultRef: null }; rows.set(key, row); return row;
    },
    commit: async input => {
      const key = `${input.scopeId}:${input.taskId}:${input.actionId}`, row = rows.get(key);
      if (!row || row.businessIdempotencyKey !== input.businessIdempotencyKey) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
      if (row.status === 'committed') { if (row.resultRef !== input.resultRef) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' }); return row; }
      if (row.status !== 'reserved') throw Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' });
      row.status = 'committed'; row.resultRef = input.resultRef; return row;
    },
    markUnknown: async input => { const key = `${input.scopeId}:${input.taskId}:${input.actionId}`, row = rows.get(key); if (!row || row.status !== 'reserved') throw Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' }); row.status = 'unknown'; return row; },
    markFailedNoEffect: async input => { const key = `${input.scopeId}:${input.taskId}:${input.actionId}`, row = rows.get(key); if (!row || row.status !== 'reserved') throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' }); row.status = 'failed_no_effect'; return row; }
  };
}

test('approval consumption reserves once and makes replay/changed idempotency explicit', async () => {
  const repo = repoHarness(), calls = [];
  const service = new AiApprovalConsumptionService(repo, { authorize: async (input, operation) => calls.push([input.businessIdempotencyKey, operation]) });
  const first = await service.reserve(base), replay = await service.reserve({ ...base });
  assert.equal(first.status, 'reserved'); assert.deepEqual(replay, first);
  await assert.rejects(() => service.reserve({ ...base, businessIdempotencyKey: 'different-key' }), error => error.code === 'CONFIG_INVALID');
  assert.deepEqual(calls.map(item => item[1]), ['reserve', 'reserve', 'reserve']);
});

test('commit is a separate Core boundary and unknown is sticky', async () => {
  const repo = repoHarness(), service = new AiApprovalConsumptionService(repo, { authorize: async () => {} });
  await service.reserve(base);
  const committed = await service.commit(base, 'order-result-1');
  assert.equal(committed.status, 'committed'); assert.equal(committed.resultRef, 'order-result-1');
  assert.deepEqual(await service.commit(base, 'order-result-1'), committed);
  await assert.rejects(() => service.commit(base, 'order-result-2'), error => error.code === 'CONFIG_INVALID');

  const otherRepo = repoHarness(), other = new AiApprovalConsumptionService(otherRepo, { authorize: async () => {} });
  await other.reserve(base); const unknown = await other.markUnknown(base); assert.equal(unknown.status, 'unknown');
  await assert.rejects(() => other.markUnknown(base), error => error.code === 'ACCOUNTING_PENDING');
  await assert.rejects(() => other.commit(base, 'late-result'), error => error.code === 'ACCOUNTING_PENDING');
});

test('missing or failed authorization is fail-closed before persistence', async () => {
  const repo = repoHarness(), service = new AiApprovalConsumptionService(repo, { authorize: async () => { throw new Error('revoked'); } });
  await assert.rejects(() => service.reserve(base), error => error.code === 'FORBIDDEN');
  assert.equal(repo.rows.size, 0);
});
