'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { offlinePrismaSchema } = require('./fixtures/ai-native/prisma-offline.cjs');
const root = path.resolve(__dirname, '..'), prisma = path.join(root, 'apps/api/prisma');
const model = name => Prisma.dmmf.datamodel.models.find(item => item.name === name);
const field = (name, key) => model(name).fields.find(item => item.name === key);

test('task resource limits have explicit initialization and distinct reserved/consumed counters', () => {
  const name = 'AiTaskExecutionBudget';
  assert.deepEqual(model(name).primaryKey.fields, ['scopeId', 'taskId']);
  for (const key of ['Steps', 'Calls', 'ActiveMs', 'OutputBytes']) {
    const limit = field(name, `max${key}`);
    assert.equal(limit.type, 'BigInt'); assert.equal(limit.isRequired, true); assert.equal(limit.hasDefaultValue, false);
    for (const prefix of ['reserved', 'consumed']) assert.equal(field(name, `${prefix}${key}`).type, 'BigInt');
  }
  assert.equal(field(name, 'policyVersion').isRequired, true);
  assert.equal(field(name, 'policyFingerprint').isRequired, true);
});
test('resource charges and invocation bindings retain composite scope relations', () => {
  const charge = 'AiTaskExecutionCharge', invocation = 'AiGatewayInvocation';
  assert.deepEqual(model(charge).primaryKey.fields, ['scopeId', 'taskId', 'chargeId']);
  assert.deepEqual(field(charge, 'budget').relationFromFields, ['scopeId', 'taskId']);
  assert.deepEqual(field(charge, 'run').relationFromFields, ['scopeId', 'taskId', 'runId']);
  assert.deepEqual(field(charge, 'step').relationFromFields, ['scopeId', 'taskId', 'stepId']);
  assert.deepEqual(field(charge, 'gatewayInvocation').relationFromFields, ['scopeId', 'taskId', 'gatewayInvocationId']);
  assert.deepEqual(field(invocation, 'step').relationFromFields, ['scopeId', 'taskId', 'actionId', 'stepFingerprint']);
  assert.deepEqual(field(invocation, 'run').relationFromFields, ['scopeId', 'taskId', 'runId']);
  assert.equal(field(charge, 'fencingToken').type, 'Decimal');
  assert.equal(field(charge, 'amount').type, 'BigInt');
  assert.equal(model(charge).fields.some(item => /money|currency/i.test(item.name)), false);
  assert.equal(field('AiBudgetReservation', 'configurationHash').isRequired, false);
});
test('new migrations preserve legacy rows and do not initialize implicit unlimited policies', () => {
  const names = ['20261005030000_ai_budget_configuration_binding', '20261005040000_ai_gateway_invocation_binding', '20261005050000_ai_task_execution_resources'];
  const sql = names.map(name => fs.readFileSync(path.join(prisma, 'migrations', name, 'migration.sql'), 'utf8')).join('\n');
  assert.match(sql, /ADD COLUMN `configurationHash` CHAR\(64\) NULL/);
  assert.match(sql, /UNIQUE INDEX `ai_gateway_invocations_scope_step_key`/);
  assert.match(sql, /PRIMARY KEY \(`scopeId`, `taskId`, `chargeId`\)/);
  assert.match(sql, /`status` ENUM\('reserved','recorded','unknown'\)/);
  assert.doesNotMatch(sql, /\bDROP\b|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+`/i);
  assert.doesNotMatch(sql, /max(?:Steps|Calls|ActiveMs|OutputBytes)`[^\n]+DEFAULT/i);
});
test('Prisma validates and produces an additive offline diff from the handed-off schema', () => {
  const schema = fs.readFileSync(path.join(prisma, 'schema.prisma'), 'utf8');
  const before = execFileSync('git', ['show', '124f5e80:apps/api/prisma/schema.prisma'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const result = offlinePrismaSchema(schema, before);
  assert.equal(result.violations, '');
  for (const table of ['ai_gateway_invocations', 'ai_task_execution_budgets', 'ai_task_execution_charges']) assert.ok(result.diff.includes(`CREATE TABLE \`${table}\``));
  assert.match(result.diff, /ADD COLUMN `configurationHash` CHAR\(64\) NULL/);
  assert.doesNotMatch(result.diff, /DROP TABLE|DROP COLUMN/);
});
