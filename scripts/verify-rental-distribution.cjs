'use strict';
/** Rental 独立发行核验：固定 Git 树、真实配置分包 emit 和官方 Prisma 只驻内存。
 * 检查 Native 产物、标准归档/安装准备、可选 AI 数据及五端正式包消费。
 * 公开发行另核对独立仓根目录的固定标签与构建字节，准备成功后只写一个新归档。
 * 不安装依赖、实例化 Client、连接数据库、启动服务或发布 GitHub Release。
 * node scripts/verify-rental-distribution.cjs --commit <完整SHA> [--deps <只读node_modules>]
 * node scripts/verify-rental-distribution.cjs --portable --commit <构建SHA> --platform-commit <底座SHA>
 *   --source-repository <底座的规范仓库地址>
 *   --core-repo <独立仓根目录> --core-commit <v版本的提交SHA> --out <未占用的rental-版本.tgz>
 * --build-repo 可指向单独取得的固定底座 Git 对象目录；业务源码读取独立 Core 标签。
 * 独立 Core 标签不必与底座内的旧 Rental 子树相同，仍须通过同一合同/实际编译/归档检查。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createBuild, verifyContracts } = require('./check-rental-package-build.cjs');
const { createMemoryBuild } = require('./rental-build-memory.cjs');
const { readBuildSnapshot } = require('./rental-build-snapshot.cjs');
const { readIndependentRentalSource, readRentalBuildSupport, composeRentalBuildSnapshot } = require('./prepare-rental-workspace.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const rentalSourceDirectory = 'packages/rental-core';
const platformGuidePath = 'packages/core-contracts/README.md';
const fullCommit = /^[a-f0-9]{40}$/u;

function git(directory, args) {
  return execFileSync('git', ['--no-replace-objects', ...args], { cwd: directory, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

function sourceRepository(directory = root, explicitRepository) {
  // GitHub 更名后的规范来源须显式固定；本地旧 remote 的重定向不应改变版本来源。
  const origin = explicitRepository ?? git(directory, ['config', '--get', 'remote.origin.url']).toString('utf8').trim();
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u.exec(origin);
  const url = new URL(ssh ? 'https://github.com/' + ssh[1] : origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('发行来源须为无凭据的 HTTPS 仓库地址');
  return url.href.replace(/\.git\/?$/u, '').replace(/\/$/u, '');
}

function fixedPortableSource(options, documentationSource, buildDirectory) {
  const directory = path.resolve(options.get('--core-repo'));
  if (slash(git(directory, ['rev-parse', '--show-toplevel']).toString('utf8').trim()) !== slash(directory))
    throw Error('公开 Core 来源须指定独立 Git 仓库根目录');
  const rental = readIndependentRentalSource(directory, options.get('--core-commit'), { mode: 'release' });
  const repository = rental.source.repository;
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
    || repository.toLowerCase() === documentationSource.repository.toLowerCase())
    throw Error('公开 Core 来源须为独立的 GitHub 仓库');
  const commit = options.get('--core-commit');
  const version = rental.metadata.version, tag = rental.tag;
  // Core 独立标签是业务源码的权威来源；固定底座只提供合同和构建支持。
  // 两者组合后重新编译，而不是强制业务改动先回写底座仓库。
  const legacySupport = rental.layoutKind === 'legacy-root';
  if (!legacySupport && !rental.layout.paths.some(entry => entry.target === 'apps/rental-api' && entry.roles.includes('host')))
    throw Error('正式发行缺少独立 Rental API 宿主源码；不能使用底座旧业务副本');
  const snapshot = legacySupport ? readBuildSnapshot(documentationSource.commit, buildDirectory)
    : readRentalBuildSupport(documentationSource.commit, buildDirectory, rental);
  const combined = composeRentalBuildSnapshot(snapshot, rental, { legacySupport });
  const output = path.resolve(options.get('--out'));
  const relative = path.relative(root, output).split(path.sep);
  if (path.basename(output) !== `rental-${version}.tgz` || relative[0]?.toLowerCase() === 'docs')
    throw Error('公开 Core 输出须为私有资料目录之外的新 rental-<版本>.tgz 文件');
  if (fs.existsSync(output)) throw Error('目标归档已存在，不覆盖用户产物');
  return { source: { repository, commit }, tag, output, documentationSource, snapshot: combined,
    layout: rental.layoutKind, checkoutRepository: rental.checkoutRepository,
    packageRoot: rental.layout.paths.find(entry => entry.target === 'packages/rental-core').source };
}

function generatePrismaDeclarations(build, schemas) {
  const { deps, requireDeps, virtual } = build;
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
  const declarations = [];
  for (const [label, text] of schemas) {
    const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: text, noColor: true })));
    const types = generator.dmmfToTypes(generator.externalToInternalDmmf(dmmf))
      .replace(/(['"])(?:\.\/runtime\/library|@prisma\/client\/library)\1/gu, '"@prisma/client/runtime/library"');
    const directory = slash(path.join(root, `apps/${label === 'public' ? 'platform' : 'rental'}-api/generated/client`));
    virtual.set(directory + '/index.d.ts', types);
    virtual.set(directory + '/schema.prisma', text);
    declarations.push({ schema: label, models: dmmf.datamodel.models.length,
      sha256: createHash('sha256').update(text).digest('hex') });
  }
  build.prismaWasm = wasm;
  if (!build.quiet) console.log(JSON.stringify({ prisma: '5.22.0', declarations, diskOutputs: 0 }));
}

function selectedPrisma(build) {
  const { ts, load, exported } = build;
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
  generatePrismaDeclarations(build, [['rental', schema], ['public', publicSchema]]);
  const rentalClient = slash(path.join(root, 'apps/rental-api/generated/client/index.d.ts'));
  for (const pkg of ['packages/rental-core', 'apps/rental-api']) build.selectedClients.set(slash(path.join(root, pkg)),
    { client: rentalClient, mode: 'rental' });
  build.selectedClients.set(slash(path.join(root, 'apps/platform-api')),
    { client: slash(path.join(root, 'apps/platform-api/generated/client/index.d.ts')), mode: 'platform' });
  build.prismaSchema = schema;
  return { schema, publicSchema, publicRelations: relationModule.exports.RENTAL_PRISMA_PUBLIC_RELATIONS };
}

async function attachPrismaRuntime(build, selection = {}) {
  if (!selection.schema && !build.prismaSchema) selectedPrisma(build);
  const schema = selection.schema ?? build.prismaSchema;
  const generatorFile = build.deps + '/@prisma/client/generator-build/index.js';
  const officialSource = fs.readFileSync(generatorFile, 'utf8');
  const generatedModule = { exports: {} };
  const buildClient = new Function('require', 'module', 'exports', '__filename', '__dirname',
    officialSource + '\nreturn buildClient;')(createRequire(generatorFile), generatedModule,
    generatedModule.exports, generatorFile, path.dirname(generatorFile));
  const parsedConfiguration = JSON.parse(build.prismaWasm.get_config(JSON.stringify({
    prismaSchema: schema, ignoreEnvVarErrors: true
  })));
  assert.deepEqual(parsedConfiguration.errors, []);
  const configuration = parsedConfiguration.config;
  const directory = slash(selection.directory ?? path.join(root, 'apps/rental-api/generated/client'));
  const result = await buildClient({ schemaPath: selection.schemaPath ?? path.join(root, 'apps/rental-api/prisma/schema.prisma'),
    runtimeBase: '@prisma/client/runtime', datamodel: schema, binaryPaths: {}, outputDir: directory,
    generator: configuration.generators[0], datasources: configuration.datasources,
    dmmf: JSON.parse(build.prismaWasm.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true }))),
    clientVersion: '5.22.0', engineVersion: build.requireDeps('@prisma/engines-version').enginesVersion,
    activeProvider: 'mysql', copyEngine: false, postinstall: false,
    envPaths: { rootEnvPath: null, schemaEnvPath: undefined } });
  for (const [file, text] of Object.entries(result.fileMap)) if (file.endsWith('.js'))
    build.outputs.set(directory + '/' + file, text);
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

/** Package inputs come only from the fixed source map and this build's actual emits. */
function rentalPackageInputs(build) {
  const packageRoot = slash(path.join(root, rentalSourceDirectory));
  const files = new Map();
  if (!build.snapshot) throw Error('标准归档须从固定 Git 快照编译，不能给活动 WIP 标旧 HEAD 来源');
  const tracked = [...build.snapshot.files.keys()].filter(file => file.startsWith(packageRoot + '/'))
    .map(file => file.slice(slash(root).length + 1));
  for (const filename of tracked) {
    const relative = filename.slice(rentalSourceDirectory.length + 1);
    if (!/^(?:src\/|admin\/|clients\/|prisma\/|package\.json$|README\.md$|LICENSE$)/u.test(relative)) continue;
    const file = path.join(root, filename);
    files.set(relative, build.snapshot.files.get(slash(file)));
  }
  for (const [file, text] of build.outputs) {
    if (file.startsWith(packageRoot + '/dist/') || file.startsWith(packageRoot + '/dist-clients/'))
      files.set(file.slice(packageRoot.length + 1), Buffer.from(text));
  }
  if (!files.has('LICENSE')) files.set('LICENSE', build.snapshot.files.get(slash(path.join(root, 'LICENSE'))));
  return files;
}

