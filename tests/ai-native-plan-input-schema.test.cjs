'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { offlinePrismaSchema } = require('./fixtures/ai-native/prisma-offline.cjs');
const root = path.resolve(__dirname, '..');
const model = name => { const row = Prisma.dmmf.datamodel.models.find(m => m.name === name); assert.ok(row); return row; };
test('actual generated policy/input models bind scope, scene and the same persisted run', () => {
  assert.deepEqual(model('AiTaskPlanPolicy').primaryKey.fields, ['scopeId', 'sceneCode', 'sceneVersion']);
  const input = model('AiTaskActionInput');
  assert.deepEqual(input.primaryKey.fields, ['scopeId', 'taskId', 'runId', 'registrationRef']);
  assert.ok(input.uniqueFields.some(fields => fields.join(',') === 'scopeId,taskId,id'));
  assert.deepEqual(input.fields.find(f => f.name === 'run').relationFromFields, ['scopeId', 'taskId', 'runId']);
  assert.deepEqual(input.fields.find(f => f.name === 'run').relationToFields, ['scopeId', 'taskId', 'id']);
  assert.equal(input.fields.find(f => f.name === 'run').relationOnDelete, 'Restrict');
});
test('isolated offline validate/diff exactly matches the new additive migration', () => {
  const before = execFileSync('git', ['show', '7eaa03f446e16770c222aaede31a6f4f9f41e1a7:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const result = offlinePrismaSchema(fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8'), before);
  assert.equal(result.violations, '');
  assert.match(result.validation, /schema.*valid/iu);
  const sql = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations/20261006070000_ai_task_plan_policy_inputs/migration.sql'), 'utf8');
  const normalize = value => value.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(sql), normalize(result.diff));
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|INSERT INTO|UPDATE `|CASCADE/i);
});
