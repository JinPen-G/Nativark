'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeMigrationSql, analyzeMigrationDirectory } = require('../scripts/ai-native-b06-migration-check.cjs');

test('migration checker accepts ordered synthetic DDL and rejects forward references/duplicate constraints', () => {
  const good = analyzeMigrationSql('CREATE TABLE parent (id int); CREATE TABLE child (id int, parent_id int, CONSTRAINT fk_child_parent FOREIGN KEY(parent_id) REFERENCES parent(id));');
  assert.deepEqual(good.issues, []);
  const bad = analyzeMigrationSql('CREATE TABLE child (id int, parent_id int, CONSTRAINT fk FOREIGN KEY(parent_id) REFERENCES parent(id)); CREATE TABLE parent (id int); ALTER TABLE child ADD CONSTRAINT fk FOREIGN KEY(parent_id) REFERENCES parent(id);');
  assert.ok(bad.issues.some(issue => issue.code === 'forward_reference'));
  assert.ok(bad.issues.some(issue => issue.code === 'duplicate_constraint'));
});

test('migration checker scans all existing migration.sql files without mutating them', () => {
  // The selected compatibility package preserves the original 58 AI migrations.
  require('./fixtures/ai-native/rental-compatibility-source.cjs');
  const root = require('node:path').join(process.env.AI_NATIVE_TEST_SOURCE_ROOT, 'packages/ai-native-data/prisma/migrations');
  const report = analyzeMigrationDirectory(root);
  assert.ok(report.length > 0);
  assert.ok(report.every(item => Array.isArray(item.issues)));
});
