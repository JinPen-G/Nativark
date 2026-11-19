'use strict';
// Mini-program build paths and private shared declarations stay in this checkout.
// Shared declarations are temporary; approved receipt values and the selected
// Rental client closure are packaged without exposing a package loader to WeChat.
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

/** Resolve original public values through the compiler's actual export chain,
 * including their Core/platform owner, without executing the Shared barrel. */
function sharedRuntimeSource(appRoot, configFile, names) {
  const root = workspace(appRoot);
  const owned = preparations.get(configFile);
  if (!owned || owned.root !== root || owned.appRoot !== appRoot) throw Error('Shared receipt preparation is not owned by this build');
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const checker = owned.program.getTypeChecker();
  const sharedEntry = owned.program.getSourceFile(path.join(root, 'packages/shared/src/index.ts'));
  const publicExports = checker.getExportsOfModule(checker.getSymbolAtLocation(sharedEntry));
  const sources = names.map(name => {
    let symbol = publicExports.find(value => value.name === name);
    if (!symbol) throw Error('Shared receipt export is missing');
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    // The two extension names are original identifier aliases of the expense
    // functions. Resolve that binding, preserving its actual function identity.
    const declaration = symbol.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isIdentifier(declaration.initializer))
      symbol = checker.getSymbolAtLocation(declaration.initializer);
    const declarations = symbol?.declarations?.filter(ts.isFunctionDeclaration);
    if (declarations?.length !== 1) throw Error('Shared receipt export is not a canonical function');
    return declarations[0].getSourceFile().fileName;
  });
  if (new Set(sources).size !== 1) throw Error('Shared receipt exports have no unambiguous canonical module');
  checkPath(root, sources[0]);
  return { ts, source: ts.transpileModule(fs.readFileSync(sources[0], 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS }
  }).outputText };
}

