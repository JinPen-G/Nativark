'use strict';
/** 按真实包配置从空产物执行 TypeScript emit；包间只消费本次正式声明出口。
 * 所有产物保存在内存，不读旧 dist、不扩大 rootDir、不加载应用或业务环境。
 * --contracts-only 核固定双仓的 Rental/Shared 兼容合同；--platform-only 核零 Core。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { selectedCompilerOptions } = require('./build-selected-prisma.cjs');
const { mergeSourceLocks, retentionSdk, publicDataSdk } = require('./rental-host-lock.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const inside = (directory, file) => file === directory || file.startsWith(directory + '/');
const publicProjects = ['packages/platform-contracts', 'packages/core-contracts', 'packages/platform-server',
  'packages/core-host', 'packages/platform-core-host', 'apps/platform-api', 'packages/platform-admin', 'apps/platform-admin'];

function createBuild(dependencyDirectory, settings = {}) {
  const deps = slash(dependencyDirectory);
  const requireDeps = createRequire(deps + '/typescript/package.json');
  const compilerPath = settings.compilerPath ?? requireDeps.resolve('typescript');
  const ts = requireDeps(compilerPath);
  const outputs = new Map(), virtual = new Map(), packages = new Map(), stages = [], runtimeAliases = new Map();
  const selectedClients = new Map();
  let generatedDirectories = new Set();
  const workspaceRoot = slash(root);
  const snapshot = settings.snapshot ?? (settings.commit && require('./rental-build-snapshot.cjs').readBuildSnapshot(settings.commit));
  if (snapshot?.sources) {
    for (const source of [snapshot.sources.platform, snapshot.sources.rental])
      if (!/^[a-f0-9]{40}$/u.test(source?.commit)) throw Error('组合构建必须固定双完整提交');
    if (snapshot.origins?.size !== snapshot.files.size) throw Error('组合源码文件表与来源记录不一致');
    for (const [file, bytes] of snapshot.files) {
      const origin = snapshot.origins?.get(file);
      if (!origin || ![snapshot.sources.platform.commit, snapshot.sources.rental.commit].includes(origin.commit)
        || origin.sha256 !== createHash('sha256').update(bytes).digest('hex'))
        throw Error('组合源码来源或字节已变化：' + file);
    }
  }
  const lockFile = workspaceRoot + '/package-lock.json';
  const lock = mergeSourceLocks(
    JSON.parse(snapshot ? snapshot.files.get(lockFile)?.toString('utf8') : ts.sys.readFile(lockFile)), snapshot?.dependencyLock);
  const scoped = [[retentionSdk, settings.publicRetention], [publicDataSdk, settings.publicAiDataSdk]]
    .filter(([, sdk]) => sdk).map(([definition, sdk]) => {
      assert.deepEqual(lock.packages[definition.install], sdk.lock, '编译须使用同次固定的局部 SDK 锁');
      const directory = workspaceRoot + '/' + definition.install;
      for (const [file, bytes] of sdk.files) virtual.set(directory + '/' + file, Buffer.from(bytes).toString('utf8'));
      return { directory, metadata: sdk.metadata, definition };
    });
  const dependencyPackages = new Map(), dependencyDirectories = new Set([deps]);
  for (const [name, metadata] of Object.entries(lock.packages || {})) {
    if (!name.startsWith('node_modules/') || metadata.link || !metadata.version) continue;
    const directory = deps + name.slice('node_modules'.length);
    dependencyPackages.set(directory, metadata);
    for (let current = directory; inside(deps, current); current = slash(path.dirname(current))) {
      dependencyDirectories.add(current);
      if (current === deps) break;
    }
  }
  const samePath = (left, right) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right;
  const physicalPath = file => {
    try { return samePath(slash(fs.realpathSync(file)), file); } catch { return false; }
  };
  const checkedDependencies = new Map();
  const compilerRoot = settings.compilerPath && slash(path.dirname(path.dirname(compilerPath)));
  // Only installed, lock-declared third-party packages may bypass the Git
  // snapshot. Workspace links, generated Clients and links to other trees may not.
  const dependencyPath = file => {
    if (compilerRoot && inside(compilerRoot, file)) return physicalPath(file);
    if (!inside(deps, file) || /(?:^|\/)\.prisma(?:\/|$)/u.test(file) || !physicalPath(file)) return false;
    if (dependencyDirectories.has(file)) return true;
    const relative = 'node_modules/' + file.slice(deps.length + 1);
    const match = /^(.*(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/u.exec(relative);
    const directory = match && deps + match[1].slice('node_modules'.length);
    const metadata = dependencyPackages.get(directory);
    if (!metadata) return false;
    if (!checkedDependencies.has(directory)) {
      let valid = false;
      try {
        const manifest = directory + '/package.json';
        valid = physicalPath(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).version === metadata.version;
      } catch { /* A missing or changed installed dependency is not a source fallback. */ }
      checkedDependencies.set(directory, valid);
    }
    return checkedDependencies.get(directory);
  };
  const dependencyFile = file => /\.(?:json|[cm]?[jt]sx?)$/u.test(file) && dependencyPath(file);
  const fromSnapshot = file => snapshot && inside(workspaceRoot, file) && !inside(deps, file);
  const sourceRead = file => {
    file = slash(file);
    if (compilerRoot && inside(compilerRoot, file)) return dependencyFile(file) ? ts.sys.readFile(file) : undefined;
    if (inside(deps, file)) return dependencyFile(file) ? ts.sys.readFile(file) : undefined;
    return fromSnapshot(file) ? snapshot.files.get(file)?.toString('utf8')
      : inside(workspaceRoot, file) ? ts.sys.readFile(file) : undefined;
  };
  const manifests = snapshot ? [...snapshot.files.keys()].filter(file => /\/(?:packages|apps)\/[^/]+\/package\.json$/u.test(file)) : [];
  if (!snapshot) for (const top of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(path.join(root, top), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = slash(path.join(root, top, entry.name));
      const filename = directory + '/package.json';
      if (!fs.existsSync(filename)) continue;
      manifests.push(filename);
    }
  }
  for (const filename of manifests) {
    const metadata = JSON.parse(sourceRead(filename));
    if (metadata.name) packages.set(metadata.name, { directory: slash(path.dirname(filename)), metadata });
  }
  // Never fall through to installed workspace links or an author's stale output.
  const generated = file => inside(workspaceRoot, file) && !dependencyPath(file)
    && /\/(?:dist(?:-[^/]+)?|generated)\/|\.tsbuildinfo$/u.test(file);
  const mapped = file => {
    file = slash(file);
    if (scoped.some(pkg => inside(pkg.directory, file))) return file;
    const workspacePackage = /\/node_modules\/(@rental-os\/[^/]+)(\/.*)?$/u.exec(file);
    const pkg = workspacePackage && packages.get(workspacePackage[1]);
    if (pkg) return pkg.directory + (workspacePackage[2] || '');
    return inside(workspaceRoot + '/node_modules', file)
      ? deps + file.slice((workspaceRoot + '/node_modules').length) : file;
  };
  const fileExists = file => {
    file = mapped(file);
    if (/(?:^|\/)\.prisma\/client(?:\/|$)/u.test(file)) return false;
    return outputs.has(file) || virtual.has(file) || (compilerRoot && inside(compilerRoot, file) ? dependencyFile(file) : !generated(file)
      && (inside(deps, file) ? dependencyFile(file) : fromSnapshot(file)
        ? snapshot.files.has(file) : inside(workspaceRoot, file) && ts.sys.fileExists(file)));
  };
  const readFile = file => {
    file = mapped(file);
    if (/(?:^|\/)\.prisma\/client(?:\/|$)/u.test(file)) return undefined;
    return outputs.get(file) ?? virtual.get(file) ?? (generated(file) ? undefined : sourceRead(file));
  };
  const directoryExists = file => {
    file = mapped(file);
    if (file.endsWith('/node_modules/@rental-os')) return true;
    if (compilerRoot && inside(compilerRoot, file)) return dependencyPath(file) && ts.sys.directoryExists(file);
    return generatedDirectories.has(file)
      || (inside(deps, file) ? dependencyPath(file) && ts.sys.directoryExists(file)
        : !generated(file + '/_') && (fromSnapshot(file)
          ? snapshot.directories.has(file) : inside(workspaceRoot, file) && ts.sys.directoryExists(file)));
  };
  const getDirectories = file => {
    file = mapped(file);
    return fromSnapshot(file)
      ? [...(snapshot.entries(file) || [])].filter(([, directory]) => directory).map(([name]) => name)
      : directoryExists(file) ? ts.sys.getDirectories(file).filter(name => directoryExists(path.resolve(file, name))) : [];
  };
  const readDirectory = (directory, extensions, excludes, includes, depth) => fromSnapshot(slash(directory))
    ? ts.matchFiles(directory, extensions, excludes, includes, ts.sys.useCaseSensitiveFileNames, root, depth,
      file => { const entries = [...(snapshot.entries(file) || [])]; return {
        files: entries.filter(([, dir]) => !dir).map(([name]) => name),
        directories: entries.filter(([, dir]) => dir).map(([name]) => name) }; }, file => slash(file))
    : directoryExists(directory) ? ts.sys.readDirectory(directory, extensions, excludes, includes, depth).filter(fileExists) : [];
  function packageFor(name, from) {
    return scoped.find(pkg => name === pkg.definition.name && from
      && inside(workspaceRoot + '/' + pkg.definition.owner, slash(from))) ?? packages.get(name);
  }
  function exported(name, runtime = false, from) {
    const parts = name.split('/'), packageName = parts.slice(0, 2).join('/');
    const pkg = packageFor(packageName, from);
    if (!pkg) return undefined;
    const key = parts.length === 2 ? '.' : './' + parts.slice(2).join('/');
    let entry = pkg.metadata.exports?.[key], match;
    if (entry === undefined) {
      const patterns = Object.keys(pkg.metadata.exports || {}).filter(pattern => pattern.split('*').length === 2)
        .map(pattern => ({ pattern, prefix: pattern.slice(0, pattern.indexOf('*')), suffix: pattern.slice(pattern.indexOf('*') + 1) }))
        .filter(({ prefix, suffix }) => key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length)
        .sort((left, right) => right.prefix.length - left.prefix.length || right.pattern.length - left.pattern.length);
      if (patterns.length) {
        const { pattern, prefix, suffix } = patterns[0];
        match = key.slice(prefix.length, suffix.length ? -suffix.length : undefined);
        if (!match || /[\\%]/u.test(match) || match.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules'))
          throw Error('正式子路径匹配包含不可移植路径：' + name);
        entry = pkg.metadata.exports[pattern];
      }
    }
    let target = typeof entry === 'string' ? entry : runtime
      ? entry?.require ?? entry?.default ?? entry?.import : entry?.types;
    if (match !== undefined && typeof target === 'string') {
      if (target.split('*').length !== 2) throw Error('正式子路径目标须使用单一匹配：' + name);
      target = target.replace('*', match);
    }
    if (typeof target !== 'string' || !target.startsWith('./') || target.includes('*') || /[\\%]/u.test(target)
      || target.slice(2).split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules'))
      throw Error('缺少有效正式包出口：' + name);
    const file = slash(path.resolve(pkg.directory, target));
    if (!inside(pkg.directory, file)) throw Error('包出口越界：' + name);
    return file;
  }
  function compile(configName, extraOptions = {}) {
    generatedDirectories = new Set();
    for (const file of [...outputs.keys(), ...virtual.keys()]) {
      for (let current = slash(path.dirname(file)); !generatedDirectories.has(current); current = slash(path.dirname(current))) {
        generatedDirectories.add(current);
        if (current === slash(path.dirname(current))) break;
      }
    }
    const configFile = slash(path.resolve(root, configName));
    const config = ts.readConfigFile(configFile, readFile);
    if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, {
      ...ts.sys, readFile, fileExists, directoryExists, readDirectory
    }, path.dirname(configFile));
    let options = { ...parsed.options, noEmitOnError: true, ...extraOptions,
      typeRoots: [deps + '/@types'] };
    const selection = selectedClients.get(slash(path.dirname(configFile)));
    if (selection) options = selectedCompilerOptions(ts, configFile, options, selection, readFile).options;
    const outputDirectory = options.outDir && slash(options.outDir);
    const host = ts.createCompilerHost(options);
    Object.assign(host, {
      fileExists, readFile, directoryExists,
      getDirectories,
      realpath: file => slash(ts.sys.realpath?.(mapped(file)) ?? mapped(file)),
      getSourceFile: (file, version) => {
        const text = readFile(file);
        return text === undefined ? undefined : ts.createSourceFile(file, text, version, true);
      }
    });
    host.resolveModuleNames = (names, containing) => names.map(name => {
      if (name === '@prisma/client' && !Object.hasOwn(options.paths || {}, name))
        throw Error('编译必须显式选择宿主 Client 声明：' + configName);
      if (Object.hasOwn(options.paths || {}, name) && !name.startsWith('@rental-os/')) {
        const configured = ts.resolveModuleName(name, containing, options, host).resolvedModule;
        if (!configured) throw Error('正式类型映射目标不存在：' + name);
        return configured;
      }
      if (name.startsWith('@rental-os/')) {
        // A producing package may map its own exact formal contract names to
        // its source in tsconfig. Respect that real tsc setting, never invent a
        // cross-package source fallback when a dependency has not been built.
        if (options.rootDir && Object.hasOwn(options.paths || {}, name)) {
          const own = ts.resolveModuleName(name, containing, options, host).resolvedModule;
          if (own && inside(slash(options.rootDir), slash(own.resolvedFileName))) return own;
          throw Error('正式自引用配置越出本包 rootDir：' + name);
        }
        const file = exported(name, false, containing);
        if (!file || !fileExists(file)) throw Error(`前置包尚未构建：${name}（${path.relative(root, containing)}）`);
        if (!/\.[cm]?[jt]sx?$/u.test(file)) return undefined;
        const standard = ts.resolveModuleName(name, containing, options, host).resolvedModule;
        if (standard && mapped(standard.resolvedFileName) === file) return standard;
        const packageName = name.split('/').slice(0, 2).join('/'), pkg = packageFor(packageName, containing);
        return { resolvedFileName: file, extension: file.endsWith('.d.ts') ? ts.Extension.Dts
          : file.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: true,
          packageId: { name: packageName, version: pkg.metadata.version,
            subModuleName: file.slice(pkg.directory.length + 1) } };
      }
      const resolved = ts.resolveModuleName(name, containing, options, host).resolvedModule;
      return resolved ?? (!name.startsWith('.')
        ? ts.resolveModuleName(name, deps + '/_build_.ts', options, host).resolvedModule : undefined);
    });
    host.resolveTypeReferenceDirectives = (names, containing) => names.map(reference => {
      const name = typeof reference === 'string' ? reference : reference.fileName;
      return ts.resolveTypeReferenceDirective(name, containing, options, host).resolvedTypeReferenceDirective
        ?? ts.resolveTypeReferenceDirective(name, deps + '/_build_.ts', { ...options, typeRoots: undefined }, host).resolvedTypeReferenceDirective;
    });
    const emitted = new Map();
    host.writeFile = (file, text) => {
      file = slash(file);
      if ((!outputDirectory || !inside(outputDirectory, file)) && !(file.endsWith('.tsbuildinfo') && inside(slash(path.dirname(configFile)), file)))
        throw Error('产物越出该包配置的输出目录：' + file);
      emitted.set(file, text);
    };
    const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    const result = diagnostics.length || options.noEmit ? undefined : program.emit();
    if (result) diagnostics.push(...result.diagnostics);
    if (diagnostics.length || result?.emitSkipped) {
      console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics.slice(0, 30), {
        getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
      }));
      throw Error(`${configName}：${diagnostics.length} 条诊断，未采纳任何产物`);
    }
    for (const [file, text] of emitted) outputs.set(file, text);
    const stage = { config: configName, roots: parsed.fileNames.length,
      sourceFiles: program.getSourceFiles().filter(file => !file.isDeclarationFile).length,
      outputs: emitted.size, diagnostics: 0,
      ...(settings.compilerPath ? { compiler: { version: ts.version,
        sha256: createHash('sha256').update(fs.readFileSync(compilerPath)).digest('hex') } } : {}) };
    stages.push(stage);
    if (!settings.quiet) console.log(JSON.stringify(stage));
    return { program, emitted };
  }
  const loaded = new Map();
  function load(file) {
    file = slash(file);
    if (loaded.has(file)) return loaded.get(file).exports;
    const hasScopedRuntime = scoped.some(pkg => inside(pkg.directory, file));
    const text = outputs.get(file) ?? (hasScopedRuntime ? virtual.get(file) : undefined);
    if (text === undefined) throw Error('运行时不能读取未编译模块：' + file);
    const module = { exports: {} };
    loaded.set(file, module);
    const resolve = name => {
      if (runtimeAliases.has(name)) return runtimeAliases.get(name);
      if (name.startsWith('@rental-os/')) return exported(name, true, file);
      if (name.startsWith('.')) {
        const target = slash(path.resolve(path.dirname(file), name));
        const result = [target, target + '.js', target + '/index.js']
          .find(candidate => outputs.has(candidate) || hasScopedRuntime && virtual.has(candidate));
        if (!result) throw Error('运行时构建依赖缺失：' + file + ' -> ' + name);
        return result;
      }
      return requireDeps.resolve(name);
    };
    const requireBuilt = name => {
      if (name === '@prisma/client' || /(?:^|\/)\.prisma\/client(?:\/|$)/u.test(name))
        throw Error('正式包运行时禁止默认生成 Client：' + name);
      return runtimeAliases.has(name) || name.startsWith('@rental-os/') || name.startsWith('.') ? load(resolve(name)) : requireDeps(name);
    };
    requireBuilt.resolve = resolve;
    new vm.Script(`(function(require,module,exports,__dirname,__filename){${text}\n})`, { filename: file })
      .runInThisContext()(requireBuilt, module, module.exports, path.dirname(file), file);
    return module.exports;
  }
  function compileMcp() {
    const directory = slash(path.join(path.dirname(deps), 'packages/mcp-server/node_modules/typescript'));
    const version = lock.packages['packages/mcp-server/node_modules/typescript']?.version;
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const compiler = path.join(directory, 'lib/typescript.js');
    if (!physicalPath(directory) || !physicalPath(slash(compiler)) || pkg.name !== 'typescript' || pkg.version !== version)
      throw Error('MCP 编译器与固定工作区锁不一致');
    const selected = createBuild(deps, { ...settings, compilerPath: compiler });
    if (selected.ts.version !== version) throw Error('MCP 实际编译器版本与锁不一致');
    for (const [file, content] of outputs) selected.outputs.set(file, content);
    const result = selected.compile('packages/mcp-server/tsconfig.json');
    for (const [file, content] of result.emitted) outputs.set(file, content);
    stages.push(selected.stages.at(-1));
  }
  return { ts, outputs, virtual, packages, stages, runtimeAliases, selectedClients, compile, compileMcp, exported, load, requireDeps, deps,
    snapshot, sourceRead, readDirectory, quiet: settings.quiet };
}

