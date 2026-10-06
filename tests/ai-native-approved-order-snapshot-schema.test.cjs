'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { offlinePrismaSchema } = require('./fixtures/ai-native/prisma-offline.cjs');
const model = () => { const value = Prisma.dmmf.datamodel.models.find(row => row.name === 'AiApprovedOrderSnapshot'); assert.ok(value, 'approved snapshots need a persisted model'); return value; };
const root = path.resolve(__dirname, '..');
const migration = path.join(root, 'apps/api/prisma/migrations/20261006060000_ai_approved_order_snapshots/migration.sql');

test('approved snapshot identity and each action kind have immutable unique bindings', () => {
  assert.deepEqual(model().primaryKey.fields, ['scopeId', 'recordId', 'revision']);
  assert.ok(model().uniqueFields.some(fields => fields.join(',') === 'scopeId,taskId,proposalId,proposalRevision,actionId,kind'));
  for (const name of ['actionFingerprint', 'contentHash', 'payload', 'actorKind', 'actorId', 'audience', 'createdAt']) assert.equal(model().fields.find(field => field.name === name).isRequired, true);
  const kind = Prisma.dmmf.datamodel.enums.find(row => row.name === 'AiApprovedOrderSnapshotKind');
  assert.deepEqual(kind.values.map(value => [value.name, value.dbName]), [['INPUT', 'input'], ['PREVIEW', 'preview']]);
});
test('snapshot FK binds the same action fingerprint, task, scope and proposal version', () => {
  const action = model().fields.find(field => field.name === 'action');
  assert.deepEqual(action.relationFromFields, ['scopeId', 'taskId', 'proposalId', 'proposalRevision', 'actionId', 'actionFingerprint']);
  assert.deepEqual(action.relationToFields, ['scopeId', 'taskId', 'proposalId', 'proposalRevision', 'actionId', 'requestFingerprint']);
  assert.equal(action.relationOnDelete, 'Restrict');
  const target = Prisma.dmmf.datamodel.models.find(row => row.name === 'AiProposalAction');
  assert.ok(target.uniqueFields.some(fields => fields.join(',') === action.relationToFields.join(',')));
});
test('snapshot migration only adds storage and never seeds approvals or historical bodies', () => {
  const sql = fs.readFileSync(migration, 'utf8');
  assert.match(sql, /CREATE TABLE `ai_approved_order_snapshots`/);
  assert.match(sql, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|INSERT INTO|UPDATE `|CASCADE/i);
});
test('snapshot migration matches the validated schema delta from fixed 570b3faf', () => {
  model();
  const before = execFileSync('git', ['show', '570b3faf:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const result = offlinePrismaSchema(fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8'), before);
  assert.equal(result.violations, '');
  const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(fs.readFileSync(migration, 'utf8')), normalize(result.diff));
});
