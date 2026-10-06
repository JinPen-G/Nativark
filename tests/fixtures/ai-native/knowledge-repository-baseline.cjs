'use strict';
// Optional, fixed historical implementation replay. It never changes source files.
exports.load = (filename, normalLoad) => {
  if (process.env.AI_KNOWLEDGE_CAS_BASELINE !== '6df65cd1') return normalLoad();
  const path = require('node:path'), Module = require('node:module');
  const root = path.resolve(__dirname, '../../..');
  const absolute = path.resolve(root, filename);
  const source = require('node:child_process').execFileSync('git', ['show', `6df65cd1:${filename}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const code = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText;
  const loaded = new Module(absolute, module);
  loaded.filename = absolute; loaded.paths = Module._nodeModulePaths(path.dirname(absolute));
  loaded._compile(code, absolute); return loaded.exports;
};
