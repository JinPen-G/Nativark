'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const source = require('./fixtures/ai-native/prisma-offline.cjs').publicAiSchemaHistory();
// Static structural evidence only; no SQL is executed by this test.
test('append-only tenant config migration has its referenced table earlier in the actual migration history', () => {
  const target = '20261005010000_ai_tenant_model_configuration';
  const previous = source.history({ before: target });
  assert.match(previous, /CREATE TABLE\s+`Tenant`/i);
  const sql = source.migration(target);
  assert.match(sql, /CREATE TABLE `ai_tenant_model_configurations`/);
  assert.match(sql, /`revision` INTEGER UNSIGNED NOT NULL DEFAULT 1/);
  assert.match(sql, /PRIMARY KEY \(`tenantId`\)/);
  assert.match(sql, /REFERENCES `Tenant` \(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.doesNotMatch(sql, /UPDATE\s+`?(?:SystemParameterSet|TenantIntegrationConfig)`?|DELETE\s+FROM|DROP\s+TABLE/i);
});
test('actual schema and appended SQL agree on storage widths and nullable ciphertext/settings', () => {
  const schema = source.schema;
  const model = schema.match(/model AiTenantModelConfiguration \{([\s\S]*?)\n\}/)[1];
  const sql = source.migration('20261005010000_ai_tenant_model_configuration');
  assert.match(model, /tenantId\s+String\s+@id @db\.VarChar\(191\)/);
  assert.match(sql, /`tenantId` VARCHAR\(191\) NOT NULL/);
  assert.match(model, /credentialsEncrypted\s+String\?\s+@db\.Text/);
  assert.match(sql, /`credentialsEncrypted` TEXT NULL/);
  assert.match(model, /settings\s+Json\?/);
  assert.match(sql, /`settings` JSON NULL/);
  assert.match(model, /revision\s+Int\s+@default\(1\) @db\.UnsignedInt/);
});
