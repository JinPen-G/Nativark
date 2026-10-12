'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const api = require('../packages/shared/src/ai-task-input-draft');
const { AI_TASK_INPUT_DRAFT_SCHEMAS: schemas } = require('../packages/shared/src/ai-task-input-draft-schemas');
const h = require('./fixtures/ai-native/contract-consumer.cjs');
const validators = h.validatorsFor(schemas, {});
const version = api.AI_TASK_INPUT_DRAFT_VERSION;
const contract = () => ({ draftVersion: version, code: 'rental.clarification', version: '1', fields: [
  { fieldId: 'customer_selection', kind: 'choice', required: true, label: 'Customer', options: [{ value: 'candidate-a', label: 'A' }] },
  { fieldId: 'quantity', kind: 'integer', required: true, label: 'Quantity', minimum: 1, maximum: 5 },
  { fieldId: 'starts_at', kind: 'text', required: false, label: 'Start', maxLength: 24 }
] });
const answers = () => [{ fieldId: 'customer_selection', value: 'candidate-a' }, { fieldId: 'quantity', value: 2 }];
const submission = () => ({ draftVersion: version, taskId: 'task-a', requestId: 'request-a', expectedRevision: 4, submissionKey: 'answer-a', answers: answers() });

test('input schemas are published as OpenAPI components', () => {
  const { AI_LEAF_COMPONENT_SCHEMAS } = require('../apps/api/src/contracts/ai-leaf-components');
  for (const name of Object.keys(schemas)) assert.ok(AI_LEAF_COMPONENT_SCHEMAS[name], name);
});

test('closed clarification schemas and semantic validators accept the same bounded input', () => {
  h.checkClosed(schemas, schemas);
  assert.equal(validators.AiTaskInputContractDraft(contract()), true);
  assert.equal(api.isAiTaskInputContractDraft(contract()), true);
  assert.equal(validators.AiTaskInputSubmissionDraft(submission()), true);
  assert.equal(api.isAiTaskInputSubmissionDraft(submission()), true);
  assert.equal(api.validateAiTaskInputAnswersDraft(contract(), answers()), true);
  const offered = contract();
  offered.fields.push({ fieldId: 'fulfillment_selection', kind: 'choice', required: true,
    label: 'Current server fulfillment mode', options: [{ value: 'store_pickup_return', label: 'Store pickup and return' }] });
  const selected = [...answers(), { fieldId: 'fulfillment_selection', value: 'store_pickup_return' }];
  assert.equal(validators.AiTaskInputContractDraft(offered), true);
  assert.equal(api.isAiTaskInputContractDraft(offered), true);
  assert.equal(api.validateAiTaskInputAnswersDraft(offered, selected), true);
  assert.equal(api.validateAiTaskInputAnswersDraft(offered,
    [...answers(), { fieldId: 'fulfillment_selection', value: 'delivery' }]), false);
  const { AI_LEAF_COMPONENT_SCHEMAS } = require('../apps/api/src/contracts/ai-leaf-components');
  assert.ok(AI_LEAF_COMPONENT_SCHEMAS.AiSceneModelInputRefreshDraft);
  const usage = { draftVersion: version, code: 'original_quote_parameters', version: '1', fields: [
    { fieldId: 'usage_quantity', kind: 'text', required: true, label: 'Explicit planned usage', maxLength: 32 }
  ] };
  assert.equal(validators.AiTaskInputContractDraft(usage), true);
  assert.equal(api.isAiTaskInputContractDraft(usage), true);
  for (const value of ['0', '1.5', '1000000']) assert.equal(api.validateAiTaskInputAnswersDraft(usage, [{ fieldId: 'usage_quantity', value }]), true);
  for (const value of ['-1', 'NaN', '1e3', '1000001', '0.10000000000000000001']) assert.equal(api.validateAiTaskInputAnswersDraft(usage, [{ fieldId: 'usage_quantity', value }]), false);
});
for (const key of ['actor', 'scope', 'tenantId', 'workspaceId', 'toolCode', 'amount', 'plan', 'confirmed', 'approvalId']) test(`clarification refuses authority/control field ${key}`, () => {
  const input = { ...submission(), [key]: 'forged' };
  assert.equal(validators.AiTaskInputSubmissionDraft(input), false);
  assert.equal(api.isAiTaskInputSubmissionDraft(input), false);
  input.answers = [{ fieldId: key, value: 'forged' }];
  assert.equal(api.validateAiTaskInputAnswersDraft(contract(), input.answers), false);
});
test('duplicate fields/options and inverted bounds are invalid even when JSON schema alone is insufficient', () => {
  const duplicate = contract(); duplicate.fields.push({ ...duplicate.fields[0], label: 'Changed' });
  assert.equal(api.isAiTaskInputContractDraft(duplicate), false);
  const choices = contract(); choices.fields[0].options.push({ value: 'candidate-a', label: 'Another label' });
  assert.equal(api.isAiTaskInputContractDraft(choices), false);
  const bounds = contract(); bounds.fields[1].minimum = 6;
  assert.equal(api.isAiTaskInputContractDraft(bounds), false);
  const type = contract(); type.fields[0] = { fieldId: 'customer_selection', kind: 'text', required: true, label: 'Unsafe', maxLength: 100 };
  assert.equal(api.isAiTaskInputContractDraft(type), false);
});
test('answers must match the exact registered choices, required fields, types and ranges', () => {
  for (const changed of [[], [answers()[0]], [...answers(), answers()[0]], [{ fieldId: 'customer_selection', value: 'outside-scope' }, answers()[1]],
    [answers()[0], { fieldId: 'quantity', value: '2' }], [answers()[0], { fieldId: 'quantity', value: 6 }],
    [...answers(), { fieldId: 'clarification_text', value: 'not requested' }]]) assert.equal(api.validateAiTaskInputAnswersDraft(contract(), changed), false);
});
test('version, revisions, unknown nested fields and non-finite answers fail closed', () => {
  for (const patch of [{ draftVersion: 'old' }, { expectedRevision: 0 }, { expectedRevision: 4294967295 }, { answers: [{ fieldId: 'quantity', value: Infinity }] },
    { answers: [{ fieldId: 'quantity', value: 2, confirmed: true }] }]) {
    assert.equal(api.isAiTaskInputSubmissionDraft({ ...submission(), ...patch }), false);
    assert.equal(validators.AiTaskInputSubmissionDraft({ ...submission(), ...patch }), false);
  }
});
test('time answers are canonical instants and do not silently parse relative dates', () => {
  assert.equal(api.validateAiTaskInputAnswersDraft(contract(), [...answers(), { fieldId: 'starts_at', value: '2026-10-07T12:00:00.000Z' }]), true);
  for (const value of ['Friday', '2026-02-30T12:00:00.000Z', '2026-10-07', '2026-10-07T12:00:00']) {
    assert.equal(api.validateAiTaskInputAnswersDraft(contract(), [...answers(), { fieldId: 'starts_at', value }]), false);
  }
});
