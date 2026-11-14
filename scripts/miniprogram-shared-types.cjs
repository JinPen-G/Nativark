'use strict';
// Mini-program build paths and private shared declarations stay in this checkout.
// Shared declarations are temporary; approved public receipt values are packaged
// without implementing another matcher or exposing a package loader to WeChat.
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

/** Package the original public receipts and service selectors, from the same
 * Shared runtime module as the public entry. Only the named dependency-free
 * functions enter WeChat; pricing and service snapshots remain with Core. */
function emitMiniprogramSharedReceiptRuntime(appRoot, output) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot);
  if (path.basename(appRoot) !== 'miniprogram') throw Error('Receipt runtime is only configured for the customer mini-program');
  output = miniprogramBuildOutput(appRoot, ['--out-dir', output]);
  const sharedDist = path.join(root, 'packages', 'shared', 'dist');
  checkPath(root, sharedDist, true);
  const entry = require.resolve('@rental-os/shared', { paths: [appRoot, root] });
  const canonicalDist = fs.realpathSync(sharedDist);
  if (path.dirname(fs.realpathSync(entry)) !== canonicalDist) throw Error('Shared runtime does not belong to this checkout');
  const runtime = require(entry);
  const names = ['enterpriseExpenseRequestMatches', 'enterpriseExpenseRequestClosureMatches',
    'enterpriseExtensionRequestMatches', 'enterpriseExtensionRequestClosureMatches',
    'enterpriseExtensionServiceRequests', 'enterpriseExtensionServiceSelectionKey'];
  const candidates = Object.values(require.cache).filter(module => module.filename !== entry
    && module.filename.startsWith(canonicalDist + path.sep) && module.exports
    && names.every(name => typeof runtime[name] === 'function' && module.exports[name] === runtime[name]));
  if (candidates.length !== 1) throw Error('Shared receipt exports have no unambiguous canonical module');
  checkPath(root, candidates[0].filename);
  const source = fs.readFileSync(candidates[0].filename, 'utf8');
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const parsed = ts.createSourceFile('shared-enterprise-expense.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw Error('Shared receipt runtime syntax is invalid');
  const declarations = new Map(parsed.statements.filter(ts.isFunctionDeclaration).filter(node => node.name)
    .map(node => [node.name.text, node]));
  const assignments = new Map(), selected = new Set();
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const expression = statement.expression;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(expression.left)
      || !ts.isIdentifier(expression.left.expression) || expression.left.expression.text !== 'exports'
      || !names.includes(expression.left.name.text) || !ts.isIdentifier(expression.right)) continue;
    if (assignments.has(expression.left.name.text) || !declarations.has(expression.right.text)) throw Error('Shared receipt export origin changed');
    assignments.set(expression.left.name.text, statement);
    selected.add(expression.right.text);
  }
  if (assignments.size !== names.length) throw Error('Shared receipt runtime lacks its named export declarations');
  const body = [...selected].map(name => declarations.get(name).getFullText(parsed)).join('\n')
    + '\n' + names.map(name => assignments.get(name).getFullText(parsed)).join('\n');
  if (/\brequire\s*\(|\bimport\s*(?:\(|["'{*])/u.test(body)) throw Error('Shared receipt runtime dependencies require a new bundle review');
  const compiled = ts.transpileModule('"use strict";\n' + body, { fileName: 'shared-enterprise-expense.js', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS } });
  if (compiled.diagnostics?.length) throw Error('Shared receipt runtime compilation failed');
  const destination = path.join(output, 'vendor', 'shared-enterprise-expense');
  checkPath(root, destination, true);
  fs.mkdirSync(destination, { recursive: true });
  const runtimeFile = path.join(destination, 'enterprise-expense.js');
  fs.writeFileSync(runtimeFile, compiled.outputText);

  // Redirect only compiler-generated bindings used exclusively for these public
  // functions. Arbitrary/shared deep imports still fail the original build gate.
  const directories = [output];
  while (directories.length) {
    const directory = directories.pop();
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw Error('Mini-program build refuses linked artifacts');
      if (item.isDirectory()) { directories.push(file); continue; }
      if (!file.endsWith('.js') || file === runtimeFile) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!/require\(["']@rental-os\/shared["']\)/u.test(text)) continue;
      const script = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), replacements = [];
      for (const statement of script.statements.filter(ts.isVariableStatement)) {
        for (const declaration of statement.declarationList.declarations) {
          const call = declaration.initializer;
          if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'require'
            || call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0]) || call.arguments[0].text !== '@rental-os/shared') continue;
          if (!ts.isIdentifier(declaration.name)) throw Error('Unsupported Shared receipt import binding');
          let uses = 0;
          const visit = node => {
            if (ts.isIdentifier(node) && node.text === declaration.name.text && node !== declaration.name) {
              const parent = node.parent;
              if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node || !names.includes(parent.name.text))
                throw Error('Shared runtime import exceeds the named receipt and service selectors');
              uses += 1;
            }
            ts.forEachChild(node, visit);
          };
          visit(script);
          if (!uses) throw Error('Unused Shared runtime import cannot be bundled');
          let relative = path.relative(path.dirname(file), runtimeFile).replace(/\\/g, '/').replace(/\.js$/u, '');
          if (!relative.startsWith('.')) relative = './' + relative;
          replacements.push({ start: call.arguments[0].getStart(script), end: call.arguments[0].end, text: JSON.stringify(relative) });
        }
      }
      if (!replacements.length) throw Error('Unsupported Shared receipt runtime import');
      let rewritten = text;
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = rewritten.slice(0, replacement.start) + replacement.text + rewritten.slice(replacement.end);
      }
      fs.writeFileSync(file, rewritten);
    }
  }
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
      baseUrl: appRoot, paths: { '@rental-os/shared': [entry],
        '@rental-os/shared/miniprogram-client': [path.join(destination, 'miniprogram-client.d.ts')] }
    } }, null, 2));
    return appConfig;
  } catch (error) {
    releaseMiniprogramSharedTypes(appConfig);
    throw error;
  }
}
// Preserve the original callers' idempotent cleanup name while sharing the
// stricter owned-path removal with the isolated build lifecycle.
function disposeMiniprogramSharedTypes(configFile) {
  if (!preparations.has(configFile)) return;
  releaseMiniprogramSharedTypes(configFile);
}
process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));
process.once('exit', () => {
  for (const configFile of preparations.keys()) {
    try { releaseMiniprogramSharedTypes(configFile); }
    catch (error) { process.stderr.write(`[mini-program cleanup] ${error.message}\n`); process.exitCode = 1; }
  }
});
module.exports = { prepareMiniprogramSharedTypes, disposeMiniprogramSharedTypes, releaseMiniprogramSharedTypes, miniprogramBuildOutput, clearMiniprogramBuildOutput, emitMiniprogramSharedReceiptRuntime };
