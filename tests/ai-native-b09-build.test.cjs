'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
test('legal bundles the actual local parser without changing parser behavior', () => {
  const emitted = fs.readFileSync(path.join(root, 'apps/miniprogram/dist/pages/legal/index.js'), 'utf8');
  assert.doesNotMatch(emitted, /@rental-os\/shared/);
  assert.match(emitted, /vendor\/shared-rich-text\/client-rich-text/);
  const source = fs.readFileSync(path.join(root, 'packages/shared/src/client-rich-text.ts'), 'utf8');
  const expected = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS}}).outputText;
  const actual = fs.readFileSync(path.join(root, 'apps/miniprogram/dist/vendor/shared-rich-text/client-rich-text.js'), 'utf8');
  assert.equal(actual.replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'));
  const parser = require('../apps/miniprogram/dist/vendor/shared-rich-text/client-rich-text.js');
  assert.equal(parser.parseClientRichText('plain text'), null);
  assert.equal(parser.safeDocumentHref('javascript:alert(1)'), false);
});
