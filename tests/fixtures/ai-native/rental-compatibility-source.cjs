'use strict';
/** Original mixed AI tests select one prepared independent Rental workspace.
 * Only declared exports and that workspace's explicit schema are consumed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createControllerSourceLoader, checkedPath } = require('../../../scripts/controller-sources.cjs');

assert.ok(process.env.AI_NATIVE_TEST_SOURCE_ROOT,
  'Mixed AI tests require AI_NATIVE_TEST_SOURCE_ROOT from a fixed full Rental development workspace with AI and original tests');
const root = fs.realpathSync(path.resolve(process.env.AI_NATIVE_TEST_SOURCE_ROOT));
const receipt = JSON.parse(fs.readFileSync(checkedPath(root, 'development.workspace.json'), 'utf8'));
assert.equal(receipt.format, 'nativark-core-development-source-2');
assert.equal(receipt.profile, 'full');
assert.equal(receipt.mode, 'development');
assert.equal(receipt.host, 'rental');
assert.equal(receipt.ai, true);
assert.equal(receipt.verification?.suite, 'rental-original');
for (const source of [receipt.platform?.source, receipt.core?.source]) {
  assert.match(source?.commit ?? '', /^[a-f0-9]{40}$/u);
  assert.ok(source?.repository, 'Prepared sources require their original repository identity');
}
assert.notEqual(receipt.platform.source.repository.toLowerCase(), receipt.core.source.repository.toLowerCase());
for (const [directory, name] of [['ai-native-server', '@rental-os/ai-native-server'], ['shared', '@rental-os/shared']]) {
  const manifest = JSON.parse(fs.readFileSync(checkedPath(root, `packages/${directory}/package.json`), 'utf8'));
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, '0.1.0', 'Mixed tests require the independent compatibility package');
}
const dependencyDirectory = path.join(path.resolve(process.env.AI_NATIVE_TEST_TOOLCHAIN_ROOT || root), 'node_modules');
const schemaPath = process.env.AI_NATIVE_TEST_SCHEMA && checkedPath(root, process.env.AI_NATIVE_TEST_SCHEMA);
const loader = createControllerSourceLoader(root, dependencyDirectory, schemaPath ? { schemaPath } : {});
const from = path.join(root, 'package.json');
function load(name) {
  assert.ok(name.startsWith('@rental-os/'), 'Compatibility consumers must use declared project exports');
  return loader.load(loader.resolveSource(from, name, true));
}
let prepared;
function prepare() {
  assert.ok(schemaPath, 'Persisted mixed AI tests require AI_NATIVE_TEST_SCHEMA from the selected workspace');
  // Reuse the existing official WASM/Client loader entirely in memory. This
  // neither constructs a PrismaClient nor generates a disk dependency tree.
  prepared ??= loader.prepareOfflinePrisma();
  return prepared;
}
module.exports = { load, prepare };
