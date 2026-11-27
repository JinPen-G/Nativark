'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { execFileSync } = require('node:child_process');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { offlinePrismaSchema, publicAiSchemaHistory, prismaDatamodel } = require('./fixtures/ai-native/prisma-offline.cjs');
const source = publicAiSchemaHistory(), datamodel = prismaDatamodel(source.schema);
const model = name => { const row = datamodel.models.find(item => item.name === name); assert.ok(row, `${name} must be persisted`); return row; };
const field = (name, key) => model(name).fields.find(item => item.name === key);

test('input requests bind the exact original plan and measured step, never a fresh task', () => {
  const name = 'AiTaskInputRequest';
  assert.deepEqual(model(name).primaryKey.fields, ['scopeId', 'taskId', 'id']);
  assert.deepEqual(field(name, 'plan').relationFromFields, ['scopeId', 'taskId', 'runId', 'planHash']);
  assert.deepEqual(field(name, 'basis').relationFromFields, ['scopeId', 'taskId', 'runId', 'stepId', 'basisResultRef']);
  assert.equal(field(name, 'fencingToken').type, 'Decimal');
  for (const key of ['inputHash', 'contractHash', 'requestHash', 'waitingTaskRevision', 'allowedFields']) assert.equal(field(name, key).isRequired, true);
  assert.ok(model(name).uniqueFields.some(keys => keys.join(',') === 'scopeId,taskId,runId,stepId,planHash'));
});
test('input receipts are scoped single submissions and preserve actor and content binding', () => {
  const name = 'AiTaskInputReceipt';
  assert.deepEqual(model(name).primaryKey.fields, ['scopeId', 'taskId', 'id']);
  assert.deepEqual(field(name, 'request').relationFromFields, ['scopeId', 'taskId', 'requestId', 'planHash']);
  for (const key of ['submissionKey', 'answerHash', 'answers', 'actorId', 'actorKind', 'audience']) assert.equal(field(name, key).isRequired, true);
  assert.ok(model(name).uniqueFields.some(keys => keys.join(',') === 'scopeId,taskId,requestId'));
  assert.ok(model(name).uniqueFields.some(keys => keys.join(',') === 'scopeId,taskId,submissionKey'));
  assert.equal(model(name).fields.some(item => /approval|confirmed/i.test(item.name)), false);
});
test('clarification migration is additive and never backfills grants or receipts for old tasks', () => {
  const sql = source.migration('20261006030000_ai_task_input_receipts');
  assert.match(sql, /CREATE TABLE `ai_task_input_requests`/);
  assert.match(sql, /CREATE TABLE `ai_task_input_receipts`/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|INSERT INTO|UPDATE `/i);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
});
test('original schema 644cb541 validates and adds input receipts to fixed 0229de59', () => {
  const root = path.resolve(__dirname, '..');
  const before = execFileSync('git', ['show', '0229de59:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const after = execFileSync('git', ['show', '644cb541f38522bbe0c09280389890f0a68a2dd1:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const result = offlinePrismaSchema(after, before);
  assert.equal(result.violations, '');
  assert.match(result.diff, /CREATE TABLE `ai_task_input_requests`/);
  assert.match(result.diff, /CREATE TABLE `ai_task_input_receipts`/);
  assert.doesNotMatch(result.diff, /DROP TABLE|DROP COLUMN/);
});
