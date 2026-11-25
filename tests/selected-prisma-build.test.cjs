'use strict';
/** 正式编译器选型回归。官方 Prisma 5.22 只在测试进程内生成161/247声明，
 * 不写默认 Client、不运行引擎；生产 CLI 仅消费既有磁盘生成物。
 * node tests/selected-prisma-build.test.cjs --deps <只读node_modules>
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/dev2-selected-build');
assert.equal(fs.existsSync(temporary), false);
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const requireDeps = createRequire(path.join(deps, 'typescript/package.json')), ts = requireDeps('typescript');
const { parseArguments, selectedCompilerOptions } = require('../scripts/build-selected-prisma.cjs');
const { createControllerSourceLoader } = require('../scripts/controller-sources.cjs');
const loader = createControllerSourceLoader(root, deps), load = file => loader.load(path.join(root, file));
const publicSchema = fs.readFileSync(path.join(root, 'apps/platform-api/prisma/schema.prisma'), 'utf8');
const rentalSchema = load('packages/rental-core/src/prisma-schema.ts').composeRentalPrismaSchema(publicSchema,
  fs.readFileSync(path.join(root, 'packages/rental-core/prisma/schema.prisma'), 'utf8'));
const data = load('packages/ai-native-data/src/data.ts');
const contribution = data.createAiNativeDataContribution(new Map(data.AI_NATIVE_DATA_FILES.map(row =>
  [row.file, fs.readFileSync(path.join(root, 'packages/ai-native-data', row.file))])));
const aiSchema = load('packages/ai-native-data/src/prisma-schema.ts').composeAiNativePrismaSchema(rentalSchema, contribution);
for (const name of ['prisma', '@prisma/client']) assert.equal(requireDeps(name + '/package.json').version, '5.22.0');
const cliFile = requireDeps.resolve('prisma'), cli = fs.readFileSync(cliFile, 'utf8');
const start = cli.indexOf('var yI=S('), end = cli.indexOf(';var bI=S(', start);
assert(start >= 0 && end > start);
const S = (initialize, cache) => () => { if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); } return cache.exports; };
const wasm = new Function('S', 'require', '__dirname', cli.slice(start, end) + ';return yI();')(S, createRequire(cliFile), path.dirname(cliFile));
const generator = requireDeps('@prisma/client/generator-build/index.js');
const files = new Map(), slash = file => path.resolve(file).split(path.sep).join('/');
const client = slash(path.join(root, 'apps/rental-api/generated/client/index.d.ts'));
const project = slash(path.join(root, 'packages/rental-core/tsconfig.json'));
const schemaFile = slash(path.join(path.dirname(client), 'schema.prisma'));
const read = file => files.get(slash(file)) ?? ts.sys.readFile(file);
function generated(schema, target = client) {
  const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true })));
  files.set(slash(target), generator.dmmfToTypes(generator.externalToInternalDmmf(dmmf))
    .replace(/(['"])(?:\.\/runtime\/library|@prisma\/client\/library)\1/gu, '"@prisma/client/runtime/library"'));
  files.set(slash(path.join(path.dirname(target), 'schema.prisma')), schema);
  return dmmf.datamodel.models.length;
}
const options = { strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, declaration: true, rootDir: slash(path.dirname(project) + '/src'),
  outDir: slash(path.dirname(project) + '/dist'), paths: { '@own': [slash(path.dirname(project) + '/src/index.ts')] } };
let checks = 0;
const check = (name, work) => { work(); checks++; console.log('PASS ' + name); };
const select = (mode = 'rental', extra = {}, opts = options) => selectedCompilerOptions(ts, project, opts, { client, mode, ...extra }, read);
check('CLI 缺选择/相对继承/冲突/未知参数明确拒绝', () => {
  assert.throws(() => parseArguments(['--project', 'tsconfig.json', '--mode', 'rental'], {}, root), /缺少所选/);
  assert.throws(() => parseArguments(['--project', 'tsconfig.json', '--mode', 'rental'], { RENTAL_PRISMA_CLIENT: './client/index.d.ts' }, root), /绝对路径/);
  assert.throws(() => parseArguments(['--project', 'tsconfig.json', '--mode', 'rental', '--client', client], { RENTAL_PRISMA_CLIENT: path.join(root, 'other/index.d.ts') }, root), /冲突/);
  assert.throws(() => parseArguments(['--generate'], {}, root), /未知/);
  assert.equal(parseArguments(['--project', project, '--mode', 'rental', '--noEmit'], { RENTAL_PRISMA_CLIENT: client }, root).client, path.resolve(client));
});
check('缺失声明不能回退默认模板', () => assert.throws(() => select(), /声明.*缺失/));
check('161 官方声明保留 rootDir、outDir 与正式自引用', () => {
  assert.equal(generated(rentalSchema), 161);
  const selected = select();
  assert.equal(selected.models, 161); assert.equal(selected.options.rootDir, options.rootDir); assert.equal(selected.options.outDir, options.outDir);
  assert.deepEqual(selected.options.paths['@own'], options.paths['@own']);
  assert.deepEqual(selected.options.paths['@prisma/client'], [client]);
  assert.equal(options.paths['@prisma/client'], undefined);
});
check('161 不满足 AI，公共40不能冒充 Rental', () => {
  assert.throws(() => select('rental-ai'), /模型要求/);
  generated(publicSchema); assert.throws(() => select(), /模型要求/); generated(rentalSchema);
});
check('schema 与声明模型集合不同拒绝', () => {
  files.set(schemaFile, publicSchema); assert.throws(() => select(), /模型集合不一致/); files.set(schemaFile, rentalSchema);
});
check('默认 Client、模板转出口与不同 tsconfig 选择拒绝', () => {
  assert.throws(() => select('rental', { client: slash(path.join(root, 'node_modules/.prisma/client/index.d.ts')) }), /默认/);
  const original = files.get(client); files.set(client, 'export * from ".prisma/client/default";');
  assert.throws(() => select(), /完整 Prisma Client/); files.set(client, original);
  assert.throws(() => select('rental', {}, { ...options, paths: { '@prisma/client': ['./another/index.d.ts'] } }), /另一个 Client/);
});
function compile(mode, ai = false, noEmit = false) {
  const source = options.rootDir + '/__selected-build-fixture.ts';
  files.set(source, 'import type { PrismaClient } from "@prisma/client";\nexport function orders(db: PrismaClient) { return db.rentalOrder.findMany(); }\n'
    + (ai ? 'export function tasks(db: PrismaClient) { return db.aiTask.findMany(); }\n' : ''));
  const selected = select(mode), compilerOptions = { ...selected.options, noEmit }, host = ts.createCompilerHost(compilerOptions), emitted = new Map();
  const mapDependency = file => slash(file).startsWith(slash(root) + '/node_modules/') ? slash(deps) + slash(file).slice((slash(root) + '/node_modules').length) : file;
  host.readFile = file => files.get(slash(file)) ?? ts.sys.readFile(mapDependency(file));
  host.fileExists = file => files.has(slash(file)) || !/\/.prisma\/client\//u.test(slash(file)) && ts.sys.fileExists(mapDependency(file));
  host.directoryExists = file => [...files.keys()].some(key => key.startsWith(slash(file) + '/')) || ts.sys.directoryExists(mapDependency(file));
  host.getDirectories = file => ts.sys.getDirectories(mapDependency(file));
  host.realpath = slash;
  host.getSourceFile = (file, version) => { const text = host.readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, version, true); };
  host.writeFile = (file, text) => { assert(slash(file).startsWith(options.outDir + '/')); emitted.set(slash(file), text); };
  host.resolveModuleNames = (names, containing) => names.map(name => ts.resolveModuleName(name, containing, compilerOptions, host).resolvedModule
    ?? ts.resolveModuleName(name, slash(deps) + '/fixture.ts', compilerOptions, host).resolvedModule);
  const program = ts.createProgram({ rootNames: [source], options: compilerOptions, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (!diagnostics.length) diagnostics.push(...program.emit().diagnostics);
  return { diagnostics, emitted };
}
check('161 真实 emit 的 d.ts 保持 @prisma/client 消费者解析', () => {
  const result = compile('rental');
  assert.deepEqual(result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  const declaration = [...result.emitted].find(([file]) => file.endsWith('.d.ts'))?.[1];
  assert(declaration.includes('from "@prisma/client"')); assert(!declaration.includes('generated/client'));
});
check('161 缺 AI 模型产生真实 TS 诊断且零 emit', () => {
  const result = compile('rental', true); assert(result.diagnostics.some(d => d.code === 2339)); assert.equal(result.emitted.size, 0);
});
check('247 真实 emit/noEmit 都消费同一选中声明', () => {
  assert.equal(generated(aiSchema), 247); assert.equal(select('rental-ai').models, 247);
  const emitted = compile('rental-ai', true), checked = compile('rental-ai', true, true);
  assert.deepEqual(emitted.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  assert.equal(checked.diagnostics.length, 0); assert.equal(checked.emitted.size, 0); assert(emitted.emitted.size > 0);
});
check('旧241显式兼容，与独立宿主边界分离', () => {
  const legacy = slash(path.join(root, 'apps/api/node_modules/.prisma/client/index.d.ts'));
  const schema = fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  assert.equal(generated(schema, legacy), 241);
  const selected = select('rental-ai', { client: legacy, legacy: true }); assert.equal(selected.models, 241);
  assert.throws(() => selectedCompilerOptions(ts, path.join(root, 'apps/rental-api/tsconfig.ai.json'), options,
    { client: legacy, mode: 'rental-ai', legacy: true }, read), /独立宿主禁止/);
});
assert.equal(fs.existsSync(temporary), false);
console.log(JSON.stringify({ checks, prisma: '5.22.0', models: [161, 247, 241], diskOutputs: 0, clientInstantiated: false }));