/** Emit the original audited document parser from its public Shared export. */
function emitMiniprogramRichTextRuntime(appRoot, output, configFile) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot);
  output = miniprogramBuildOutput(appRoot, ['--out-dir', output]);
  const { source } = sharedRuntimeSource(appRoot, configFile, ['parseClientRichText']);
  if (/\brequire\s*\(|\bimport\s*(?:\(|["'{*])/u.test(source)) throw Error('Document parser runtime has an unapproved dependency');
  const destination = path.join(output, 'vendor', 'shared-rich-text');
  checkPath(root, destination, true);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'client-rich-text.js'), source);
}

/** Only the original named dependency-free receipts and service selectors enter
 * WeChat. Pricing and service snapshots remain with their business owner. */
function emitMiniprogramSharedReceiptRuntime(appRoot, output, configFile) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot);
  if (path.basename(appRoot) !== 'miniprogram') throw Error('Receipt runtime is only configured for the customer mini-program');
  output = miniprogramBuildOutput(appRoot, ['--out-dir', output]);
  const names = ['enterpriseExpenseRequestMatches', 'enterpriseExpenseRequestClosureMatches',
    'enterpriseExtensionRequestMatches', 'enterpriseExtensionRequestClosureMatches',
    'enterpriseExtensionServiceRequests', 'enterpriseExtensionServiceSelectionKey'];
  const { ts, source } = sharedRuntimeSource(appRoot, configFile, names);
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

/** Read the declared native client without executing it. Only its relative
 * CommonJS closure and original license enter the selected WeChat output. */
function emitMiniprogramRentalClientRuntime(appRoot, output, configFile) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot), kind = path.basename(appRoot) === 'staff-miniprogram' ? 'staff' : 'miniprogram';
  output = miniprogramBuildOutput(appRoot, ['--out-dir', output]);
  const specifier = `@rental-os/rental-core/clients/${kind}`;
  const owned = preparations.get(configFile);
  if (!owned || owned.root !== root || owned.appRoot !== appRoot) throw Error('Rental native preparation is not owned by this build');
  const packageRoot = path.join(root, 'packages', 'rental-core'), dist = owned.nativeDirectory;
  const entry = path.join(dist, 'clients', kind, 'index.js');
  checkPath(root, dist, true);
  checkPath(root, path.join(packageRoot, 'package.json'));
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const declared = metadata.exports?.[`./clients/${kind}`];
  const target = typeof declared === 'string' ? declared : declared?.require ?? declared?.default;
  if (metadata.name !== '@rental-os/rental-core' || metadata.license !== 'MIT'
    || target !== `./dist-clients/clients/${kind}/index.js`
    || entry !== path.resolve(dist, target.slice('./dist-clients/'.length))
    || !fs.existsSync(entry)) throw Error('Rental native client does not match its package export');

  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const entries = new Map([[specifier, entry]]), applicationFiles = [];
  const destination = path.join(output, 'vendor', 'rental-core'), directories = [output];
  // The shared time entry is bundled only when compiled application code uses it.
  // Resolve each import from the package declaration before writing any vendor files.
  while (directories.length) {
    const directory = directories.pop();
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw Error('Mini-program build refuses linked artifacts');
      if (item.isDirectory()) { if (file !== destination) directories.push(file); continue; }
      if (!file.endsWith('.js')) continue;
      const text = fs.readFileSync(file, 'utf8');
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), bindings = [];
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
          && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
          && node.arguments[0].text.startsWith('@rental-os/rental-core')) {
          const imported = node.arguments[0].text;
          if (!entries.has(imported)) {
            if (imported !== '@rental-os/rental-core/clients/time') throw Error('Mini-program uses an undeclared Rental client export');
            const timeExport = metadata.exports?.['./clients/time'];
            const timeTarget = typeof timeExport === 'string' ? timeExport : timeExport?.require ?? timeExport?.default;
            const timeEntry = path.join(dist, 'clients', 'time.js');
            if (timeTarget !== './dist-clients/clients/time.js' || !fs.existsSync(timeEntry))
              throw Error('Rental native time does not match its package export');
            entries.set(imported, timeEntry);
          }
          bindings.push({ start: node.arguments[0].getStart(parsed), end: node.arguments[0].end, imported });
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      if (bindings.length) applicationFiles.push({ file, text, bindings });
    }
  }

  const modules = new Map(), pending = [...entries.values()];
  while (pending.length) {
    const file = pending.pop();
    if (modules.has(file)) continue;
    checkPath(root, file);
    if (!inside(dist, file) || !file.endsWith('.js')) throw Error('Rental client dependency leaves its compiled closure');
    const text = fs.readFileSync(file, 'utf8');
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (parsed.parseDiagnostics.length) throw Error('Rental native client syntax is invalid');
    modules.set(file, text);
    const visit = node => {
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)
        || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword))
        throw Error('Rental native client must use its compiled CommonJS closure');
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]) || !node.arguments[0].text.startsWith('.'))
          throw Error('Rental native client refuses external or dynamic require');
        pending.push(require.resolve(path.resolve(path.dirname(file), node.arguments[0].text)));
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  checkPath(root, destination, true);
  for (const [file, text] of modules) {
    const targetFile = path.join(destination, path.relative(dist, file));
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, text);
  }
  const localLicense = path.join(packageRoot, 'LICENSE');
  const license = fs.existsSync(localLicense) ? localLicense
    : packageRoot === path.join(root, 'packages', 'rental-core') ? path.join(root, 'LICENSE') : undefined;
  if (!license) throw Error('Rental client package lacks its original license');
  checkPath(root, license);
  fs.copyFileSync(license, path.join(destination, 'LICENSE'));

  for (const { file, text, bindings } of applicationFiles) {
    let rewritten = text;
    for (const binding of bindings.sort((left, right) => right.start - left.start)) {
      const bundled = path.join(destination, path.relative(dist, entries.get(binding.imported)));
      let relative = path.relative(path.dirname(file), bundled).replace(/\\/g, '/').replace(/\.js$/u, '');
      if (!relative.startsWith('.')) relative = './' + relative;
      rewritten = rewritten.slice(0, binding.start) + JSON.stringify(relative) + rewritten.slice(binding.end);
    }
    fs.writeFileSync(file, rewritten);
  }
  const bundledEntry = path.join(destination, path.relative(dist, entry));
  return { specifier, modules: modules.size, entry: path.relative(output, bundledEntry).replace(/\\/g, '/'), exports: [...entries.keys()] };
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

