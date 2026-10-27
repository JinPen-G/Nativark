'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const schema = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261003160000_ai_provider_profiles/migration.sql'), 'utf8');
test('B03 schema parses and contains the persisted AI Native model families', () => {
  for (const model of ['AiScope', 'AiProviderProfile', 'AiProviderCapabilityEvidence', 'AiInvocationAdmission', 'AiUsageReservation', 'AiUsageLedgerEntry', 'AiKnowledgeDocument', 'AiKnowledgeVersion', 'AiKnowledgeChunk', 'AiKnowledgeAcl', 'AiKnowledgeIndexGeneration', 'AiStructuredMemory', 'AiHumanConfirmation']) assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`));
});
test('B03 W01 repair: profile table is created before the evidence table that references it', () => {
  const profileIndex = migration.indexOf('CREATE TABLE `ai_provider_profiles`');
  const evidenceIndex = migration.indexOf('CREATE TABLE `ai_provider_capability_evidence`');
  assert.ok(evidenceIndex >= 0 && profileIndex >= 0 && profileIndex < evidenceIndex, 'profile table must be created before the evidence table that references it');
  const evidenceBlock = migration.slice(evidenceIndex);
  assert.match(evidenceBlock, /REFERENCES `ai_provider_profiles`/);
  const foundation = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261003060000_ai_task_foundation/migration.sql'), 'utf8');
  assert.doesNotMatch(migration, /CREATE TABLE (?:IF NOT EXISTS )?`ai_scopes`/u,
    'provider persistence must reuse the already-created canonical scope table');
  assert.match(foundation, /ADD CONSTRAINT `ai_scopes_shape` CHECK/u);
  assert.match(foundation, /UNIQUE INDEX `ai_scopes_id_kind`/u);
  assert.match(foundation, /REFERENCES `Tenant`\(`id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  const creates = [...(foundation + '\n' + migration).matchAll(/CREATE TABLE `([^`]+)`/gu)].map(match => match[1]);
  assert.equal(new Set(creates).size, creates.length, 'foundation and provider migrations must not recreate the same table');
  const directory = path.join(__dirname, '../apps/api/prisma/migrations');
  const alignment = fs.readFileSync(path.join(directory, '20261026100000_ai_migration_contract_alignment/migration.sql'), 'utf8');
  const history = fs.readdirSync(directory).filter(name => name !== '20261026100000_ai_migration_contract_alignment' && fs.existsSync(path.join(directory, name, 'migration.sql')))
    .map(name => fs.readFileSync(path.join(directory, name, 'migration.sql'), 'utf8')).join('\n');
  const replacements = [...alignment.matchAll(/ALTER TABLE `([^`]+)` DROP FOREIGN KEY `([^`]+)`,\s+ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\(([^)]+)\) ON DELETE (RESTRICT|CASCADE) ON UPDATE (RESTRICT|CASCADE);/gu)];
  assert.equal(replacements.length, 22, 'every FK replacement must be a single ALTER statement');
  assert.equal([...alignment.matchAll(/DROP FOREIGN KEY/gu)].length, replacements.length);
  assert.doesNotMatch(alignment, /DROP (?:TABLE|COLUMN|CHECK)|FOREIGN_KEY_CHECKS|\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+`/u);
  for (const [, table, original, , columns, parent, parentColumns, onDelete] of replacements) {
    const offset = history.indexOf(`CONSTRAINT \`${original}\` FOREIGN KEY (`);
    assert.ok(offset >= 0, `original FK must exist: ${table}.${original}`);
    const definition = history.slice(offset).match(/FOREIGN KEY \(([^)]+)\)\s+REFERENCES `([^`]+)`\s*\(([^)]+)\) ON DELETE (RESTRICT|CASCADE)/u);
    assert.ok(definition);
    assert.equal(columns.replace(/\s/gu, ''), definition[1].replace(/\s/gu, ''));
    assert.equal(parent, definition[2]);
    assert.equal(parentColumns.replace(/\s/gu, ''), definition[3].replace(/\s/gu, ''));
    assert.equal(onDelete, definition[4]);
  }
  assert.match(alignment, /ALTER COLUMN `ownerKind` DROP DEFAULT,\s+ALTER COLUMN `ownerId` DROP DEFAULT/u,
    'legacy owner values stay unchanged while new inserts must supply ownership');
});
