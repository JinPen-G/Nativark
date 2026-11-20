'use strict';
/** 按真实包配置从空产物执行 TypeScript emit；包间只消费本次正式声明出口。
 * 所有产物保存在内存，不读旧 dist、不扩大 rootDir、不加载应用或业务环境。
 * --contracts-only 只验证 Rental 基础合同与 Shared 的无环构建和运行时兼容。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire, isBuiltin } = require('node:module');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const inside = (directory, file) => file === directory || file.startsWith(directory + '/');

function createBuild(dependencyDirectory) {
  const deps = slash(dependencyDirectory);
  const requireDeps = createRequire(deps + '/typescript/package.json');
  const ts = requireDeps('typescript');
  const outputs = new Map(), virtual = new Map(), packages = new Map(), stages = [];
  const workspaceRoot = slash(root);
  for (const top of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(path.join(root, top), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = slash(path.join(root, top, entry.name));
      const filename = directory + '/package.json';
      if (!fs.existsSync(filename)) continue;
      const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (metadata.name) packages.set(metadata.name, { directory, metadata });
    }
  }
  // Never fall through to installed workspace links or an author's stale output.
  const generated = file => inside(workspaceRoot, file)
    && /\/(?:dist(?:-[^/]+)?|generated)\/|\.tsbuildinfo$/u.test(file);
  const mapped = file => {
    file = slash(file);
    return inside(workspaceRoot + '/node_modules', file)
      ? deps + file.slice((workspaceRoot + '/node_modules').length) : file;
  };
  const fileExists = file => {
    file = slash(file);
    return outputs.has(file) || virtual.has(file) || (!generated(file) && ts.sys.fileExists(mapped(file)));
  };
  const readFile = file => {
    file = slash(file);
    return outputs.get(file) ?? virtual.get(file) ?? (generated(file) ? undefined : ts.sys.readFile(mapped(file)));
  };
  const directoryExists = file => {
    file = slash(file);
    return [...outputs.keys(), ...virtual.keys()].some(key => inside(file, key))
      || (!generated(file + '/_') && ts.sys.directoryExists(mapped(file)));
  };
  function exported(name, runtime = false) {
    const parts = name.split('/'), packageName = parts.slice(0, 2).join('/');
    const pkg = packages.get(packageName);
    if (!pkg) return undefined;
    const key = parts.length === 2 ? '.' : './' + parts.slice(2).join('/');
    const entry = pkg.metadata.exports?.[key];
    const target = typeof entry === 'string' ? entry : runtime
      ? entry?.require ?? entry?.default ?? entry?.import : entry?.types;
    if (typeof target !== 'string' || !target.startsWith('./') || target.includes('*'))
      throw Error('缺少精确正式包出口：' + name);
    const file = slash(path.resolve(pkg.directory, target));
    if (!inside(pkg.directory, file)) throw Error('包出口越界：' + name);
    return file;
  }
  function compile(configName, extraOptions = {}) {
    const configFile = slash(path.resolve(root, configName));
    const config = ts.readConfigFile(configFile, readFile);
    if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, {
      ...ts.sys, readFile, fileExists, directoryExists
    }, path.dirname(configFile));
    const options = { ...parsed.options, noEmitOnError: true, ...extraOptions,
      typeRoots: [deps + '/@types'] };
    const outputDirectory = slash(options.outDir);
    const host = ts.createCompilerHost(options);
    Object.assign(host, {
      fileExists, readFile, directoryExists,
      getDirectories: file => ts.sys.getDirectories(mapped(file)),
      realpath: file => slash(ts.sys.realpath?.(mapped(file)) ?? mapped(file)),
      getSourceFile: (file, version) => {
        const text = readFile(file);
        return text === undefined ? undefined : ts.createSourceFile(file, text, version, true);
      }
    });
    host.resolveModuleNames = (names, containing) => names.map(name => {
      if (name.startsWith('@rental-os/')) {
        const file = exported(name);
        if (!file || !fileExists(file)) throw Error(`前置包尚未构建：${name}（${path.relative(root, containing)}）`);
        return { resolvedFileName: file, extension: file.endsWith('.d.ts') ? ts.Extension.Dts
          : file.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: true };
      }
      const resolved = ts.resolveModuleName(name, containing, options, host).resolvedModule;
      return resolved ?? (!name.startsWith('.')
        ? ts.resolveModuleName(name, deps + '/_build_.ts', options, host).resolvedModule : undefined);
    });
    const emitted = new Map();
    host.writeFile = (file, text) => {
      file = slash(file);
      if (!inside(outputDirectory, file) && !(file.endsWith('.tsbuildinfo') && inside(slash(path.dirname(configFile)), file)))
        throw Error('产物越出该包配置的输出目录：' + file);
      emitted.set(file, text);
    };
    const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    const result = diagnostics.length ? undefined : program.emit();
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
      outputs: emitted.size, diagnostics: 0 };
    stages.push(stage);
    console.log(JSON.stringify(stage));
    return { program, emitted };
  }
  const loaded = new Map();
  function load(file) {
    file = slash(file);
    if (loaded.has(file)) return loaded.get(file).exports;
    const text = outputs.get(file);
    if (text === undefined) throw Error('运行时不能读取未编译模块：' + file);
    const module = { exports: {} };
    loaded.set(file, module);
    const resolve = name => {
      if (name.startsWith('@rental-os/')) return exported(name, true);
      if (name.startsWith('.')) {
        const target = slash(path.resolve(path.dirname(file), name));
        const result = [target, target + '.js', target + '/index.js'].find(candidate => outputs.has(candidate));
        if (!result) throw Error('运行时构建依赖缺失：' + file + ' -> ' + name);
        return result;
      }
      return requireDeps.resolve(name);
    };
    const requireBuilt = name => name.startsWith('@rental-os/') || name.startsWith('.')
      ? load(resolve(name)) : requireDeps(name);
    requireBuilt.resolve = resolve;
    new vm.Script(`(function(require,module,exports,__dirname,__filename){${text}\n})`, { filename: file })
      .runInThisContext()(requireBuilt, module, module.exports, path.dirname(file), file);
    return module.exports;
  }
  return { ts, outputs, virtual, packages, stages, compile, exported, load, requireDeps, deps };
}

function verifyContracts(build) {
  const { ts, compile, exported, load } = build;
  compile('packages/platform-contracts/tsconfig.json');
  const contracts = compile('packages/rental-core/tsconfig.contracts.json');
  const references = new Set();
  const sharedDirectory = path.join(root, 'packages/shared/src');
  for (const file of fs.readdirSync(sharedDirectory).filter(file => file.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(sharedDirectory, file), 'utf8'), ts.ScriptTarget.Latest, true);
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
  console.log(JSON.stringify({ sharedRentalEntries: references.size,
    retainedRuntimeExports, sharedRuntimeExports: Object.keys(shared).length, diskOutputs: 0 }));
}

function main(args) {
  let deps = path.join(root, 'node_modules');
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--deps' && args[index + 1]) deps = args[++index];
    else if (args[index] !== '--contracts-only') throw Error('未知构建核验选项：' + args[index]);
  }
  const build = createBuild(deps);
  verifyContracts(build);
  console.log(JSON.stringify({ status: 'passed', mode: 'contracts', typescript: build.ts.version,
    stages: build.stages.length, emittedFiles: build.outputs.size, diskOutputs: 0 }));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
module.exports = { createBuild, verifyContracts };
