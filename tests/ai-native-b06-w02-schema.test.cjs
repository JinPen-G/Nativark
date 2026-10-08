'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { parseSchema, compareSchemaToMigrations } = require('../scripts/ai-native-b06-schema-check.cjs');
test('schema parser extracts model table maps, unique declarations and Char samples', () => {
  const models = parseSchema('model User {\n id String @id\n name String @db.Char(12)\n @@unique([name])\n @@map("users")\n}');
  assert.deepEqual(models, [{ model: 'User', table: 'users', uniques: ['name'], charFields: ['name:12'] }]);
});
test('schema comparison reports differences without deciding which source is authoritative', () => {
  const result = compareSchemaToMigrations('model A { id String @id @@map("a") } model B { id String @id @@map("b") }', [{ tables: ['a', 'c'] }]);
  assert.deepEqual(result.onlyInSchema, ['b']); assert.deepEqual(result.onlyInMigrations, ['c']);
});