function verifyPackage(build, portable, buildSource) {
  build.compile('apps/platform-api/tsconfig.json');
  build.compile('packages/ai-native-data/tsconfig.json');
  build.compile('apps/rental-api/tsconfig.json');
  const files = rentalPackageInputs(build), packageRoot = slash(path.join(root, rentalSourceDirectory));
  const source = portable?.source ?? buildSource ?? { repository: sourceRepository(), commit: build.snapshot.commit };
  // 校验所选 Git 底座和实际 Node，不能用固定的虚构宿主版本验证 Core 依赖。
  const host = portable?.host ?? {
    platform: JSON.parse(build.sourceRead(path.join(root, 'package.json'))).version,
    contract: build.load(build.exported('@rental-os/core-contracts', true)).CORE_CONTRACT_VERSION,
    node: process.versions.node, capabilities: {}
  };
  const packageFactory = build.load(build.exported('@rental-os/rental-api/package', true));
  const input = { files, source, sourceDirectory: rentalSourceDirectory, platformSource: portable?.platformSource ?? source, host,
    documentationSource: portable?.documentationSource,
    platformGuide: portable?.platformGuide ?? build.sourceRead(path.join(root, platformGuidePath)) };
  const edition = portable ? 'portable' : 'legacy-host';
  const packed = packageFactory.createRentalHostPackage(input, edition);
  const archive = build.load(build.exported('@rental-os/core-contracts/archive', true));
  const decoded = archive.readCoreArchive(packed.bytes, packed.sha256);
  assert.equal(decoded.sha256, packed.sha256);
  assert.equal(decoded.files.size, packed.fileCount);
  assert.equal(packageFactory.createRentalHostPackage(input, edition).sha256, packed.sha256, '固定快照归档不确定');
  const memory = createMemoryBuild(build);
  const install = memory.load(build.exported('@rental-os/core-contracts/install', true));
  const legacyRoutes = portable ? [] : build.load(build.exported('@rental-os/rental-api/openapi', true)).rentalHostLegacyApiRoutes();
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
  if (portable) return packed;
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
  assert.equal((disabled.files.get('schema.prisma').toString().match(/^model /gm) || []).length, 162);
  assert.equal((enabled.files.get('schema.prisma').toString().match(/^model /gm) || []).length, 248);
  for (const migration of aiRelease.data.migrations)
    assert.deepEqual(enabled.files.get(`migrations/platform-capability.${migration.id}/migration.sql`), aiDecoded.files.get(migration.file));
  console.log(JSON.stringify({ aiData: { files: aiFiles.size, bytes: aiArchive.bytes.length, sha256: aiArchive.sha256,
    sourceCommit: source.commit, migrations: aiRelease.data.migrations.length, mysqlData: 'compiled-and-loaded' },
    deploymentSchemas: [disabled, enabled].map(candidate => (candidate.files.get('schema.prisma').toString().match(/^model /gm) || []).length),
    deployment: 'pending', filesystem: 'memory', database: 'not-connected', diskOutputs: 0 }));
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
  // These projects include their Node-side Vite configs. The OpenAPI export
  // used to validate the package pin carries declarations from the Rental
  // host. Resolve them against that same selected Client, never a default one.
  const viteProjects = ['enterprise-portal', 'rental-admin'].map(app => slash(path.join(root, 'apps', app)));
  const rentalClient = build.selectedClients.get(slash(path.join(root, 'apps/rental-api')));
  assert(rentalClient, '构建配置须沿 Rental 宿主所选 Client 解析服务端声明');
  for (const project of viteProjects) build.selectedClients.set(project, rentalClient);
  try {
    for (const app of ['miniprogram', 'staff-miniprogram', 'tenant-website', 'enterprise-portal', 'rental-admin']) {
      const { program } = build.compile(`apps/${app}/tsconfig.json`);
      for (const source of program.getSourceFiles()) assert(!slash(source.fileName).startsWith(original.directory + '/'),
        '客户端退回作者 Rental 目录：' + source.fileName);
    }
  } finally {
    for (const project of viteProjects) build.selectedClients.delete(project);
    build.packages.set('@rental-os/rental-core', original);
  }
  console.log(JSON.stringify({ consumers: 5, rentalSource: 'installed-archive-only', diskOutputs: 0 }));
}

