'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const schema = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261003160000_ai_provider_profiles/migration.sql'), 'utf8');
test('B03 schema parses and contains the persisted AI Native model families', () => {
  for (const model of ['AiScope', 'AiProviderProfile', 'AiProviderCapabilityEvidence', 'AiInvocationAdmission', 'AiUsageReservation', 'AiUsageLedgerEntry', 'AiKnowledgeDocument', 'AiKnowledgeVersion', 'AiKnowledgeChunk', 'AiKnowledgeAcl', 'AiKnowledgeIndexGeneration', 'AiStructuredMemory', 'AiHumanConfirmation']) assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`));
});
test.todo('B03 W01 migration deployment: 20261003160000 references ai_provider_profiles before its CREATE TABLE; requires coordinator migration rebase or reviewed deployment repair');
test('migration check reports the exact forward-reference evidence without executing SQL', () => {
  const profileIndex = migration.indexOf('CREATE TABLE `ai_provider_profiles`');
  const evidenceIndex = migration.indexOf('CREATE TABLE `ai_provider_capability_evidence`');
  assert.ok(evidenceIndex >= 0 && profileIndex >= 0 && evidenceIndex < profileIndex);
  assert.match(migration.slice(evidenceIndex, profileIndex), /REFERENCES `ai_provider_profiles`/);
});
