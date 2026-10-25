// Pure CSV behavior: no browser, network, environment files or database.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../apps/admin/src/components/ui/data-table/listTransfer.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = new Module(filename, module); compiled.filename = filename; compiled.paths = module.paths; compiled._compile(source, filename);
const { parseCsv, encodeCsv, importRecords, CSV_LIMITS, defineListImport } = compiled.exports;
test('CSV round trip preserves Unicode, commas, quotes, multiline content, numbers and BOM', () => {
  const rows = [['code', 'name', 'qty'], ['CAM-1', '相机, "标准"\n套装', 0]];
  assert.deepEqual(parseCsv(encodeCsv(rows)), [['code', 'name', 'qty'], ['CAM-1', '相机, "标准"\n套装', '0']]);
});
test('exports neutralize spreadsheet formula prefixes without changing numeric negatives', () => {
  const [row] = parseCsv(encodeCsv([['=1+1', '\t+cmd', '@formula', '-SUM(A1)', -2]]));
  assert.deepEqual(row, ["'=1+1", "'\t+cmd", "'@formula", "'-SUM(A1)", '-2']);
});
test('imports reject unknown/duplicate headers, mismatched rows, required blanks and malformed quotes', () => {
  const fields = [{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name' }];
  for (const text of ['code,id\nA,remote-id', 'code,code\nA,B', 'code,name\nA', 'code,name\n,B', 'code,name\nA,"broken', 'code,name\nA,"x"junk', 'code,name\nA,\u0000']) assert.throws(() => importRecords(text, fields));
  assert.deepEqual(importRecords('code,name\r\n A , 相机 ', fields), [{ code: 'A', name: '相机' }]);
});
test('imports cap row counts before any domain request', () => {
  const fields = [{ key: 'code', label: 'Code', required: true }];
  assert.equal(importRecords('code\n' + Array.from({ length: CSV_LIMITS.rows }, (_, i) => i).join('\n'), fields).length, 500);
  assert.throws(() => importRecords('code\n' + Array.from({ length: 501 }, (_, i) => i).join('\n'), fields));
});
test('typed import bridge submits the validated payload, never the raw CSV record', async () => {
  let received;
  const config = defineListImport({ fields: [], filename: 'fixture', parse: value => ({ count: Number(value.count) }), key: value => String(value.count), existingKeys: async () => [], create: async value => { received = value; }, allowed: () => true, onComplete: async () => {} });
  const parsed = config.parse({ count: '42', id: 'ignored' }); await config.create(parsed);
  assert.deepEqual(received, { count: 42 });
});
