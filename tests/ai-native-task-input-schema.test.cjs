'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { offlinePrismaSchema } = require('./fixtures/ai-native/prisma-offline.cjs');
const model = name => { const row = Prisma.dmmf.datamodel.models.find(item => item.name === name); assert.ok(row, `${name} must be persisted`); return row; };
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
  const sql = fs.readFileSync(path.resolve(__dirname, '../apps/api/prisma/migrations/20261006030000_ai_task_input_receipts/migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE `ai_task_input_requests`/);
  assert.match(sql, /CREATE TABLE `ai_task_input_receipts`/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|INSERT INTO|UPDATE `/i);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
});
test('new schema validates and generates only additive differences from fixed 0229de59', () => {
  const root = path.resolve(__dirname, '..');
  const before = execFileSync('git', ['show', '0229de59:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const after = fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  const result = offlinePrismaSchema(after, before);
  assert.equal(result.violations, '');
  assert.match(result.diff, /CREATE TABLE `ai_task_input_requests`/);
  assert.match(result.diff, /CREATE TABLE `ai_task_input_receipts`/);
  assert.doesNotMatch(result.diff, /DROP TABLE|DROP COLUMN/);
});