function parseArguments(args) {
  const options = new Map();
  const portableKeys = ['--core-repo', '--core-commit', '--platform-commit', '--out'];
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (options.has(key)) throw Error('重复发行核验选项：' + key);
    if (key === '--portable') options.set(key, true);
    else if (['--deps', '--commit', '--source-repository', '--build-repo', ...portableKeys].includes(key) && args[index + 1] && !args[index + 1].startsWith('--'))
      options.set(key, args[++index]);
    else throw Error('未知或缺少值的发行核验选项：' + key);
  }
  if (options.has('--portable') && ['--commit', ...portableKeys].some(key => !options.has(key)))
    throw Error('公开发行须提供构建及底座提交、独立仓根目录、标签提交和新输出文件');
  if (!options.has('--portable') && portableKeys.some(key => options.has(key)))
    throw Error('公开发行选项须与 --portable 一起使用');
  for (const key of ['--commit', '--core-commit', '--platform-commit'])
    if (options.has(key) && !fullCommit.test(options.get(key))) throw Error(`${key} 须为完整固定提交 SHA`);
  return options;
}

async function main(args) {
  const options = parseArguments(args);
  const deps = options.get('--deps') ?? path.join(root, 'node_modules');
  const commit = options.get('--commit') ?? git(root, ['rev-parse', 'HEAD']).toString('ascii').trim();
  const buildDirectory = options.get('--build-repo') ? path.resolve(options.get('--build-repo')) : root;
  const buildSource = { repository: sourceRepository(buildDirectory, options.get('--source-repository')), commit };
  const portable = options.has('--portable')
    ? fixedPortableSource(options, buildSource, buildDirectory) : undefined;
  const build = createBuild(deps, { snapshot: portable?.snapshot ?? readBuildSnapshot(commit, buildDirectory) });
  verifyContracts(build);
  verifyServer(build);
  if (portable) {
    const api = build.load(build.exported('@rental-os/core-contracts', true));
    const { readPlatformSourceFromGit } = build.load(build.exported('@rental-os/core-contracts/platform-source', true));
    const platformSource = { repository: portable.documentationSource.repository, commit: options.get('--platform-commit') };
    const platform = await readPlatformSourceFromGit(buildDirectory, platformSource);
    const contractFile = 'packages/core-contracts/src/manifest.ts';
    const contract = platform.files.get(contractFile);
    if (!contract || !Buffer.from(contract).equals(build.snapshot.files.get(slash(path.join(root, contractFile)))))
      throw Error('选定底座与 Rental 构建所用 Core 版本契约不同');
    Object.assign(portable, { platformSource,
      platformGuide: git(buildDirectory, ['cat-file', 'blob', `${platformSource.commit}:${platformGuidePath}`]).toString('utf8'),
      host: { platform: platform.version, contract: api.CORE_CONTRACT_VERSION, node: '24.13.0', capabilities: {} } });
  }
  verifyNative(build);
  await attachPrismaRuntime(build);
  const packed = verifyPackage(build, portable, buildSource);
  if (portable) {
    const { writeArchive } = require('./package-rental-host.cjs');
    writeArchive(portable.output, packed.bytes);
    console.log(JSON.stringify({ status: 'packaged', mode: 'portable', output: portable.output,
      source: portable.source, tag: portable.tag, documentationSource: portable.documentationSource,
      platformSource: portable.platformSource, layout: portable.layout, packageRoot: portable.packageRoot,
      checkoutRepository: portable.checkoutRepository, profile: 'core-package', ai: false, mcp: false,
      files: packed.fileCount, bytes: packed.bytes.length,
      sha256: packed.sha256, install: 'prepared', deployment: 'pending' }));
    return;
  }
  verifyConsumers(build);
  console.log(JSON.stringify({ status: 'passed', mode: 'rental-distribution', sourceCommit: commit, stages: build.stages.length,
    emittedFiles: build.outputs.size, diskOutputs: 0 }));
}
if (require.main === module) {
  main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { generatePrismaDeclarations, selectedPrisma, verifyServer, verifyNative, rentalPackageInputs, verifyPackage, verifyConsumers, attachPrismaRuntime };
