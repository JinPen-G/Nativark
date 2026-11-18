'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { AI_TASK_INPUT_DRAFT_VERSION, clientTaskInputReference, aiClientTaskInputSubmissionRequestSchema,
  clientGoalStorageKey, minimizeClientRecoveryRecord, clientGoalFingerprint } = require('../packages/shared/src/index.ts');
const task = { creationKey: 'creation', materialRef: '3b5733a7-e021-4fbf-9e50-6fd1804e950f' };
const material = { materialRef: task.materialRef, inputHash: 'b'.repeat(64), materialHash: 'a'.repeat(64), expiresAt: '2026-11-19T12:00:00Z' };
const submission = { ...task, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, requestId: 'question', expectedRevision: 2,
  submissionKey: 'original', answers: [{ fieldId: 'clarification_text', value: 'private response' }] } };
const owner = clientGoalStorageKey({ tenantCode: 'tenant', serviceCode: 'shop', customerId: 'customer', surface: 'tenant_website' });

test('legacy answers become receipt selectors while submit still requires the complete human answer', () => {
  const reference = clientTaskInputReference(submission);
  assert.deepEqual(reference.submission, { requestId: 'question', expectedRevision: 2, submissionKey: 'original' });
  assert.equal(aiClientTaskInputSubmissionRequestSchema.safeParse(reference).success, false);
  const journal = { version: 'client-goal-operation-1', owner, goal: { operationKey: 'goal', goalHash: 'c'.repeat(64) },
    material, task, phase: 'answer_pending', answer: submission, continued: false, quote: null };
  const migrated = minimizeClientRecoveryRecord(owner, journal);
  assert.equal(migrated.phase, 'answer_pending'); assert.deepEqual(migrated.answer, reference);
  assert.equal(JSON.stringify(migrated).includes('private response'), false);
});

test('an archived selection retains its original operation and canonical digest, never the selected location or address', () => {
  const selection = { bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false }, fulfillmentMode: 'delivery',
    fulfillmentLocationId: 'private-location', deliveryAddressId: 'private-address', startAt: '2026-11-20T12:00:00Z', endAt: '2026-11-21T12:00:00Z',
    lines: [{ itemGroupId: 'item', quantity: 1, pricingUnit: 'day_24h' }] };
  const journal = { version: 'client-goal-operation-1', owner, goal: { operationKey: 'goal', goalHash: 'c'.repeat(64) }, material, task,
    phase: 'quoted', answer: null, continued: false, quote: { material, request: { ...task, operationKey: 'quoted-operation',
      expectedMaterialHash: material.materialHash, expectedProjectionHash: 'd'.repeat(64), decision: 'prepare_original_quote', input: selection } } };
  const migrated = minimizeClientRecoveryRecord(`${owner}:history:goal`, journal);
  assert.equal(migrated.quote.request.operationKey, 'quoted-operation');
  assert.equal(migrated.quote.request.selectionHash, clientGoalFingerprint(selection));
  assert.equal(JSON.stringify(migrated).includes('private-'), false);
  assert.equal(clientGoalFingerprint({ b: [1, '家'], a: 2 }), createHash('sha256').update('{"a":2,"b":[1,"家"]}').digest('hex'));
  assert.deepEqual(minimizeClientRecoveryRecord(owner, migrated), migrated);
});
