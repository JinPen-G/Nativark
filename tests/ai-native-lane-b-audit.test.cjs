'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const load = () => require('../apps/api/src/modules/ai-native/evaluation/evaluation-audit');
const input = () => ({ version: 1, requestId: 'synthetic-request', scope: h.scope, inputHash: 'a'.repeat(64), authorityHash: 'b'.repeat(64), planIds: ['synthetic-plan'], toolIds: ['knowledge_search'], result: { status: 'unknown', code: 'AI_RESULT_UNKNOWN' } });
test.after(() => assert.deepEqual(h.attempts, []));
test('audit schema rejects raw model thought, prompts, credentials and unknown result bodies', () => {
  const { evaluationAudit } = load();
  for (const field of ['chainOfThought', 'prompt', 'apiKey', 'authorization', 'body', 'title']) {
    assert.throws(() => evaluationAudit({ ...input(), [field]: 'synthetic-sensitive' }));
  }
  assert.throws(() => evaluationAudit({ ...input(), result: { ...input().result, body: 'synthetic-sensitive' } }));
});
test('audit snapshot is bounded and detached; unknown is not converted to success', () => {
  const { evaluationAudit } = load(), value = input(), record = evaluationAudit(value);
  value.scope.tenantId = 'changed'; value.planIds.push('late');
  assert.equal(record.scope.tenantId, 'tenant-1'); assert.deepEqual(record.planIds, ['synthetic-plan']);
  assert.equal(record.result.status, 'unknown');
  for (const change of [{ planIds: Array(65).fill('p') }, { toolIds: ['https://bad.invalid/execute'] }, { inputHash: 'not-a-hash' }, { requestId: 'x'.repeat(129) }]) assert.throws(() => evaluationAudit({ ...input(), ...change }));
});
test('evidence report keeps deterministic pass separate from uncollected language quality and live evidence', () => {
  const { evaluationSummary } = load();
  const summary = evaluationSummary([{ id: 'case-1', evidence: 'offline_service', status: 'pass' }, { id: 'case-2', evidence: 'transport_simulation', status: 'fail' }]);
  assert.deepEqual(summary.counts, { pass: 1, fail: 1, unavailable: 0 });
  assert.equal(summary.languageQuality, 'not_sampled'); assert.equal(summary.realEgress, 'not_verified');
  assert.throws(() => evaluationSummary([{ id: 'case-1', evidence: 'live', status: 'pass' }]));
  assert.throws(() => evaluationSummary([{ id: 'case-1', evidence: 'offline_service', status: 'pass', modelScore: 1 }]));
});
test('audit result codes use the existing closed public code list, not an arbitrary text channel', () => {
  const { evaluationAudit } = load();
  assert.throws(() => evaluationAudit({ ...input(), result: { status: 'failed', code: 'SYNTHETIC_SECRET_FRAGMENT' } }));
  assert.throws(() => evaluationAudit({ ...input(), result: { status: 'succeeded', code: 'AI_ACCESS_DENIED' } }));
});
