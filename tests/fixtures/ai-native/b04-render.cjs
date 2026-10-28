'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../apps/admin/src/features/ai-native');
const uiStub = path.resolve(__dirname, 'b05-ui-stub.cjs');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFeatureUi(request, parent, isMain, options) { return request === '@/components/ui' ? uiStub : resolveFilename.call(this, request, parent, isMain, options); };
require.extensions['.ts'] = function featureTsExtension(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
require.extensions['.tsx'] = require.extensions['.ts'];
// Feature layout modules have no behavior in this offline renderer.
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
/** Offline transpilation of feature source; React itself is the installed real runtime. */
exports.loadFeature = function loadFeature(name) {
  const filename = path.resolve(root, name);
  if (!filename.startsWith(root + path.sep)) throw new Error('outside feature boundary');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
};
