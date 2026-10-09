'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Emit only private declarations from this checkout. Never refresh the linked
// package's dist/node_modules or widen the mini-program's source root.
function prepareMiniprogramSharedTypes(appRoot) {
  const root = path.resolve(appRoot, '../..');
  if (!['miniprogram', 'staff-miniprogram'].includes(path.basename(appRoot))
    || path.dirname(appRoot) !== path.join(root, 'apps')) throw Error('Unexpected mini-program root');
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const source = path.join(root, 'packages/shared/src');
  const parent = path.join(root, 'output');
  fs.mkdirSync(parent, { recursive: true });
  const destination = fs.mkdtempSync(path.join(parent, 'miniprogram-shared-types-'));
  const config = ts.readConfigFile(path.join(root, 'packages/shared/tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(path.join(source, '../tsconfig.json')), {
    rootDir: source, outDir: destination, declarationDir: destination,
    composite: false, incremental: false, noEmit: false, declaration: true,
    emitDeclarationOnly: true, noEmitOnError: true
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  const emitted = program.emit();
  if (emitted.emitSkipped || emitted.diagnostics.length) throw Error('Private shared declaration emission failed');
  const entry = path.join(destination, 'index.d.ts');
  if (!fs.existsSync(entry)) throw Error('Private shared declarations missing index');
  const appConfig = path.join(destination, `${path.basename(appRoot)}.json`);
  fs.writeFileSync(appConfig, JSON.stringify({ extends: path.join(appRoot, 'tsconfig.json'), compilerOptions: {
    baseUrl: appRoot, paths: { '@rental-os/shared': [entry] }
  } }, null, 2));
  return appConfig;
}
module.exports = { prepareMiniprogramSharedTypes };
