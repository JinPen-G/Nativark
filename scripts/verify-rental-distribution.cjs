'use strict';
/** Rental 独立发行核验：固定 Git 树、真实配置分包 emit 和官方 Prisma 只驻内存。
 * 检查 Native 产物、标准归档/安装准备、可选 AI 数据及五端正式包消费。
 * 不安装依赖、实例化 Client、连接数据库、启动服务或代替磁盘发布和真实宿主验收。
 * node scripts/verify-rental-distribution.cjs --commit <完整SHA> [--deps <只读node_modules>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createBuild, verifyContracts } = require('./check-rental-package-build.cjs');
const { createMemoryBuild } = require('./rental-build-memory.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');

function sourceRepository() {
  const origin = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim();
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u.exec(origin);
  const url = new URL(ssh ? 'https://github.com/' + ssh[1] : origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('发行来源须为无凭据的 HTTPS 仓库地址');
  return url.href.replace(/\.git\/?$/u, '').replace(/\/$/u, '');
}

function selectedPrisma(build) {
  const { deps, requireDeps, ts, virtual, load, exported } = build;
  for (const name of ['prisma', '@prisma/client'])
    assert.equal(JSON.parse(fs.readFileSync(`${deps}/${name}/package.json`, 'utf8')).version, '5.22.0');
  const cliFile = deps + '/prisma/build/index.js', cli = fs.readFileSync(cliFile, 'utf8');
  const start = cli.indexOf('var yI=S('), end = cli.indexOf(';var bI=S(', start);
  if (start < 0 || end < 0) throw Error('原 Prisma 5.22 官方 WASM wrapper 不可用');
  const S = (initialize, cache) => () => {
    if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); }
    return cache.exports;
  };
  const wasm = new Function('S', 'require', '__dirname', cli.slice(start, end) + ';return yI();')(
    S, createRequire(cliFile), path.dirname(cliFile));
  const generator = requireDeps('@prisma/client/generator-build/index.js');
  const publicSchema = build.sourceRead(path.join(root, 'apps/platform-api/prisma/schema.prisma'));
  // This file is a literal relation contribution with only an erased type import.
  // The schema bootstrap needs it before the complete Rental server can compile.
  const relationSource = build.sourceRead(path.join(root, 'packages/rental-core/src/prisma-public-relations.ts'));
  const relationText = ts.transpileModule(relationSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const relationModule = { exports: {} };
  new Function('exports', relationText)(relationModule.exports);
  const schema = load(exported('@rental-os/core-contracts/prisma', true)).composeCorePrismaSchema(publicSchema, [{
    id: 'rental', schema: build.sourceRead(path.join(root, 'packages/rental-core/prisma/schema.prisma')),
    publicRelations: relationModule.exports.RENTAL_PRISMA_PUBLIC_RELATIONS
  }]);
  const declarations = [];
  for (const [label, text] of [['rental', schema], ['public', publicSchema]]) {
    const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: text, noColor: true })));
    const types = generator.dmmfToTypes(generator.externalToInternalDmmf(dmmf))
      .replace(/(['"])(?:\.\/runtime\/library|@prisma\/client\/library)\1/gu, '"@prisma/client/runtime/library"');
    if (label === 'rental') {
      for (const directory of [deps, slash(path.join(root, 'node_modules'))]) {
        virtual.set(directory + '/.prisma/client/index.d.ts', types);
        virtual.set(directory + '/.prisma/client/default.d.ts', 'export * from "./index";');
      }
    }
    virtual.set(slash(path.join(root, `apps/${label === 'public' ? 'platform' : 'rental'}-api/generated/client/index.d.ts`)), types);
    declarations.push({ schema: label, models: dmmf.datamodel.models.length,
      sha256: createHash('sha256').update(text).digest('hex') });
  }
  console.log(JSON.stringify({ prisma: '5.22.0', declarations, diskOutputs: 0 }));
  build.prismaSchema = schema;
  build.prismaWasm = wasm;
  return { schema, publicSchema, publicRelations: relationModule.exports.RENTAL_PRISMA_PUBLIC_RELATIONS };
}

async function attachPrismaRuntime(build) {
  if (!build.prismaSchema) selectedPrisma(build);
  const generatorFile = build.deps + '/@prisma/client/generator-build/index.js';
  const officialSource = fs.readFileSync(generatorFile, 'utf8');
  const generatedModule = { exports: {} };
  const buildClient = new Function('require', 'module', 'exports', '__filename', '__dirname',
    officialSource + '\nreturn buildClient;')(createRequire(generatorFile), generatedModule,
    generatedModule.exports, generatorFile, path.dirname(generatorFile));
  const parsedConfiguration = JSON.parse(build.prismaWasm.get_config(JSON.stringify({
    prismaSchema: build.prismaSchema, ignoreEnvVarErrors: true
  })));
  assert.deepEqual(parsedConfiguration.errors, []);
  const configuration = parsedConfiguration.config;
  const directory = slash(path.join(root, 'apps/rental-api/generated/client'));
  const result = await buildClient({ schemaPath: path.join(root, 'apps/rental-api/prisma/schema.prisma'),
    runtimeBase: '@prisma/client/runtime', datamodel: build.prismaSchema, binaryPaths: {}, outputDir: directory,
    generator: configuration.generators[0], datasources: configuration.datasources,
    dmmf: JSON.parse(build.prismaWasm.get_dmmf(JSON.stringify({ prismaSchema: build.prismaSchema, noColor: true }))),
    clientVersion: '5.22.0', engineVersion: build.requireDeps('@prisma/engines-version').enginesVersion,
    activeProvider: 'mysql', copyEngine: false, postinstall: false,
    envPaths: { rootEnvPath: null, schemaEnvPath: undefined } });
  for (const [file, text] of Object.entries(result.fileMap)) if (file.endsWith('.js'))
    build.outputs.set(directory + '/' + file, text);
  build.runtimeAliases.set('@prisma/client', directory + '/index.js');
  const runtime = build.load(directory + '/index.js');
  assert.equal(runtime.Prisma.TransactionIsolationLevel.Serializable, 'Serializable');
  console.log(JSON.stringify({ prismaRuntime: 'official-5.22.0', clientInstantiated: false, enginesCopied: 0, diskOutputs: 0 }));
}

function verifyServer(build) {
  build.compile('packages/core-contracts/tsconfig.json');
  const selected = selectedPrisma(build);
  for (const pkg of ['platform-server', 'core-host', 'platform-core-host', 'rental-core'])
    build.compile(`packages/${pkg}/tsconfig.json`);
  assert.deepEqual(build.load(path.join(root, 'packages/rental-core/dist/prisma-public-relations.js'))
    .RENTAL_PRISMA_PUBLIC_RELATIONS, selected.publicRelations);
  return selected;
}

function verifyNative(build) {
  const memory = createMemoryBuild(build);
  const native = memory.load(path.join(root, 'scripts/miniprogram-shared-types.cjs'));
  const output = path.join(memory.task, 'native-package');
  const result = native.buildRentalNativeClients(path.join(root, 'packages/rental-core'), ['--out-dir', output]);
  const files = memory.files(output);
  for (const [file, bytes] of files) {
    const target = slash(path.join(root, 'packages/rental-core/dist-clients', file));
    build.outputs.set(target, bytes.toString('utf8'));
  }
  for (const entry of ['miniprogram', 'staff', 'time'])
    assert(Object.keys(build.load(build.exported('@rental-os/rental-core/clients/' + entry, true))).length);
  console.log(JSON.stringify({ native: result, packageFiles: files.size, diskOutputs: 0 }));
  return files;
}

function verifyPackage(build) {
  build.compile('apps/platform-api/tsconfig.json');
  build.compile('packages/ai-native-data/tsconfig.json');
  build.compile('apps/rental-api/tsconfig.json');
  const packageRoot = slash(path.join(root, 'packages/rental-core'));
  const files = new Map();
  if (!build.snapshot) throw Error('标准归档须从固定 Git 快照编译，不能给活动 WIP 标旧 HEAD 来源');
  const tracked = [...build.snapshot.files.keys()].filter(file => file.startsWith(packageRoot + '/'))
    .map(file => file.slice(slash(root).length + 1));
  for (const filename of tracked) {
    const relative = filename.slice('packages/rental-core/'.length);
    if (!/^(?:src\/|admin\/|clients\/|prisma\/|package\.json$|README\.md$|LICENSE$)/u.test(relative)) continue;
    const file = path.join(root, filename);
    files.set(relative, build.snapshot.files.get(slash(file)));
  }
  for (const [file, text] of build.outputs) {
    if (file.startsWith(packageRoot + '/dist/') || file.startsWith(packageRoot + '/dist-clients/'))
      files.set(file.slice(packageRoot.length + 1), Buffer.from(text));
  }
  if (!files.has('LICENSE')) files.set('LICENSE', build.snapshot.files.get(slash(path.join(root, 'LICENSE'))));
  const source = { repository: sourceRepository(),
    commit: build.snapshot.commit };
  const host = { platform: '0.1.0', contract: '0.1.1', node: '22.12.0', capabilities: {} };
  const packageFactory = build.load(build.exported('@rental-os/rental-api/package', true));
  const input = { files, source, sourceDirectory: 'packages/rental-core', platformSource: source, host,
    platformGuide: build.sourceRead(path.join(root, 'packages/core-contracts/README.md')) };
  const packed = packageFactory.createRentalHostPackage(input);
  const archive = build.load(build.exported('@rental-os/core-contracts/archive', true));
  const decoded = archive.readCoreArchive(packed.bytes, packed.sha256);
  assert.equal(decoded.sha256, packed.sha256);
  assert.equal(decoded.files.size, packed.fileCount);
  assert.equal(packageFactory.createRentalHostPackage(input).sha256, packed.sha256, '固定快照归档不确定');
  const memory = createMemoryBuild(build);
  const install = memory.load(build.exported('@rental-os/core-contracts/install', true));
  const legacyRoutes = build.load(build.exported('@rental-os/rental-api/openapi', true)).rentalHostLegacyApiRoutes();
  const destination = path.join(memory.task, 'install');
  memory.fs.mkdirSync(destination, { recursive: true });
  const prepared = install.prepareCoreInstall(packed.bytes, packed.sha256, destination, host, packed.manifest, legacyRoutes);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.deployment, 'pending');
  const repeated = install.prepareCoreInstall(packed.bytes, packed.sha256, destination, host, packed.manifest, legacyRoutes);
  assert.equal(repeated.status, 'already_prepared');
  const pin = { manifest: packed.manifest, sha256: packed.sha256 };
  const installed = memory.load(build.exported('@rental-os/rental-core/data-package', true))
    .requireRentalDataPackage(prepared.directory, pin, host, legacyRoutes);
  assert.equal(installed.sha256, packed.sha256);
  assert(installed.schema.includes('model RentalOrder'));
  // Actually resolve and execute the unpacked server entry in its installed
  // directory. No database, app bootstrap or business action is invoked.
  const server = memory.load(path.join(prepared.directory, installed.manifest.entries.server));
  assert.equal(server.RENTAL_CORE_ID, 'rental');
  assert.equal(typeof server.createRentalServer, 'function');
  for (const entry of ['miniprogram/index', 'staff/index', 'time'])
    assert(Object.keys(memory.load(path.join(prepared.directory, 'dist-clients/clients/' + entry + '.js'))).length);
  build.installation = { directory: slash(prepared.directory), files: decoded.files };
  const aiRoot = slash(path.join(root, 'packages/ai-native-data'));
  const aiFiles = new Map();
  for (const [file, bytes] of build.snapshot.files) if (file.startsWith(aiRoot + '/')) {
    const relative = file.slice(aiRoot.length + 1);
    if (/^(?:prisma\/|package\.json$|README\.md$|LICENSE$)/u.test(relative)) aiFiles.set(relative, bytes);
  }
  for (const [file, text] of build.outputs) if (file.startsWith(aiRoot + '/dist/'))
    aiFiles.set(file.slice(aiRoot.length + 1), Buffer.from(text));
  if (!aiFiles.has('LICENSE')) aiFiles.set('LICENSE', build.snapshot.files.get(slash(path.join(root, 'LICENSE'))));
  const aiData = build.load(build.exported('@rental-os/ai-native-data/data-package', true));
  const aiRelease = aiData.createAiNativeDataRelease({ files: aiFiles, source });
  const aiArchive = archive.createCoreArchive(aiFiles), aiDecoded = archive.readCoreArchive(aiArchive.bytes, aiRelease.sha256);
  const aiDirectory = path.join(memory.task, 'ai-data-package');
  for (const [file, bytes] of aiDecoded.files) memory.put(path.join(aiDirectory, file), bytes);
  const installedAi = memory.load(build.exported('@rental-os/ai-native-data/data-package', true))
    .requireAiNativeDataPackage(aiDirectory, aiRelease);
  assert.equal(installedAi.release.sha256, aiArchive.sha256);
  assert.equal(typeof memory.load(path.join(aiDirectory, 'dist/mysql-data.js')).createAiNativeMysqlDataPlanFromContribution, 'function');
  assert(aiDecoded.files.get('dist/mysql-data.d.ts').byteLength > 0);
  const missingMysql = new Map(aiDecoded.files); missingMysql.delete('dist/mysql-data.js');
  assert.throws(() => aiData.readAiNativeDataPackage(missingMysql, aiRelease));
  const publicRoot = slash(path.join(root, 'apps/platform-api'));
  const platform = memory.load(build.exported('@rental-os/platform-api/data-plan', true)).createPublicPlatformDataPlan();
  const platformFiles = new Map();
  for (const [file, bytes] of build.snapshot.files) if (file.startsWith(publicRoot + '/'))
    platformFiles.set(file.slice(publicRoot.length + 1), bytes);
  for (const [file, text] of build.outputs) if (file.startsWith(publicRoot + '/dist/'))
    platformFiles.set(file.slice(publicRoot.length + 1), Buffer.from(text));
  // This digest identifies the exact public-host materials used for preparation;
  // it is not a claim that a complete platform release has been deployed.
  const release = { versions: host, source, sha256: archive.createCoreArchive(platformFiles).sha256, data: platform.data };
  const deploymentInput = { release, pin, coreFiles: decoded.files,
    publicSchema: build.sourceRead(publicRoot + '/prisma/schema.prisma'),
    publicMigrations: platform.migrationNames.map((name, index) => ({ name,
      sql: build.snapshot.files.get(publicRoot + '/' + platform.data.migrations[index].file) })) };
  const deployment = memory.load(path.join(root, 'apps/rental-api/dist/prepare-deployment.js'));
  const disabled = deployment.createRentalDeploymentFiles(deploymentInput);
  const enabled = deployment.createRentalDeploymentFiles({ ...deploymentInput, ai: { release: aiRelease, files: aiDecoded.files } });
  assert.equal(disabled.deployment, 'pending'); assert.equal(enabled.deployment, 'pending');
  assert.equal(disabled.aiMode, 'disabled'); assert.equal(enabled.aiMode, 'enabled');
  assert.equal((disabled.files.get('schema.prisma').toString().match(/^model /gm) || []).length, 161);
  assert.equal((enabled.files.get('schema.prisma').toString().match(/^model /gm) || []).length, 247);
  for (const migration of aiRelease.data.migrations)
    assert.deepEqual(enabled.files.get(`migrations/platform-capability.${migration.id}/migration.sql`), aiDecoded.files.get(migration.file));
  console.log(JSON.stringify({ aiData: { files: aiFiles.size, bytes: aiArchive.bytes.length, sha256: aiArchive.sha256,
    sourceCommit: source.commit, migrations: aiRelease.data.migrations.length, mysqlData: 'compiled-and-loaded' },
    deploymentSchemas: [161, 247], deployment: 'pending', filesystem: 'memory', database: 'not-connected', diskOutputs: 0 }));
  const tampered = Uint8Array.from(packed.bytes); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => install.prepareCoreInstall(tampered, packed.sha256, destination, host, packed.manifest, legacyRoutes));
  assert.throws(() => install.prepareCoreInstall(packed.bytes, packed.sha256, destination,
    { ...host, contract: '0.0.1' }, packed.manifest, legacyRoutes));
  assert.throws(() => install.prepareCoreInstall(packed.bytes, packed.sha256, destination, host,
    { ...packed.manifest, id: 'wrong-core' }, legacyRoutes));
  assert.throws(() => installed && install.requireCorePackagePin(packageRoot, pin, host, legacyRoutes));
  const modified = path.join(prepared.directory, 'dist/server.js');
  memory.fs.appendFileSync(modified, '\n// changed\n');
  assert.throws(() => install.requireCorePackagePin(prepared.directory, pin, host, legacyRoutes));
  assert.throws(() => install.prepareCoreInstall(packed.bytes, packed.sha256, destination, host, packed.manifest, legacyRoutes));
  console.log(JSON.stringify({ package: { files: packed.fileCount, bytes: packed.bytes.length, sha256: packed.sha256,
    sourceCommit: source.commit, candidateOnly: true }, install: 'prepared', repeat: 'already_prepared',
    deployment: 'pending', installedServer: 'loaded', negativeCases: 7, filesystem: 'memory', diskOutputs: 0 }));
  return packed;
}

function verifyConsumers(build) {
  assert(build.installation, '客户端核验须消费本次真实安装准备目录');
  const original = build.packages.get('@rental-os/rental-core');
  const { directory, files } = build.installation;
  for (const [file, bytes] of files) build.virtual.set(directory + '/' + file, bytes.toString('utf8'));
  build.packages.set('@rental-os/rental-core', { directory, metadata: JSON.parse(files.get('package.json').toString()) });
  try {
    for (const app of ['miniprogram', 'staff-miniprogram', 'tenant-website', 'enterprise-portal', 'rental-admin']) {
      const { program } = build.compile(`apps/${app}/tsconfig.json`);
      for (const source of program.getSourceFiles()) assert(!slash(source.fileName).startsWith(original.directory + '/'),
        '客户端退回作者 Rental 目录：' + source.fileName);
    }
  } finally { build.packages.set('@rental-os/rental-core', original); }
  console.log(JSON.stringify({ consumers: 5, rentalSource: 'installed-archive-only', diskOutputs: 0 }));
}

async function main(args) {
  let deps = path.join(root, 'node_modules'), commit;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--deps' && args[index + 1]) deps = args[++index];
    else if (args[index] === '--commit' && args[index + 1]) commit = args[++index];
    else throw Error('未知发行核验选项：' + args[index]);
  }
  commit ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const build = createBuild(deps, { commit });
  verifyContracts(build);
  verifyServer(build);
  verifyNative(build);
  await attachPrismaRuntime(build);
  verifyPackage(build);
  verifyConsumers(build);
  console.log(JSON.stringify({ status: 'passed', mode: 'rental-distribution', sourceCommit: commit, stages: build.stages.length,
    emittedFiles: build.outputs.size, diskOutputs: 0 }));
}
if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { selectedPrisma, verifyServer, verifyNative, verifyPackage, verifyConsumers, attachPrismaRuntime };
