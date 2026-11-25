'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const repoRoot = path.resolve(__dirname, '../../..');
const root = path.resolve(__dirname, '../../../apps/admin/src/features/ai-native');
const aiRoot = path.join(repoRoot, 'packages/ai-native-admin');
const sourceLoader = require('../../../scripts/controller-sources.cjs').createControllerSourceLoader(
  repoRoot, path.dirname(path.dirname(require.resolve('typescript/package.json'))));
const uiStub = path.resolve(__dirname, 'b05-ui-stub.cjs');
const resolveFilename = Module._resolveFilename;
function selectedAiSource(request) {
  const manifest = JSON.parse(fs.readFileSync(path.join(aiRoot, 'package.json'), 'utf8'));
  const entry = manifest.exports['.' + request.slice('@rental-os/ai-native-admin'.length)];
  if (typeof entry !== 'string' || !/^\.\/src\//.test(entry)) throw new Error('Undeclared AI presentation source: ' + request);
  const file = path.resolve(aiRoot, entry);
  if (!file.startsWith(path.join(aiRoot, 'src') + path.sep)) throw new Error('AI source escaped package');
  return file;
}
Module._resolveFilename = function resolveFeatureUi(request, parent, isMain, options) {
  if (request === '@/components/ui' || request === '@rental-os/platform-admin/ui') return uiStub;
  if (request === '@/app/locale' || request === '@rental-os/platform-admin/locale') return uiStub;
  if (request.startsWith('@rental-os/ai-native-admin/')) return selectedAiSource(request);
  if (request.startsWith('@rental-os/')) return sourceLoader.resolveSource(parent?.filename ?? __filename, request, true);
  return resolveFilename.call(this, request, parent, isMain, options);
};
require.extensions['.ts'] = function featureTsExtension(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
require.extensions['.tsx'] = require.extensions['.ts'];
// Feature layout modules have no behavior in this offline renderer.
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
/** Offline transpilation of feature source; React itself is the installed real runtime. */
exports.loadFeature = function loadFeature(name) {
  const original = path.resolve(root, name);
  if (!original.startsWith(root + path.sep)) throw new Error('outside feature boundary');
  const migrated = path.join(aiRoot, 'src/ai-native', name);
  const filename = fs.existsSync(migrated)
    ? selectedAiSource('@rental-os/ai-native-admin/source/ai-native/' + name.replace(/\.tsx?$/, '')) : original;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
};