function verifyContracts(build) {
  const { ts, compile, exported, load } = build;
  compile('packages/platform-contracts/tsconfig.json');
  const contracts = compile('packages/rental-core/tsconfig.contracts.json');
  const references = new Set();
  const sharedDirectory = path.join(root, 'packages/shared/src');
  for (const file of build.readDirectory(sharedDirectory, ['.ts'], [], ['*.ts'])) {
    const source = ts.createSourceFile(file, build.sourceRead(file), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('@rental-os/rental-core'))
        references.add(node.moduleSpecifier.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const name of references) {
    assert(contracts.emitted.has(exported(name)), '窄构建遗漏真实 Shared 合同：' + name);
    assert(contracts.emitted.has(exported(name, true)), '窄构建遗漏运行时合同：' + name);
  }
  for (const source of contracts.program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    assert(inside(slash(path.join(root, 'packages/rental-core/src')), slash(source.fileName)), '合同源码跨包');
    for (const imported of source.imports || []) {
      assert(!/@rental-os\/(?:shared|platform-server)/u.test(imported.text), '合同反向依赖：' + imported.text);
    }
  }
  compile('packages/shared/tsconfig.json');
  compile('packages/shared/tsconfig.agent-desktop.json');
  const shared = load(exported('@rental-os/shared', true));
  const checker = contracts.program.getTypeChecker();
  let retainedRuntimeExports = 0;
  // Shared is the established compatibility barrel: every forwarded value must
  // retain identity, including schemas, enums and executable default functions.
  for (const name of references) {
    const source = contracts.program.getSourceFile(exported(name).replace('/dist/', '/src/').replace(/\.d\.ts$/u, '.ts'));
    const symbol = source && checker.getSymbolAtLocation(source);
    assert(symbol, '正式合同源码不可定位：' + name);
    const runtime = load(exported(name, true));
    for (const key of Object.keys(runtime)) {
      if (!Object.hasOwn(shared, key)) continue;
      assert.equal(shared[key], runtime[key], 'Shared 运行时身份改变：' + key);
      retainedRuntimeExports++;
    }
  }
  if (!build.quiet) console.log(JSON.stringify({ sharedRentalEntries: references.size,
    retainedRuntimeExports, sharedRuntimeExports: Object.keys(shared).length, diskOutputs: 0 }));
}

async function main(args) {
  let deps = path.join(root, 'node_modules');
  const options = {}, modes = new Set();
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--deps' && args[index + 1]) deps = args[++index];
    else if (['--commit', '--build-repo', '--core-repo', '--core-commit', '--source-mode', '--source-repository'].includes(args[index])
      && args[index + 1] && !args[index + 1].startsWith('--')) {
      const key = args[index];
      if (options[key]) throw Error('重复构建选项：' + key);
      options[key] = args[++index];
    }
    else if (['--contracts-only', '--platform-only', '--legacy-single-repo'].includes(args[index]) && !modes.has(args[index]))
      modes.add(args[index]);
    else throw Error('未知构建核验选项：' + args[index]);
  }
  const platformOnly = modes.has('--platform-only'), legacy = modes.has('--legacy-single-repo');
  const commit = options['--commit'], repo = path.resolve(options['--build-repo'] ?? root);
  const source = { commit, repository: options['--source-repository'] ?? 'https://github.com/JinPen-G/Nativark' };
  const hasRental = ['--core-repo', '--core-commit', '--source-mode'].some(option => options[option]);
  if (!commit || (platformOnly && (legacy || modes.has('--contracts-only'))) || ((platformOnly || legacy) && hasRental))
    throw Error('须提供固定 --commit；零 Core、双仓与历史单仓核验不能混用');
  const { readBuildSnapshot, snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const { compileFixedPlatformContracts, readIndependentRentalSource } = require('./prepare-rental-workspace.cjs');
  const { generatePrismaDeclarations, readDistributionWorkspace } = require('./verify-rental-distribution.cjs');
  if (platformOnly) {
    const contract = compileFixedPlatformContracts(repo, commit, deps, true);
    const api = contract.load(contract.exported('@rental-os/core-contracts/platform-source', true));
    const platform = await api.readPlatformSourceFromGit(repo, source);
    const snapshot = snapshotFromFiles(commit, new Map([...platform.files].map(([file, bytes]) => [slash(path.join(root, file)), bytes])));
    const build = createBuild(deps, { snapshot, quiet: true });
    if ([...snapshot.files.keys()].some(file => /\/(?:apps\/(?:rental-|api\/)|packages\/(?:rental-|shared\/|web-client\/))/u.test(file.slice(slash(root).length))))
      throw Error('零 Core 构建含 Rental 或旧 Shared 源码');
    const schema = platform.files.get('apps/platform-api/prisma/schema.prisma').toString('utf8');
    generatePrismaDeclarations(build, [['public', schema]]);
    build.selectedClients.set(slash(path.join(root, 'apps/platform-api')),
      { client: slash(path.join(root, 'apps/platform-api/generated/client/index.d.ts')), mode: 'platform' });
    for (const project of publicProjects) build.compile(project + '/tsconfig.json');
    console.log(JSON.stringify({ status: 'passed', mode: 'platform-only', source, projects: build.stages, diskOutputs: 0 }));
    return;
  }
  if (!legacy && (!options['--core-repo'] || !options['--core-commit']))
    throw Error('Rental 合同核验须给出两个完整提交和独立仓目录；旧单仓请显式选 --legacy-single-repo');
  const rental = legacy ? undefined : readIndependentRentalSource(options['--core-repo'], options['--core-commit'],
    { mode: options['--source-mode'] ?? 'development' });
  const snapshot = legacy ? readBuildSnapshot(commit, repo) : (await readDistributionWorkspace(source, repo, deps, rental, 'domain')).snapshot;
  const build = createBuild(deps, { snapshot });
  verifyContracts(build);
  console.log(JSON.stringify({ status: 'passed', mode: 'contracts', typescript: build.ts.version,
    source, ...(rental ? { rentalSource: rental.source } : { sourceMode: 'legacy-single-repo' }),
    stages: build.stages.length, emittedFiles: build.outputs.size, diskOutputs: 0 }));
}
module.exports = { createBuild, verifyContracts };
if (require.main === module)
  main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
