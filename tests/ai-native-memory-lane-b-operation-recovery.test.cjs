'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');

test('operation recovery keeps missing receipts unknown and exposes only current bounded state', async () => {
  const { ports } = fixture(), api = new PersistentMemoryConsentService(ports);
  await api.propose({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt: new Date(h.now + 3600000).toISOString(), preference: { kind: 'locale', value: 'zh-CN' } });
  const result = await api.operationRecovery({ memoryId: 'memory-1', operationId: 'missing-op', expectedRevision: 1, operation: 'modify' });
  assert.equal(result.receipt, 'unknown');
  assert.equal(result.nextStep, 'reconcile_same_operation');
  assert.equal(result.absenceSemantics, 'no_receipt_is_not_proof_of_non_execution');
  assert.deepEqual(Object.keys(result.current).sort(), ['expiresAt', 'revision', 'status']);
});
