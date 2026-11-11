'use strict';
// Only the build's allowlisted shared source reaches this loader. Type safety
// is checked separately by the original private-declaration/mini tsc pipeline.
module.exports = function compileSharedRuntime(source) {
  const ts = require('typescript');
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: {
    target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext,
    sourceMap: false, declaration: false, removeComments: false
  } }).outputText;
};
