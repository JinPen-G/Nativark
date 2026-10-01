const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const editor = read('apps/admin/src/components/ui/RichTextEditor.tsx');
assert.ok(editor.includes('arc-rich-columns'));
assert.ok(editor.includes('htmlToMarkdown(html)'));
assert.ok(editor.includes('onHistoryChange={setHistory}'));
assert.ok(editor.includes('CLIENT_RICH_TEXT_PREFIX + JSON.stringify(nodesFor(result.html))'));
assert.ok(!editor.includes('dangerouslySetInnerHTML'));
assert.ok(!editor.includes('<Tabs'));
const pagination = read('apps/admin/src/components/ui/Pagination.tsx');
assert.ok(pagination.includes('<ArcPagination'));
assert.ok(pagination.includes('props.showQuickJumper &&'));
assert.ok(!/if \([^\n]*showQuickJumper[^\n]*AntPagination/.test(pagination));
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.tsx') && !file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'antd') continue;
        for (const item of node.importClause?.namedBindings?.elements ?? []) {
          assert.ok(!['Table', 'Pagination'].includes((item.propertyName ?? item.name).text), `Direct Ant paging import: ${file}`);
        }
      }
    }
  }
}
walk(path.join(root, 'apps/admin/src'));
const originals = new Set();
for (const entry of JSON.parse(read('packages/ui-arc/manifest.json')).entries) {
  for (const file of entry.files ?? []) {
    if (!file.normalizedSha256) continue;
    const content = read(`packages/ui-arc/vendor/${file.path}`).replace(/\r\n/g, '\n').trimEnd();
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), file.normalizedSha256, file.path);
    originals.add(file.path);
  }
}
console.log(`admin-rich-pagination: layout/import guards and ${originals.size} original source hashes passed (static guards, not browser acceptance)`);
