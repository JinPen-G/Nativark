'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { execFileSync } = require('node:child_process');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { offlinePrismaSchema, publicAiSchemaHistory, prismaDatamodel } = require('./fixtures/ai-native/prisma-offline.cjs');
const source = publicAiSchemaHistory(), datamodel = prismaDatamodel(source.schema);
const root = path.resolve(__dirname, '..');
const model = name => { const row = datamodel.models.find(m => m.name === name); assert.ok(row); return row; };
test('actual public policy/input models bind scope, scene and the same persisted run', () => {
  assert.deepEqual(model('AiTaskPlanPolicy').primaryKey.fields, ['scopeId', 'sceneCode', 'sceneVersion']);
  const input = model('AiTaskActionInput');
  assert.deepEqual(input.primaryKey.fields, ['scopeId', 'taskId', 'runId', 'registrationRef']);
  assert.ok(input.uniqueFields.some(fields => fields.join(',') === 'scopeId,taskId,id'));
  assert.deepEqual(input.fields.find(f => f.name === 'run').relationFromFields, ['scopeId', 'taskId', 'runId']);
  assert.deepEqual(input.fields.find(f => f.name === 'run').relationToFields, ['scopeId', 'taskId', 'id']);
  assert.equal(input.fields.find(f => f.name === 'run').relationOnDelete, 'Restrict');
});
test('isolated offline validate/diff of original 82e3bbc8 exactly matches its additive migration', () => {
  const before = execFileSync('git', ['show', '7eaa03f446e16770c222aaede31a6f4f9f41e1a7:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const result = offlinePrismaSchema(execFileSync('git', ['show', '82e3bbc8954b80791c1a61d226a86ca644311089:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }), before);
  assert.equal(result.violations, '');
  assert.match(result.validation, /schema.*valid/iu);
  const sql = source.migration('20261006070000_ai_task_plan_policy_inputs');
  const normalize = value => value.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(sql), normalize(result.diff));
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|INSERT INTO|UPDATE `|CASCADE/i);
});
