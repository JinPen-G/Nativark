/** 所选 schema 的离线源码类型检查。只读依赖；Prisma 5.22 官方 WASM/DMMF 和
 * client generator 只在内存生成声明，compilerHost 禁止落盘。不启动 Client、引擎、
 * 应用或连接数据库；此检查不代替独立包构建或实际数据库结构验收。
 * node scripts/check-selected-prisma-types.cjs --deps <node_modules> --mode rental|rental-ai|platform <入口.ts>...
 * 显式传 --config 且省略源码入口时，使用该 tsconfig 的完整文件集，包含继承的声明。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const slash = file => path.resolve(file).split(path.sep).join('/');
const root = slash(path.resolve(__dirname, '..'));
const args = process.argv.slice(2);
let dependencyDirectory = path.join(root, 'node_modules'), mode = 'rental', configPath = 'apps/api/tsconfig.json', explicitConfig = false;
const entries = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--deps') dependencyDirectory = args[++index];
  else if (args[index] === '--mode') mode = args[++index];
  else if (args[index] === '--config') { configPath = args[++index]; explicitConfig = true; }
  else if (args[index].startsWith('--')) throw new Error(`未知选项 ${args[index]}`);
  else entries.push(args[index]);
}
if (!['rental', 'rental-ai', 'platform'].includes(mode) || !dependencyDirectory || !configPath || (!entries.length && !explicitConfig)) {
  throw new Error('须指定 rental/rental-ai/platform、只读依赖目录及源码入口或明确的 --config');
}
const deps = slash(dependencyDirectory), requireDeps = createRequire(deps + '/typescript/package.json');
const ts = requireDeps('typescript');
for (const name of ['prisma', '@prisma/client']) {
  if (JSON.parse(fs.readFileSync(`${deps}/${name}/package.json`, 'utf8')).version !== '5.22.0') {
    throw new Error('本入口只核定原锁文件中的 Prisma 5.22.0；不能猜测另一版本生成器');
  }
}
const cliFile = deps + '/prisma/build/index.js', cli = fs.readFileSync(cliFile, 'utf8');
const start = cli.indexOf('var yI=S('), end = cli.indexOf(';var bI=S(', start);
if (start < 0 || end < 0) throw new Error('原官方 WASM wrapper 不可用，未生成替代声明');
const S = (initialize, cache) => () => {
  if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); }
  return cache.exports;
};
const wasm = new Function('S', 'require', '__dirname', cli.slice(start, end) + ';return yI();')(
  S, createRequire(cliFile), path.dirname(cliFile));
const generator = requireDeps('@prisma/client/generator-build/index.js');
const virtual = new Map(), packageAliases = {}, loaded = new Map(), schemas = [];
const sourcePath = file => {
  for (const candidate of [file, file + '.ts', file + '.tsx', file + '.js', path.join(file, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return slash(candidate);
  }
  throw new Error(`缺少原源码 ${file}`);
};
for (const top of ['packages', 'apps']) {
  for (const entry of fs.readdirSync(`${root}/${top}`, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = `${root}/${top}/${entry.name}`, manifest = directory + '/package.json';
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const [subkey, contract] of Object.entries(pkg.exports || {})) {
      const target = typeof contract === 'string' ? contract : contract.types || contract.import || contract.default || contract.require;
      if (!target || !pkg.name) continue;
      let source = target.replace(/^\.\/dist(?:-ai)?\//u, './src/').replace(/\.d\.ts$/u, '.ts').replace(/\.js$/u, '.ts');
      let file = slash(path.resolve(directory, source));
      // 仅沿 package.json 已公开的单通配出口核类型；不会为未公开路径加源码捷径。
      if (subkey.includes('*')) {
        if (subkey.split('*').length !== 2 || source.split('*').length !== 2) throw new Error(`不支持的正式出口 ${pkg.name}${subkey}`);
        if (fs.existsSync(path.dirname(file.slice(0, file.indexOf('*')) + 'entry.ts')))
          packageAliases[pkg.name + subkey.slice(1)] = [file];
        continue;
      }
      if (!fs.existsSync(file) && fs.existsSync(file + 'x')) file += 'x';
      if (fs.existsSync(file)) packageAliases[pkg.name + (subkey === '.' ? '' : subkey.slice(1))] = [file];
    }
  }
}
function load(file) {
  file = sourcePath(file);
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} };
  loaded.set(file, module);
  const text = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  const requireSource = name => packageAliases[name] ? load(packageAliases[name][0])
    : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : requireDeps(name);
  new Function('require', 'module', 'exports', '__dirname', '__filename', text)(requireSource, module, module.exports, path.dirname(file), file);
  return module.exports;
}
const publicSchema = fs.readFileSync(root + '/apps/platform-api/prisma/schema.prisma', 'utf8');
let selectedSchema = publicSchema;
if (mode !== 'platform') {
  selectedSchema = load(root + '/packages/core-contracts/src/prisma.ts').composeCorePrismaSchema(publicSchema, [{
    id: 'rental', schema: fs.readFileSync(root + '/packages/rental-core/prisma/schema.prisma', 'utf8'),
    publicRelations: load(root + '/packages/rental-core/src/prisma-public-relations.ts').RENTAL_PRISMA_PUBLIC_RELATIONS
  }]);
}
if (mode === 'rental-ai') {
  const data = load(root + '/packages/ai-native-data/src/data.ts');
  const contribution = data.createAiNativeDataContribution(new Map(data.AI_NATIVE_DATA_FILES.map(item =>
    [item.file, fs.readFileSync(root + '/packages/ai-native-data/' + item.file)])));
  selectedSchema = load(root + '/packages/ai-native-data/src/prisma-schema.ts').composeAiNativePrismaSchema(selectedSchema, contribution);
}
function declaration(label, schema, file) {
  const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true })));
  const text = generator.dmmfToTypes(generator.externalToInternalDmmf(dmmf))
    .replace(/(['"])(?:\.\/runtime\/library|@prisma\/client\/library)\1/gu, '"@prisma/client/runtime/library"');
  virtual.set(file, text);
  schemas.push({ schema: label, sha256: createHash('sha256').update(schema).digest('hex'),
    models: dmmf.datamodel.models.length, enums: dmmf.datamodel.enums.length });
}
const selectedFile = root + '/apps/rental-api/generated/client/index.d.ts';
declaration(mode, selectedSchema, selectedFile);
declaration('public', publicSchema, root + '/apps/platform-api/generated/client/index.d.ts');
packageAliases['@prisma/client'] = [selectedFile];
packageAliases['@prisma/client/runtime/library'] = [deps + '/@prisma/client/runtime/library.d.ts'];
const mapped = file => {
  const name = slash(file);
  return name === root + '/node_modules' || name.startsWith(root + '/node_modules/') ? deps + name.slice((root + '/node_modules').length) : name;
};
const fileExists = file => virtual.has(slash(file)) || ts.sys.fileExists(mapped(file));
const readFile = file => virtual.get(slash(file)) ?? ts.sys.readFile(mapped(file));
const directoryExists = file => [...virtual.keys()].some(key => key.startsWith(slash(file) + '/')) || ts.sys.directoryExists(mapped(file));
const configFile = slash(path.resolve(root, configPath)), config = ts.readConfigFile(configFile, readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, { ...ts.sys, readFile, fileExists, directoryExists }, path.dirname(configFile));
// 检查器统一使用仓库根，继承的paths仍须以原声明目录定位。
const configuredPathsBase = parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(configFile);
const configuredPaths = Object.fromEntries(
  Object.entries(parsed.options.paths ?? {}).map(([alias, targets]) => [
    alias,
    targets.map(target => slash(path.resolve(configuredPathsBase, target)))
  ])
);
const options = { ...parsed.options, noEmit: true, incremental: false, declaration: false, rootDir: root, baseUrl: root,
  paths: { ...configuredPaths, ...packageAliases }, typeRoots: [deps + '/@types'] };
const host = ts.createCompilerHost(options);
Object.assign(host, { fileExists, readFile, directoryExists, getDirectories: file => ts.sys.getDirectories(mapped(file)),
  realpath: file => slash(file).startsWith(root + '/node_modules/') ? slash(file) : slash(ts.sys.realpath?.(mapped(file)) ?? mapped(file)),
  writeFile: () => { throw new Error('禁止 compilerHost 落盘'); },
  getSourceFile: (file, version) => { const text = readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, version, true); }
});
const rootNames = entries.length ? entries.map(file => slash(path.resolve(root, file))) : parsed.fileNames;
const program = ts.createProgram({ rootNames, options, host });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
console.log(JSON.stringify({ typescript: ts.version, prisma: '5.22.0', schemas, roots: rootNames.length,
  sources: program.getSourceFiles().length, diagnostics: diagnostics.length, diskOutputs: 0 }));
for (const diagnostic of diagnostics.slice(0, 40)) {
  const position = diagnostic.file && diagnostic.start != null ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
  console.log((diagnostic.file ? slash(diagnostic.file.fileName).replace(root + '/', '') : '')
    + (position ? ':' + (position.line + 1) : '') + ' ' + diagnostic.code + ' ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}
process.exitCode = diagnostics.length ? 1 : 0;
