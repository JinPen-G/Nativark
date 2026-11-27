'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { analyzeMigrationSource } = require('./ai-native-b06-migration-check.cjs');
function parseSchema(schema) {
  const models = [];
  for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\}/gmi)) {
    const body = match[2]; const map = body.match(/@@map\("([^"]+)"\)/);
    const uniques = [...body.matchAll(/@@unique\s*\(\[([^\]]+)\]/g)].map(item => item[1].trim());
    const charFields = [...body.matchAll(/^\s*(\w+)\s+[^\n]*@db\.Char\((\d+)\)/gmi)].map(item => `${item[1]}:${item[2]}`);
    models.push({ model: match[1], table: map ? map[1] : match[1], uniques, charFields });
  }
  return models;
}
function migrationTables(reports) { return [...new Set(reports.flatMap(report => report.tables))].sort(); }
function compareSchemaToMigrations(schema, reports) {
  const models = parseSchema(schema); const tables = migrationTables(reports);
  const modelTables = models.map(model => model.table.toLowerCase()).sort();
  return { models, migrationTables: tables, onlyInSchema: modelTables.filter(table => !tables.includes(table)), onlyInMigrations: tables.filter(table => !modelTables.includes(table)) };
}
if (require.main === module) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/ai-native-b06-schema-check.cjs <schema.prisma> <migration.sql|migrations-directory>');
  const report = compareSchemaToMigrations(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'), analyzeMigrationSource(process.argv[3]));
  process.stdout.write(JSON.stringify({ tool: 'ai-native-b06-schema-check', ...report }, null, 2) + '\n');
}
module.exports = { parseSchema, compareSchemaToMigrations };
