'use strict';
// Mini-program build paths and private shared declarations stay in this checkout.
// Shared declarations are temporary; mini-program outputs use checked build paths.
const fs = require('node:fs');
const path = require('node:path');
const preparations = new Map();
const createdParents = new Set();

function workspace(appRoot) {
  appRoot = path.resolve(appRoot);
  const root = path.resolve(appRoot, '../..');
  if (!['miniprogram', 'staff-miniprogram'].includes(path.basename(appRoot))
    || path.dirname(appRoot) !== path.join(root, 'apps')) throw Error('Unexpected mini-program root');
  return root;
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkPath(root, target, scan = false) {
  target = path.resolve(target);
  if (!inside(root, target) || target === root) throw Error('Mini-program build path leaves its workspace');
  for (let ancestor = target; ancestor !== root; ancestor = path.dirname(ancestor)) {
    if (fs.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Mini-program build refuses linked paths');
  }
  if (scan && fs.existsSync(target)) {
    const pending = [target];
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const current = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw Error('Mini-program build refuses linked artifacts');
        if (entry.isDirectory()) pending.push(current);
      }
    }
  }
}

/** Default output remains the app's generated dist. Isolated builds may select a
 * child of the workspace's single task-temp root; never clear that root itself. */
function miniprogramBuildOutput(appRoot, args) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot), at = args.indexOf('--out-dir');
  if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--') || args.indexOf('--out-dir', at + 1) >= 0)) throw Error('Invalid mini-program --out-dir');
  const target = path.resolve(appRoot, at >= 0 ? args[at + 1] : 'dist');
  const temp = path.join(root, 'output', '.tmp'), relative = path.relative(temp, target);
  if (target !== path.join(appRoot, 'dist') && (!inside(temp, target) || relative.split(path.sep).length < 2)) throw Error('Mini-program output must be app dist or a task-temp child');
  if (process.env.AI_OFFLINE_WRITE_ROOT) {
    const writeRoot = path.resolve(process.env.AI_OFFLINE_WRITE_ROOT);
    if (!inside(writeRoot, target) || writeRoot === target) throw Error('Offline mini-program output must remain inside its task temp');
  }
  checkPath(root, target, true);
  return target;
}

function removeCheckedDirectory(root, target) {
  checkPath(root, target, true);
  if (!fs.existsSync(target)) return;
  const directories = [], pending = [target];
  while (pending.length) {
    const directory = pending.pop();
    checkPath(root, directory);
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Mini-program cleanup refuses linked artifacts');
      if (entry.isDirectory()) pending.push(file);
      else fs.unlinkSync(file);
    }
  }
  // Delete directories only after their files, and verify actual removal. A
  // recursive rm returning without an error is not sufficient cleanup evidence.
  for (const directory of directories.reverse()) fs.rmdirSync(directory);
  if (fs.existsSync(target)) throw Error('Mini-program build cleanup did not remove its directory');
}

function clearMiniprogramBuildOutput(appRoot, args) {
  const target = miniprogramBuildOutput(appRoot, args);
  removeCheckedDirectory(workspace(appRoot), target);
  return target;
}

function releaseMiniprogramSharedTypes(configFile) {
  if (!configFile) return;
  const owned = preparations.get(configFile);
  if (!owned) throw Error('Private shared declarations are not owned by this process');
  removeCheckedDirectory(owned.root, owned.destination);
  preparations.delete(configFile);
  if (createdParents.has(owned.parent) && fs.existsSync(owned.parent) && fs.readdirSync(owned.parent).length === 0) {
    checkPath(owned.root, owned.parent);
    fs.rmdirSync(owned.parent);
    createdParents.delete(owned.parent);
  }
}

// Emit only private declarations from this checkout. Never refresh the linked
// package's dist/node_modules or widen the mini-program's source root.
function prepareMiniprogramSharedTypes(appRoot) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot);
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const source = path.join(root, 'packages/shared/src');
  const parent = process.env.AI_OFFLINE_WRITE_ROOT ? path.resolve(process.env.AI_OFFLINE_WRITE_ROOT)
    : path.join(root, 'output', '.tmp', 'miniprogram-build');
  if (!inside(path.join(root, 'output', '.tmp'), parent) || parent === path.join(root, 'output', '.tmp')) throw Error('Private shared declarations require a task-temp root');
  checkPath(root, parent);
  const parentCreated = !fs.existsSync(parent);
  fs.mkdirSync(parent, { recursive: true });
  if (parentCreated) createdParents.add(parent);
  const destination = fs.mkdtempSync(path.join(parent, 'miniprogram-shared-types-'));
  const appConfig = path.join(destination, `${path.basename(appRoot)}.json`);
  preparations.set(appConfig, { root, parent, destination });
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
      baseUrl: appRoot, paths: { '@rental-os/shared': [entry] }
    } }, null, 2));
    return appConfig;
  } catch (error) {
    releaseMiniprogramSharedTypes(appConfig);
    throw error;
  }
}
process.once('exit', () => {
  for (const configFile of preparations.keys()) {
    try { releaseMiniprogramSharedTypes(configFile); }
    catch (error) { process.stderr.write(`[mini-program cleanup] ${error.message}\n`); process.exitCode = 1; }
  }
});
module.exports = { prepareMiniprogramSharedTypes, releaseMiniprogramSharedTypes, miniprogramBuildOutput, clearMiniprogramBuildOutput };
