'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pending = new Map();

function disposeMiniprogramSharedTypes(configPath) {
  const owned = pending.get(configPath);
  if (!owned) return;
  const { destination, parent, expectedParent, projectRoot } = owned;
  if (fs.existsSync(destination)) {
    const actual = fs.realpathSync(destination), relative = path.relative(projectRoot, actual);
    if (fs.realpathSync(parent) !== expectedParent || path.dirname(actual) !== expectedParent
      || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || !path.basename(actual).startsWith('miniprogram-shared-types-')
      || fs.lstatSync(destination).isSymbolicLink()) throw Error('Refusing cleanup outside owned private declaration directory');
    fs.rmSync(actual, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    if (fs.existsSync(actual)) throw Error(`Private declaration cleanup incomplete: ${actual}`);
  }
  pending.delete(configPath);
}
// Also covers existing callers that exit after a failed child compiler.
process.once('exit', () => {
  for (const config of [...pending.keys()]) {
    try { disposeMiniprogramSharedTypes(config); }
    catch (error) { process.stderr.write(`[private shared types] ${error.message}\n`); process.exitCode = 1; }
  }
});
// Normal cancellation must reach the same owned-directory cleanup as a failed
// compiler. An uncatchable process termination still needs the next-run audit.
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));

// Emit only private declarations from this checkout. Never refresh the linked
// package's dist/node_modules or widen the mini-program's source root.
function prepareMiniprogramSharedTypes(appRoot) {
  const root = path.resolve(appRoot, '../..');
  if (!['miniprogram', 'staff-miniprogram'].includes(path.basename(appRoot))
    || path.dirname(appRoot) !== path.join(root, 'apps')) throw Error('Unexpected mini-program root');
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const source = path.join(root, 'packages/shared/src');
  const parent = process.env.AI_OFFLINE_WRITE_ROOT ? path.resolve(process.env.AI_OFFLINE_WRITE_ROOT) : path.join(root, 'output', '.tmp');
  const relative = path.relative(path.join(root, 'output'), parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Private declaration root must stay in project output');
  let ancestor = parent;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(root), realAncestor = fs.realpathSync(ancestor), realRelative = path.relative(realRoot, realAncestor);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw Error('Private declaration parent escapes project');
  fs.mkdirSync(parent, { recursive: true });
  const destination = fs.mkdtempSync(path.join(parent, 'miniprogram-shared-types-'));
  const appConfig = path.join(destination, `${path.basename(appRoot)}.json`);
  pending.set(appConfig, { destination, parent, expectedParent: fs.realpathSync(parent), projectRoot: realRoot });
  try {
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
  fs.writeFileSync(appConfig, JSON.stringify({ extends: path.join(appRoot, 'tsconfig.json'), compilerOptions: {
    baseUrl: appRoot, paths: { '@rental-os/shared': [entry],
      '@rental-os/shared/miniprogram-client': [path.join(destination, 'miniprogram-client.d.ts')] }
  } }, null, 2));
  return appConfig;
  } catch (error) {
    disposeMiniprogramSharedTypes(appConfig);
    throw error;
  }
}
module.exports = { prepareMiniprogramSharedTypes, disposeMiniprogramSharedTypes };
