'use strict';
const fs = require('node:fs');
const path = require('node:path');

function normalize(name) { return name.replace(/[`${\[\]]/g, '').split('.').pop().toLowerCase(); }
function analyzeMigrationSql(sql, name = 'inline') {
  const created = new Map(); const issues = []; const constraints = new Map();
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean);
  statements.forEach((statement, index) => {
    const tableMatch = statement.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?[`\[]?([\w-]+)[`\]]?/i);
    if (tableMatch) {
      const table = normalize(tableMatch[1]);
      if (created.has(table)) issues.push({ code: 'duplicate_table', table, statement: index + 1 });
      created.set(table, index);
    }
    for (const match of statement.matchAll(/\bconstraint\s+[`\[]?([\w-]+)[`\]]?/gi)) {
      const constraint = normalize(match[1]);
      if (constraints.has(constraint)) issues.push({ code: 'duplicate_constraint', constraint, statement: index + 1 });
      constraints.set(constraint, index);
    }
    for (const match of statement.matchAll(/\breferences\s+[`\[]?([\w-]+)[`\]]?/gi)) {
      const referenced = normalize(match[1]);
      if (!created.has(referenced) || created.get(referenced) > index)
        issues.push({ code: 'forward_reference', referenced, statement: index + 1 });
    }
    if (/\b(create|alter|drop)\s+table\b/i.test(statement) && !/\btable\b[\s\S]*\(/i.test(statement) && !/\btable\b[\s\S]*\badd\b/i.test(statement))
      issues.push({ code: 'unparseable_table_statement', statement: index + 1 });
  });
  return { name, statements: statements.length, tables: [...created.keys()], constraints: [...constraints.keys()], issues };
}
function analyzeMigrationDirectory(root) {
  const files = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, 'migration.sql');
    if (fs.existsSync(file)) files.push(file);
  }
  return files.sort().map(file => analyzeMigrationSql(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
}
if (require.main === module) {
  const root = path.resolve(process.cwd(), 'apps/api/prisma/migrations');
  const report = analyzeMigrationDirectory(root);
  const issues = report.flatMap(item => item.issues.map(issue => ({ file: item.name, ...issue })));
  const result = { tool: 'ai-native-b06-migration-check', files: report.length, issues, reports: report };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = issues.length ? 1 : 0;
}
module.exports = { analyzeMigrationSql, analyzeMigrationDirectory };
