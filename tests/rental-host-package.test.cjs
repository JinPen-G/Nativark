'use strict';
/** 独立宿主打包回归：真实配置 emit、正式包/部署准备及 CLI 文件运输全部驻内存。
 * 包来源使用明确的测试 fixture 身份，不伪称活动源码已在历史提交发布。
 * 官方 Client 仅供根模块构造，禁止连接/查询/运输/生命周期；不执行 Docker/npm安装/迁移。所有产物随进程释放。 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !path.isAbsolute(args[1] || '')))
  throw Error('只接受 --deps <node_modules绝对路径>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/dev2-host-package');
assert.equal(fs.existsSync(temporary), false);
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require('./fixtures/ai-native/prisma-offline-preload.cjs');
const { createBuild, verifyContracts } = require('../scripts/check-rental-package-build.cjs');
const { verifyServer, verifyNative, attachPrismaRuntime } = require('../scripts/verify-rental-distribution.cjs');
const { createMemoryBuild } = require('../scripts/rental-build-memory.cjs');
const { selectWorkspaces, projectHostLock } = require('../scripts/rental-host-lock.cjs');
const slash = file => path.resolve(file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
let checks = 0;
const check = (name, action) => { action(); checks++; console.log('PASS ' + name); };

function verificationMemory(build) {
  const memory = createMemoryBuild(build);
  // memfs derives birthtime from mutable ctime; retain native file identity
  // semantics while still checking dev/ino and replacements in every case.
  const births = new Map(), stableBirth = stat => {
    const key = stat.dev + ':' + stat.ino;
    if (!births.has(key)) births.set(key, stat.birthtimeMs);
    stat.birthtimeMs = births.get(key); return stat;
  };
  const lstat = memory.fs.lstatSync, fstat = memory.fs.fstatSync;
  memory.fs.fstatSync = descriptor => stableBirth(fstat(descriptor));
  memory.fs.lstatSync = (file, ...args) => {
    const stat = lstat(file, ...args);
    return slash(file).startsWith(slash(memory.task) + '/') ? stableBirth(stat) : stat;
  };
  return memory;
}

async function run() {
  const build = createBuild(deps);
  verifyContracts(build); verifyServer(build); verifyNative(build);
  for (const directory of ['apps/platform-api', 'packages/ai-native-data', 'apps/rental-api']) build.compile(directory + '/tsconfig.json');
  await attachPrismaRuntime(build);
  const disabledClient = { client: path.join(root, 'apps/rental-api/generated/client/index.d.ts'),
    declarations: build.virtual.get(slash(path.join(root, 'apps/rental-api/generated/client/index.d.ts'))), schema: build.prismaSchema };
  const platformClient = { client: path.join(root, 'apps/platform-api/generated/client/index.d.ts'),
    declarations: build.virtual.get(slash(path.join(root, 'apps/platform-api/generated/client/index.d.ts'))),
    schema: build.sourceRead(path.join(root, 'apps/platform-api/prisma/schema.prisma')) };
  build.compile('packages/example-tickets-core/tsconfig.json');
  build.compile('apps/example-tickets-api/tsconfig.json');
  build.selectedClients.set(slash(path.join(root, 'apps/example-multi-core-api')),
    { client: slash(disabledClient.client), mode: 'rental' });
  build.compile('apps/example-multi-core-api/tsconfig.json');
  const originalFiles = directory => {
    const files = new Map(), absolute = path.join(root, directory);
    const read = (current, prefix) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw Error('测试输入不接受链接');
        const file = path.join(current, entry.name), relative = prefix + entry.name;
        if (entry.isDirectory()) read(file, relative + '/'); else files.set(relative, fs.readFileSync(file));
      }
    };
    for (const folder of directory === 'packages/rental-core' ? ['src', 'admin', 'clients', 'prisma'] : ['prisma']) read(path.join(absolute, folder), folder + '/');
    for (const name of ['package.json', 'README.md']) files.set(name, fs.readFileSync(path.join(absolute, name)));
    files.set('LICENSE', fs.readFileSync(path.join(root, 'LICENSE')));
    for (const [file, text] of build.outputs) if (file.startsWith(slash(absolute) + '/')) files.set(file.slice(slash(absolute).length + 1), Buffer.from(text));
    return files;
  };
  const source = { repository: 'https://github.com/offline-fixture/rental-host', commit: 'a'.repeat(40) };
  const versions = { platform: '0.1.0', contract: '0.1.1', node: '24.13.0', capabilities: {} };
  const archive = build.load(build.exported('@rental-os/core-contracts/archive', true));
  const packed = build.load(build.exported('@rental-os/rental-api/package', true)).createRentalHostPackage({
    files: originalFiles('packages/rental-core'), source, sourceDirectory: 'packages/rental-core', platformSource: source,
    platformGuide: build.sourceRead(path.join(root, 'packages/core-contracts/README.md')), host: versions });
  const rentalFiles = archive.readCoreArchive(packed.bytes, packed.sha256).files;
  const aiFiles = originalFiles('packages/ai-native-data');
  const aiRelease = build.load(build.exported('@rental-os/ai-native-data/data-package', true)).createAiNativeDataRelease({ files: aiFiles, source });
  const contribution = build.load(build.exported('@rental-os/ai-native-data/data', true))
    .createAiNativeDataContribution(aiFiles);
  const aiSchema = build.load(build.exported('@rental-os/ai-native-data/prisma-schema', true)).composeAiNativePrismaSchema(disabledClient.schema, contribution);
  const generator = build.requireDeps('@prisma/client/generator-build/index.js');
  const declarations = generator.dmmfToTypes(generator.externalToInternalDmmf(JSON.parse(build.prismaWasm.get_dmmf(JSON.stringify({ prismaSchema: aiSchema, noColor: true })))))
    .replace(/(['"])(?:\.\/runtime\/library|@prisma\/client\/library)\1/gu, '"@prisma/client/runtime/library"');
  build.virtual.set(slash(disabledClient.client), declarations);
  build.virtual.set(slash(path.join(path.dirname(disabledClient.client), 'schema.prisma')), aiSchema);
  for (const directory of ['packages/ai-native-server', 'apps/rental-api']) build.selectedClients.set(slash(path.join(root, directory)), { client: slash(disabledClient.client), mode: 'rental-ai' });
  build.compile('packages/ai-native-server/tsconfig.json');
  build.compile('apps/rental-api/tsconfig.ai.json');
  build.selectedClients.set(slash(path.join(root, 'apps/example-multi-core-api')),
    { client: slash(disabledClient.client), mode: 'rental-ai' });
  build.compile('apps/example-multi-core-api/tsconfig.ai.json');
  const memory = verificationMemory(build);
  for (const file of ['scripts/package-rental-host.cjs', 'scripts/rental-host-lock.cjs', 'scripts/build-selected-prisma.cjs',
    'scripts/rental-platform-build.cjs'])
    memory.put(path.join(root, file), fs.readFileSync(path.join(root, file)));
  const packager = memory.load(path.join(root, 'scripts/package-rental-host.cjs'));
  const sourceFiles = new Map([['LICENSE', fs.readFileSync(path.join(root, 'LICENSE'))], ['package-lock.json', fs.readFileSync(path.join(root, 'package-lock.json'))]]);
  for (const [, pkg] of build.packages) {
    const directory = path.relative(root, pkg.directory).split(path.sep).join('/');
    sourceFiles.set(directory + '/package.json', json(pkg.metadata));
  }
  for (const [file, text] of build.outputs) sourceFiles.set(path.relative(root, file).split(path.sep).join('/'), Buffer.from(text));
  const platform = memory.load(build.exported('@rental-os/platform-api/data-plan', true)).createPublicPlatformDataPlan();
  for (const file of ['prisma/schema.prisma', ...platform.data.migrations.map(item => item.file)])
    sourceFiles.set('apps/platform-api/' + file, fs.readFileSync(path.join(root, 'apps/platform-api', file)));
  const platformSourceApi = memory.load(build.exported('@rental-os/core-contracts/platform-source', true));
  const platformInputs = new Map();
  const collectPlatformSource = relative => {
    const absolute = path.join(root, relative), info = fs.lstatSync(absolute);
    assert(!info.isSymbolicLink(), 'fixture source cannot follow links');
    if (info.isDirectory()) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'generated', '.git', 'test', 'tests'].includes(entry.name)) continue;
        collectPlatformSource(relative + '/' + entry.name);
      }
    } else if (info.isFile()) platformInputs.set(relative, fs.readFileSync(absolute));
  };
  for (const relative of [...platformSourceApi.PLATFORM_SOURCE_WORKSPACES, 'packages/ui-arc',
    'packages/ui-tablecn/LICENSE.md', 'packages/ui-tablecn/README.md', 'packages/ui-motiq/runtime',
    'packages/ui-motiq/LICENSE', 'packages/ui-motiq/README.md', 'config', 'AGENTS.md', 'CLAUDE.md',
    'LICENSE', '.gitignore', '.gitattributes', 'tsconfig.base.json', 'package.json',
    'package-lock.json', 'apps/admin/AGENTS.md']) collectPlatformSource(relative);
  // The declared archive is a fixture; environmental examples have no compiler
  // role. Keep the original offline guard closed to every .env* file on disk.
  platformInputs.set('.env.example', Buffer.from('# Offline source archive fixture; no environment is loaded.\n'));
  const platformSource = platformSourceApi.createPlatformSource(platformInputs, source);
  const platformArchive = archive.createCoreArchive(platformSource.files), platformFiles = platformSource.files;
  const deployment = memory.load(path.join(root, 'apps/rental-api/dist/prepare-deployment.js'));
  const deploymentInput = { release: { versions, source, sha256: platformArchive.sha256, data: platform.data },
    pin: { manifest: packed.manifest, sha256: packed.sha256 }, coreFiles: rentalFiles, publicSchema: platformClient.schema,
    publicMigrations: platform.migrationNames.map((name, index) => ({ name, sql: sourceFiles.get('apps/platform-api/' + platform.data.migrations[index].file) })) };
  const disabled = deployment.createRentalDeploymentFiles(deploymentInput);
  const enabled = deployment.createRentalDeploymentFiles({ ...deploymentInput, ai: { release: aiRelease, files: aiFiles } });
  const t = { async test(name, work) { await work(); checks++; console.log('PASS ' + name); } };
  const { ticketsPackage, ...additional } = await require('../apps/rental-api/test/additional-core-cases.cjs')({
    t, build, memory, lock: disabled.lock });
  const additionalDeployment = await require('../apps/rental-api/test/additional-deployment-cases.cjs')({
    t, load: memory.load, preparationInput: deploymentInput, aiFormatFixture: { release: aiRelease, files: aiFiles }, ticketsPackage });
  const multi = deployment.createRentalDeploymentFiles({ ...deploymentInput, additionalCores: [ticketsPackage] });
  const multiAi = deployment.createRentalDeploymentFiles({ ...deploymentInput,
    additionalCores: [ticketsPackage], ai: { release: aiRelease, files: aiFiles } });
  const adminConfigs = await require('./rental-admin-config-cases.cjs')({
    build, memory: verificationMemory(build), rentalFiles, ticketsPackage, disabled, multi });
  const base = { aiMode: 'disabled', sourceFiles, platformFiles, dependencyDirectory: deps, rentalFiles, deploymentFiles: disabled.files,
    selections: { rental: disabledClient, platform: platformClient }, ts: build.ts };
  let result, aiResult, multiResult, multiAiResult;
  check('真实无AI宿主、完整固定包和原准备材料确定性打包', () => {
    result = packager.createRentalHostContext(base);
    assert.equal(result.sha256, packager.createRentalHostContext(base).sha256);
    const decoded = archive.readCoreArchive(result.bytes, result.sha256);
    assert.equal(decoded.files.size, result.files.size);
    for (const [file, bytes] of rentalFiles) assert.deepEqual(result.files.get('packages/rental-core/' + file), bytes);
    assert(![...result.files.keys()].some(file => file.startsWith('packages/ai-native-server/')));
    assert(result.receipt.runtime.files > 100); assert.equal(result.receipt.imageBuild, 'not-run');
    assert.equal(result.receipt.deployment, 'pending');
    assert.deepEqual(result.receipt.platformBuild.release, disabled.lock.platform);
    assert.equal(result.receipt.platformBuild.sourceArchiveSha256, platformArchive.sha256);
    for (const item of result.receipt.platformBuild.generated) {
      assert.equal(require('node:crypto').createHash('sha256').update(result.files.get(item.file)).digest('hex'), item.sha256);
      assert(result.receipt.files.some(file => file.file === item.file && file.sha256 === item.sha256));
    }
    assert(![...result.files.keys()].some(file => /(?:^|\/)(?:node_modules|generated|docs|output|\.env)(?:\/|$)/u.test(file)));
  });
  check('真实AI产物闭包、247声明和完整固定AI数据包', () => {
    aiResult = packager.createRentalHostContext({ ...base, aiMode: 'enabled', aiFiles, deploymentFiles: enabled.files,
      selections: { ...base.selections, rental: { ...disabledClient, declarations, schema: aiSchema } } });
    assert(aiResult.files.has('packages/ai-native-server/dist/runtime/ai-native-application.providers.js'));
    for (const [file, bytes] of aiFiles) assert.deepEqual(aiResult.files.get('packages/ai-native-data/' + file), bytes);
    assert.equal(aiResult.receipt.clients.find(client => client.mode === 'rental-ai').models, 247);
    assert.equal(aiResult.receipt.aiDataSha256, aiRelease.sha256);
    assert.match(aiResult.files.get('Dockerfile').toString(), /dist-ai\/ai-main\.js/u);
  });
  check('真实双Core宿主独立消费正式声明、保留两份固定包与同一161模型Client', () => {
    multiResult = packager.createRentalHostContext({ ...base, host: 'example-multi-core',
      ticketsFiles: ticketsPackage.files, deploymentFiles: multi.files });
    assert.equal(multiResult.receipt.host, 'example-multi-core');
    assert.equal(multiResult.receipt.coreSha256, packed.sha256);
    assert.deepEqual(multiResult.receipt.additionalCorePackages, [{ id: 'example-tickets', sha256: ticketsPackage.pin.sha256 }]);
    for (const [file, bytes] of ticketsPackage.files)
      assert.deepEqual(multiResult.files.get('packages/example-tickets-core/' + file), bytes);
    assert(multiResult.files.has('apps/example-multi-core-api/dist/main.js'));
    assert(multiResult.files.has('apps/rental-api/dist/assembly.d.ts'));
    assert(![...multiResult.files.keys()].some(file => file.startsWith('packages/ai-native-server/')));
    assert(![...multiResult.files.keys()].some(file => file.startsWith('apps/example-multi-core-api/dist-ai/')));
    assert.match(multiResult.files.get('Dockerfile').toString(), /apps\/example-multi-core-api\/dist\/main\.js/u);
    assert.deepEqual(multiResult.receipt.clients.map(client => client.models), [40, 161]);
    const lock = JSON.parse(multiResult.files.get('package-lock.json'));
    assert.equal(lock.packages[''].dependencies['@rental-os/example-multi-core-api'], '0.1.0');
    assert(lock.packages['packages/example-tickets-core']);
    assert.throws(() => packager.createRentalHostContext({ ...base, host: 'unknown' }), /未登记/);
    assert.throws(() => packager.createRentalHostContext({ ...base, deploymentFiles: multi.files }), /选择/);
    assert.throws(() => packager.createRentalHostContext({ ...base, host: 'example-multi-core',
      ticketsFiles: ticketsPackage.files }), /选择/);
  });
  check('真实双Core与AI宿主保留完整包、同一247模型Client和正确启动入口', () => {
    multiAiResult = packager.createRentalHostContext({ ...base, host: 'example-multi-core', aiMode: 'enabled',
      ticketsFiles: ticketsPackage.files, aiFiles, deploymentFiles: multiAi.files,
      selections: { rental: { ...disabledClient, declarations, schema: aiSchema }, platform: platformClient } });
    assert.equal(multiAiResult.receipt.host, 'example-multi-core');
    assert.equal(multiAiResult.receipt.aiMode, 'enabled');
    assert.equal(multiAiResult.receipt.entry, 'apps/example-multi-core-api/dist-ai/ai-main.js');
    assert.deepEqual(multiAiResult.receipt.additionalCorePackages, [{ id: 'example-tickets', sha256: ticketsPackage.pin.sha256 }]);
    assert.deepEqual(multiAiResult.receipt.clients.map(client => client.models), [40, 247]);
    assert.match(multiAiResult.files.get('Dockerfile').toString(), /apps\/example-multi-core-api\/dist-ai\/ai-main\.js/u);
    for (const [directory, packageFiles] of [['packages/rental-core', rentalFiles],
      ['packages/example-tickets-core', ticketsPackage.files], ['packages/ai-native-data', aiFiles]])
      for (const [file, bytes] of packageFiles) assert.deepEqual(multiAiResult.files.get(directory + '/' + file), bytes);
    const lock = JSON.parse(multiAiResult.files.get('package-lock.json'));
    assert(lock.packages['packages/ai-native-server']);
    assert(lock.packages['packages/example-tickets-core']);
    assert.throws(() => packager.createRentalHostContext({ ...base, host: 'example-multi-core', aiMode: 'enabled',
      ticketsFiles: ticketsPackage.files, aiFiles, deploymentFiles: multiAi.files }), /所选 Client 不满足 rental-ai 模式的原模型要求/);
  });
  check('CLI显式选择和路径要求', () => {
    assert.throws(() => packager.parseArguments([]), /显式选择/);
    assert.throws(() => packager.parseArguments(['--ai', 'disabled', '--deployment', 'relative']), /绝对路径/);
    assert.throws(() => packager.parseArguments(['--generate', 'yes']), /未知/);
  });
  check('错版/缺失迁移、prepared锁与AI模式矛盾拒绝', () => {
    for (const mode of ['missing', 'changed', 'extra']) {
      const files = new Map(disabled.files), target = [...files.keys()].find(file => file.endsWith('migration.sql'));
      if (mode === 'missing') files.delete(target);
      if (mode === 'changed') files.set(target, Buffer.from('SELECT 1;'));
      if (mode === 'extra') files.set('migrations/not-declared/migration.sql', Buffer.from('SELECT 1;'));
      assert.throws(() => packager.createRentalHostContext({ ...base, deploymentFiles: files }), /部署材料/);
    }
    assert.throws(() => packager.createRentalHostContext({ ...base, deploymentFiles: enabled.files }), /AI 选择/);
  });
  check('固定包摘要变化和缺实际出口拒绝', () => {
    const altered = new Map(rentalFiles); altered.set('dist/server.js', Buffer.from('module.exports = {};'));
    assert.throws(() => packager.createRentalHostContext({ ...base, rentalFiles: altered }), /锁定|不一致/);
    const files = new Map(sourceFiles); files.delete('packages/platform-server/dist/index.js');
    assert.throws(() => packager.createRentalHostContext({ ...base, sourceFiles: files }), /未实际构建/);
  });
  check('固定底座源码与实际运行字节不同源时拒绝打包', () => {
    const changedSource = new Map(platformFiles);
    changedSource.set('packages/core-host/src/index.ts', Buffer.from('export const changed = true;'));
    assert.throws(() => packager.createRentalHostContext({ ...base, platformFiles: changedSource }), /底座|源码|摘要|发行/);
    const changedRuntime = new Map(sourceFiles);
    const target = 'packages/platform-server/dist/index.js';
    changedRuntime.set(target, Buffer.concat([changedRuntime.get(target), Buffer.from('\nexports.forgedRuntime = true;\n')]));
    assert.throws(() => packager.createRentalHostContext({ ...base, sourceFiles: changedRuntime }), /编译|产物|同源|运行/);
  });
  check('构建Client与部署schema错配、默认Client拒绝', () => {
    assert.throws(() => packager.createRentalHostContext({ ...base, selections: { ...base.selections,
      rental: { ...disabledClient, declarations, schema: aiSchema } } }), /部署 schema/);
    assert.throws(() => packager.createRentalHostContext({ ...base, selections: { ...base.selections,
      rental: { ...disabledClient, client: path.join(root, 'node_modules/.prisma/client/index.d.ts') } } }), /实际 generated/);
  });
  check('关闭AI时裸import强制加载、默认Client运行值及缺依赖拒绝', () => {
    const rootEntry = 'apps/rental-api/dist/main.js';
    for (const [source, error] of [
      ['require("@rental-os/ai-native-server/task-errors");', /未选工作区|未声明的依赖/],
      ['require("@prisma/client");', /默认 Client/],
      ['require("./does-not-exist");', /缺少内部依赖/],
      ['require(process.env.MODULE);', /动态模块路径/],
    ]) {
      const files = new Map(sourceFiles); files.set(rootEntry, Buffer.from(source + '\n' + files.get(rootEntry)));
      assert.throws(() => packager.createRentalHostContext({ ...base, sourceFiles: files }), error);
    }
  });
  check('原锁最小闭包不带后台、所有生产依赖保留原版本与摘要', () => {
    const original = JSON.parse(sourceFiles.get('package-lock.json'));
    const workspaces = selectWorkspaces(original, directory => JSON.parse(sourceFiles.get(directory + '/package.json')), 'disabled');
    const projected = projectHostLock(original, workspaces, 'disabled');
    assert.equal(projected.lock.packages['node_modules/react'], undefined);
    assert.equal(projected.lock.packages['packages/platform-admin'], undefined);
    assert.equal(projected.lock.packages['node_modules/prisma'].dev, true);
    assert.equal(projected.lock.packages['node_modules/@nestjs/core'].dev, undefined);
    for (const [file, value] of Object.entries(projected.lock.packages)) if (file.includes('node_modules/') && !value.link) {
      assert.equal(value.version, original.packages[file].version); assert.equal(value.integrity, original.packages[file].integrity);
    }
    const wrong = structuredClone(original); wrong.packages['apps/rental-api'].dependencies.zod = '0.0.0';
    assert.throws(() => selectWorkspaces(wrong, directory => JSON.parse(sourceFiles.get(directory + '/package.json')), 'disabled'), /依赖与原锁/);
    const semver = build.requireDeps('semver');
    for (const candidate of [result, aiResult, multiResult, multiAiResult]) {
      const lock = JSON.parse(candidate.files.get('package-lock.json'));
      const resolve = require('../scripts/rental-host-lock.cjs').lockedDependency;
      for (const [owner, metadata] of Object.entries(lock.packages)) {
        if (metadata.link) continue;
        for (const [name, range] of Object.entries({ ...metadata.dependencies, ...metadata.devDependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies })) {
          let installed = lock.packages[resolve(lock, owner, name)];
          if (!installed && (metadata.optionalDependencies?.[name] || metadata.peerDependenciesMeta?.[name]?.optional)) continue;
          assert(installed, owner + ' missing ' + name);
          if (installed.link) installed = lock.packages[installed.resolved];
          assert(semver.satisfies(installed.version, range), owner + ' wrong version ' + name);
        }
      }
    }
  });
  check('CLI真实读写路径在memfs执行，拒绝覆盖并清理失败的独占归档', () => {
    const candidate = path.join(memory.task, 'prepared'), core = path.join(memory.task, 'core'), output = path.join(memory.task, 'host.tgz');
    const sourceArchive = path.join(memory.task, 'platform.tgz');
    memory.put(sourceArchive, platformArchive.bytes);
    for (const [file, bytes] of disabled.files) memory.put(path.join(candidate, file), bytes);
    for (const [file, bytes] of rentalFiles) memory.put(path.join(core, file), bytes);
    memory.put(disabledClient.client, disabledClient.declarations);
    memory.put(path.join(path.dirname(disabledClient.client), 'schema.prisma'), disabledClient.schema);
    const args = ['--ai', 'disabled', '--deployment', candidate, '--platform-package', sourceArchive, '--rental-package', core, '--client', disabledClient.client,
      '--platform-client', platformClient.client, '--output', output, '--deps', deps];
    const written = packager.main(args); assert.equal(written.status, 'packaged');
    assert.equal(written.sha256, require('node:crypto').createHash('sha256').update(memory.fs.readFileSync(output)).digest('hex'));
    assert.throws(() => packager.main(args), /已存在/);
    const multiCandidate = path.join(memory.task, 'multi-prepared'), tickets = path.join(memory.task, 'tickets'),
      multiOutput = path.join(memory.task, 'multi-host.tgz');
    for (const [file, bytes] of multi.files) memory.put(path.join(multiCandidate, file), bytes);
    for (const [file, bytes] of ticketsPackage.files) memory.put(path.join(tickets, file), bytes);
    const multiArgs = args.map(value => value === candidate ? multiCandidate : value === output ? multiOutput : value)
      .concat(['--host', 'example-multi-core', '--tickets-package', tickets]);
    assert.throws(() => packager.parseArguments(multiArgs.filter((value, index) => !['--tickets-package', tickets].includes(value))), /须显式/);
    assert.throws(() => packager.parseArguments(multiArgs.map(value => value === 'disabled' ? 'enabled' : value)), /必须提供 --ai-data-package/);
    const multiWritten = packager.main(multiArgs);
    assert.equal(multiWritten.status, 'packaged');
    const shipped = archive.readCoreArchive(memory.fs.readFileSync(multiOutput), multiWritten.sha256);
    assert.equal(JSON.parse(shipped.files.get('rental-host.context.json')).host, 'example-multi-core');
    const multiAiCandidate = path.join(memory.task, 'multi-ai-prepared'), aiData = path.join(memory.task, 'ai-data'),
      multiAiOutput = path.join(memory.task, 'multi-ai-host.tgz');
    for (const [file, bytes] of multiAi.files) memory.put(path.join(multiAiCandidate, file), bytes);
    for (const [file, bytes] of aiFiles) memory.put(path.join(aiData, file), bytes);
    memory.put(disabledClient.client, declarations);
    memory.put(path.join(path.dirname(disabledClient.client), 'schema.prisma'), aiSchema);
    const multiAiArgs = multiArgs.map(value => value === 'disabled' ? 'enabled'
      : value === multiCandidate ? multiAiCandidate : value === multiOutput ? multiAiOutput : value)
      .concat(['--ai-data-package', aiData]);
    const multiAiWritten = packager.main(multiAiArgs);
    assert.equal(multiAiWritten.status, 'packaged');
    const aiShipped = archive.readCoreArchive(memory.fs.readFileSync(multiAiOutput), multiAiWritten.sha256);
    assert.equal(JSON.parse(aiShipped.files.get('rental-host.context.json')).entry, 'apps/example-multi-core-api/dist-ai/ai-main.js');
    const write = memory.fs.writeSync, broken = path.join(memory.task, 'broken.tgz');
    memory.fs.writeSync = () => { throw Error('fixture write failure'); };
    try { assert.throws(() => packager.writeArchive(broken, Buffer.from('test')), /fixture write failure/); }
    finally { memory.fs.writeSync = write; }
    assert.equal(memory.fs.existsSync(broken), false);
    const switched = path.join(memory.task, 'switched.tgz'), replacement = path.join(memory.task, 'replacement.tgz');
    memory.put(replacement, 'other writer');
    memory.fs.writeSync = () => {
      memory.fs.unlinkSync(switched); memory.fs.renameSync(replacement, switched); throw Error('fixture replaced output');
    };
    try { assert.throws(() => packager.writeArchive(switched, Buffer.from('test')), /身份变化/); }
    finally { memory.fs.writeSync = write; }
    assert.equal(memory.fs.readFileSync(switched, 'utf8'), 'other writer');
  });
  const verifyRoot = require('../apps/rental-api/test/ai-host-root-cases.cjs');
  const multiRootDi = await verifyRoot({ build, memory: verificationMemory(build), rentalFiles,
    disabled, multi, multiResult, ticketsPackage, platformClient, platformArchive });
  const rootDi = await verifyRoot({
    build, memory: verificationMemory(build), rentalFiles, aiFiles, enabled, aiResult, disabled, platformClient, platformArchive });
  const multiAiRootDi = await verifyRoot({ build, memory: verificationMemory(build), rentalFiles, aiFiles,
    disabled, multi: multiAi, multiResult: multiAiResult, ticketsPackage, platformClient, platformArchive });
  const { result: platformHostResult, lock: platformHostLock, ...platformHost } = await require('./platform-host-package-cases.cjs')({
    t, build, memory: verificationMemory(build), sourceFiles, platformFiles, platformClient,
    platformRelease: deploymentInput.release, archive, selectedLocks: [disabled.lock, enabled.lock] });
  const platformRootDi = await verifyRoot({ build, memory: verificationMemory(build),
    platform: { lock: platformHostLock, files: new Map([...platformHostResult.files]
      .filter(([file]) => file.startsWith('apps/platform-api/prisma/'))
      .map(([file, bytes]) => [file.slice('apps/platform-api/prisma/'.length), bytes])) },
    platformResult: platformHostResult, platformClient, platformArchive });
  const { result: ticketsHostResult, lock: ticketsHostLock, ...ticketsHost } = await require('./platform-host-package-cases.cjs').verifyTicketsHostPackage({
    t, build, memory: verificationMemory(build), sourceFiles, platformFiles, platformClient,
    platformRelease: deploymentInput.release, archive, ticketsPackage, selectedLocks: [disabled.lock, enabled.lock] });
  const ticketsRootDi = await verifyRoot({ build, memory: verificationMemory(build),
    tickets: { lock: ticketsHostLock, files: new Map([...ticketsHostResult.files]
      .filter(([file]) => file.startsWith('apps/example-tickets-api/prisma-deployment/'))
      .map(([file, bytes]) => [file.slice('apps/example-tickets-api/prisma-deployment/'.length), bytes])) },
    ticketsResult: ticketsHostResult, ticketsPackage, platformClient, platformArchive });
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ checks, builds: build.stages.length, disabled: { files: result.files.size, runtimeFiles: result.receipt.runtime.files, sha256: result.sha256 },
    enabled: { files: aiResult.files.size, runtimeFiles: aiResult.receipt.runtime.files, sha256: aiResult.sha256 },
    multi: { files: multiResult.files.size, runtimeFiles: multiResult.receipt.runtime.files, sha256: multiResult.sha256 },
    multiAi: { files: multiAiResult.files.size, runtimeFiles: multiAiResult.receipt.runtime.files, sha256: multiAiResult.sha256 },
    additional, additionalDeployment, adminConfigs, multiRootDi, rootDi, multiAiRootDi, platformHost, platformRootDi,
    ticketsHost, ticketsRootDi,
    fixtureProvenance: true, diskOutputs: 0, imageBuild: 'not-run', database: 'not-connected', deployment: 'pending' }));
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