/** Verify the whole finished WeChat runtime, including host and vendor code.
 * Every CommonJS edge must resolve to JavaScript/JSON in this selected output. */
function validateMiniprogramRuntime(appRoot, output) {
  appRoot = path.resolve(appRoot);
  const root = workspace(appRoot);
  output = miniprogramBuildOutput(appRoot, ['--out-dir', output]);
  checkPath(root, output, true);
  const ts = require(require.resolve('typescript', { paths: [appRoot, root] }));
  const directories = [output];
  while (directories.length) {
    const directory = directories.pop();
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) { directories.push(file); continue; }
      if (!file.endsWith('.js')) continue;
      const parsed = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      if (parsed.parseDiagnostics.length) throw Error('Mini-program runtime syntax is invalid');
      const visit = node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          throw Error('Mini-program runtime requires a compiled CommonJS closure');
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]) || !node.arguments[0].text.startsWith('.'))
            throw Error('Mini-program runtime refuses external or dynamic require');
          const resolved = require.resolve(path.resolve(path.dirname(file), node.arguments[0].text));
          checkPath(root, resolved);
          if (!inside(output, resolved) || !/\.(?:js|json)$/u.test(resolved)) throw Error('Mini-program runtime dependency leaves its output');
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
  }
}

// Resolve only declared workspace exports to their canonical source during the
// private compiler pass. The resulting declarations keep package imports, with
// exact temporary paths supplied to the native and host compiler configurations.
function declaredSource(root, specifier, runtime = false) {
  const parts = specifier.split('/'), packageName = parts.slice(0, 2).join('/');
  const packageRoot = path.join(root, 'packages', parts[1]);
  checkPath(root, packageRoot);
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const key = parts.length === 2 ? '.' : './' + parts.slice(2).join('/');
  const entry = metadata.exports?.[key];
  const target = typeof entry === 'string' ? entry : entry?.types;
  if (metadata.name !== packageName || typeof target !== 'string' || !target.startsWith('./dist/'))
    throw Error('Private declarations require an exact source-backed package export: ' + specifier);
  const runtimeTarget = typeof entry === 'string' ? entry : entry?.require ?? entry?.default ?? entry?.import;
  if (runtime && runtimeTarget !== target.replace(/\.d\.ts$/u, '.js'))
    throw Error('Native runtime and type exports have different canonical sources: ' + specifier);
  const source = path.join(packageRoot, target.replace('./dist/', './src/').replace(/\.d\.ts$/u, '.ts'));
  checkPath(root, source);
  if (!fs.existsSync(source)) throw Error('Declared package source is missing: ' + specifier);
  return source;
}

