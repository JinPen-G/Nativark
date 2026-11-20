'use strict';
// Only the build's allowlisted shared source reaches this loader. Type safety
// is checked separately by the original private-declaration/mini tsc pipeline.
module.exports = function compileSharedRuntime(source) {
  if (this.resourcePath.endsWith('.js')) return source;
  const ts = require('typescript');
  const { rentalEntry } = this.getOptions();
  if (this.resourcePath === rentalEntry) {
    // Shared's Core compatibility entry needs the original contract constants.
    // Keep that actual export statement, leaving other Core contributions out
    // of the native bundle. New entry side effects require a separate review.
    const parsed = ts.createSourceFile(this.resourcePath, source, ts.ScriptTarget.Latest, true);
    if (parsed.parseDiagnostics.length || parsed.statements.some(node => !ts.isExportDeclaration(node)))
      throw Error('Rental public entry is no longer a pure export module');
    const contracts = parsed.statements.filter(node => !node.isTypeOnly && !node.exportClause
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './contracts');
    if (contracts.length !== 1) throw Error('Rental contract constants lack their original public export');
    source = contracts[0].getFullText(parsed);
  }
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: {
    target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext,
    sourceMap: false, declaration: false, removeComments: false
  } }).outputText;
};