// Emit this checkout's declarations and complete native clients into one owned
// preparation. Published dist and managed dependencies are read-only inputs.
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
  const nativeDirectory = path.join(destination, 'native');
  const owned = { root, appRoot, parent, destination, nativeDirectory };
  preparations.set(appConfig, owned);
  try {
    const config = ts.readConfigFile(path.join(root, 'packages/shared/tsconfig.json'), ts.sys.readFile);
    if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(path.join(source, '../tsconfig.json')), {
      rootDir: root, outDir: path.join(destination, 'declarations'), declarationDir: path.join(destination, 'declarations'), types: [],
      composite: false, incremental: false, noEmit: false, declaration: true,
      emitDeclarationOnly: true, noEmitOnError: true
    });
    const paths = {};
    const dependencyTypes = path.dirname(require.resolve('miniprogram-api-typings/package.json', { paths: [appRoot, root] }));
    const dependencyRoot = path.dirname(dependencyTypes);
    const host = ts.createCompilerHost(parsed.options);
    host.resolveModuleNames = (names, containing) => names.map(name => {
      if (name.startsWith('@rental-os/')) {
        const filename = declaredSource(root, name);
        paths[name] = [path.join(destination, 'declarations', path.relative(root, filename)).replace(/\.ts$/u, '.d.ts')];
        return { resolvedFileName: filename, extension: ts.Extension.Ts };
      }
      const resolved = ts.resolveModuleName(name, containing, parsed.options, host).resolvedModule
        ?? ts.resolveModuleName(name, path.join(dependencyRoot, '../package.json'), parsed.options, host).resolvedModule;
      if (resolved && !name.startsWith('.')) paths[name] = [resolved.resolvedFileName];
      return resolved;
    });
    const program = ts.createProgram(parsed.fileNames, parsed.options, host);
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
    }));
    const emitted = program.emit();
    if (emitted.emitSkipped || emitted.diagnostics.length) throw Error('Private shared declaration emission failed');
    owned.program = program;
    const entry = path.join(destination, 'declarations', 'packages/shared/src/index.d.ts');
    if (!fs.existsSync(entry)) throw Error('Private shared declarations missing index');
    paths['@rental-os/shared'] = [entry];
    paths['@rental-os/shared/miniprogram-client'] = [path.join(destination, 'declarations', 'packages/shared/src/miniprogram-client.d.ts')];
    const nativeConfig = ts.readConfigFile(path.join(root, 'packages/rental-core/tsconfig.native-clients.json'), ts.sys.readFile);
    if (nativeConfig.error) throw Error(ts.flattenDiagnosticMessageText(nativeConfig.error.messageText, '\n'));
    const native = ts.parseJsonConfigFileContent(nativeConfig.config, ts.sys, path.join(root, 'packages/rental-core'), {
      outDir: nativeDirectory, baseUrl: root, paths
    });
    const nativeProgram = ts.createProgram(native.fileNames, native.options);
    const nativeDiagnostics = [...native.errors, ...ts.getPreEmitDiagnostics(nativeProgram)];
    if (nativeDiagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(nativeDiagnostics, {
      getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
    }));
    const nativeEmitted = nativeProgram.emit();
    if (nativeEmitted.emitSkipped || nativeEmitted.diagnostics.length) throw Error('Private native client emission failed');
    const rentalMetadata = JSON.parse(fs.readFileSync(path.join(root, 'packages/rental-core/package.json'), 'utf8'));
    for (const name of ['miniprogram', 'staff', 'time']) {
      const exported = rentalMetadata.exports?.['./clients/' + name];
      const expected = './dist-clients/clients/' + name + (name === 'time' ? '.d.ts' : '/index.d.ts');
      if (exported?.types !== expected) throw Error('Native declaration export changed: ' + name);
      paths['@rental-os/rental-core/clients/' + name] = [path.join(nativeDirectory, expected.slice('./dist-clients/'.length))];
    }
    fs.writeFileSync(appConfig, JSON.stringify({ extends: path.join(appRoot, 'tsconfig.json'), compilerOptions: {
      baseUrl: root, paths, typeRoots: [dependencyRoot]
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
module.exports = { prepareMiniprogramSharedTypes, disposeMiniprogramSharedTypes, releaseMiniprogramSharedTypes, miniprogramBuildOutput, clearMiniprogramBuildOutput, emitMiniprogramSharedReceiptRuntime, emitMiniprogramRichTextRuntime, emitMiniprogramRentalClientRuntime, validateMiniprogramRuntime, declaredSource };
