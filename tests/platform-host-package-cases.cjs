'use strict';
/** 被既有宿主打包回归调用。复用真实六包 emit、官方公共 Client 和原源码归档，
 * CLI 读写仅发生在原 memfs 运输；不另起构建器、服务、数据库或磁盘环境。 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const publicDirectories = ['packages/platform-contracts', 'packages/core-contracts', 'packages/core-host',
  'packages/platform-server', 'packages/platform-core-host', 'apps/platform-api'];

module.exports = async function verifyPlatformHostPackage({ t, build, memory, sourceFiles, platformFiles, platformClient, platformRelease, archive, selectedLocks }) {
  for (const file of ['scripts/package-platform-host.cjs', 'scripts/package-rental-host.cjs', 'scripts/rental-host-lock.cjs',
    'scripts/build-selected-prisma.cjs', 'scripts/rental-platform-build.cjs'])
    memory.put(path.join(root, file), fs.readFileSync(path.join(root, file)));
  const packager = memory.load(path.join(root, 'scripts/package-platform-host.cjs'));
  const contracts = memory.load(build.exported('@rental-os/core-contracts', true));
  const lock = contracts.CoreDeploymentLockSchema.parse({ lockVersion: 1, platform: platformRelease, cores: [] });
  const base = { lock, sourceFiles, platformFiles, selection: platformClient, ts: build.ts, dependencyDirectory: build.deps };
  let result;
  await t.test('零Core运行包只含六公共后端、唯一40模型Client和原13迁移', () => {
    result = packager.createPlatformHostContext(base);
    const decoded = archive.readCoreArchive(result.bytes, result.sha256);
    assert.equal(decoded.files.size, result.files.size);
    assert.deepEqual(result.receipt.clients.map(item => [item.directory, item.mode, item.models]),
      [['apps/platform-api/generated/client', 'platform', 40]]);
    assert.deepEqual(result.receipt.runtime.clients, ['apps/platform-api/generated/client']);
    assert.equal(result.receipt.entry, 'apps/platform-api/dist/main.js');
    assert.equal(result.receipt.format, 'platform-host-context-1');
    assert.equal(result.receipt.host, 'platform');
    assert.equal(result.receipt.imageBuild, 'not-run');
    assert.equal(result.receipt.configuration, 'pending');
    assert.equal(result.receipt.deployment, 'pending');
    assert(result.receipt.runtime.files > 100);
    const rootMetadata = JSON.parse(result.files.get('package.json'));
    assert.equal(rootMetadata.name, 'platform-host-runtime');
    assert.deepEqual(rootMetadata.workspaces, [...publicDirectories].sort());
    assert.deepEqual(rootMetadata.dependencies['@rental-os/platform-api'], '0.1.0');
    assert.equal(result.receipt.platformBuild.sourceArchiveSha256, lock.platform.sha256);
    assert.deepEqual(result.receipt.platformBuild.release, lock.platform);
    for (const item of result.receipt.platformBuild.generated) {
      assert.equal(hash(result.files.get(item.file)), item.sha256);
      assert(result.receipt.files.some(file => file.file === item.file && file.sha256 === item.sha256));
    }
    assert.equal([...result.files.keys()].filter(file => file.endsWith('/migration.sql')).length, 13);
    for (const migration of lock.platform.data.migrations) {
      const file = 'apps/platform-api/' + migration.file;
      assert.deepEqual(result.files.get(file), platformFiles.get(file));
      assert.equal(hash(result.files.get(file)), migration.sha256);
    }
    assert.deepEqual(JSON.parse(result.files.get('apps/platform-api/prisma/core.deployment.lock.json')), lock);
    assert(![...result.files.keys()].some(file => /(?:^|\/)(?:node_modules|generated|docs|output|src|\.env)(?:\/|$)/u.test(file)));
    for (const file of result.files.keys()) if (/^(?:apps|packages)\//u.test(file))
      assert(publicDirectories.some(directory => file.startsWith(directory + '/')), file);
    const docker = result.files.get('Dockerfile').toString('utf8');
    assert.equal((docker.match(/generate --schema/gu) || []).length, 1);
    assert.match(docker, /CMD \["node", "apps\/platform-api\/dist\/main\.js"\]/u);
    assert(!/rental-api|ai-native|example-tickets|shared/u.test(docker));
    assert.match(result.files.get('verify-runtime.cjs').toString('utf8'), /platform-host\.context\.json/u);
  });
  await t.test('零Core生产锁只投影公共依赖并保留原版本摘要', () => {
    const original = JSON.parse(sourceFiles.get('package-lock.json')), projected = JSON.parse(result.files.get('package-lock.json'));
    for (const file of ['packages/rental-core', 'packages/shared', 'packages/ai-native-server', 'packages/ai-native-data',
      'packages/example-tickets-core', 'apps/rental-api', 'apps/platform-admin', 'node_modules/react'])
      assert.equal(projected.packages[file], undefined, file);
    assert.equal(projected.packages['node_modules/prisma'].dev, true);
    assert.equal(projected.packages['node_modules/@nestjs/core'].dev, undefined);
    const semver = build.requireDeps('semver'), { lockedDependency } = memory.load(path.join(root, 'scripts/rental-host-lock.cjs'));
    for (const [owner, metadata] of Object.entries(projected.packages)) {
      if (metadata.link) continue;
      if (owner.includes('node_modules/')) for (const field of ['version', 'integrity', 'resolved'])
        assert.equal(metadata[field], original.packages[owner][field], owner + ' ' + field);
      for (const [name, range] of Object.entries({ ...metadata.dependencies, ...metadata.devDependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies })) {
        let dependency = projected.packages[lockedDependency(projected, owner, name)];
        if (!dependency && (metadata.optionalDependencies?.[name] || metadata.peerDependenciesMeta?.[name]?.optional)) continue;
        assert(dependency, owner + ' missing ' + name);
        if (dependency.link) dependency = projected.packages[dependency.resolved];
        assert(semver.satisfies(dependency.version, range), owner + ' wrong version ' + name);
      }
    }
  });
  await t.test('零CoreCLI拒绝业务选装、缺参、相对路径和重复参数', () => {
    assert.throws(() => packager.parseArguments([]), /须提供/);
    assert.throws(() => packager.parseArguments(['--lock', 'relative.json']), /绝对路径/);
    for (const option of ['--ai', '--client', '--rental-package', '--ai-data-package'])
      assert.throws(() => packager.parseArguments([option, 'enabled']), /未知/);
    assert.throws(() => packager.parseArguments(['--host', 'unregistered']), /未登记/);
    assert.throws(() => packager.parseArguments(['--host', 'example-tickets']), /须显式提供 --tickets-package/);
    for (const host of [[], ['--host', 'platform']])
      assert.throws(() => packager.parseArguments([...host, '--tickets-package', path.join(memory.task, 'tickets')]), /只有工单宿主/);
    assert.throws(() => packager.parseArguments(['--lock', path.join(memory.task, 'lock.json'), '--lock', path.join(memory.task, 'lock.json')]), /重复/);
  });
  await t.test('零Core拒绝选装能力、错版锁、迁移或schema变化', () => {
    assert(selectedLocks?.some(item => item.cores.length) && selectedLocks.some(item => item.dataCapabilities?.length),
      '沿原准备器提供真实 Core 和 AI 选装锁');
    for (const selected of selectedLocks) {
      const checked = contracts.CoreDeploymentLockSchema.parse(selected);
      assert.throws(() => packager.createPlatformHostContext({ ...base, lock: checked }), /零 Core/);
      if (checked.dataCapabilities?.length)
        assert.throws(() => packager.createPlatformHostContext({ ...base, lock: { ...checked, cores: [] } }), /零 Core/);
    }
    const wrongNode = structuredClone(lock); wrongNode.platform.versions.node = '22.12.0';
    assert.throws(() => packager.createPlatformHostContext({ ...base, lock: wrongNode }), /Node/);
    for (const file of ['apps/platform-api/prisma/schema.prisma', 'apps/platform-api/' + lock.platform.data.migrations[0].file]) {
      const changed = new Map(sourceFiles); changed.set(file, Buffer.concat([changed.get(file), Buffer.from('\n// changed\n')]));
      assert.throws(() => packager.createPlatformHostContext({ ...base, sourceFiles: changed }), /固定底座/);
    }
    const changedLock = structuredClone(lock); changedLock.platform.data.migrations[0].sha256 = 'b'.repeat(64);
    assert.throws(() => packager.createPlatformHostContext({ ...base, lock: changedLock }), /数据计划/);
  });
  await t.test('公共Client必须为同一实际目录和完整公共模型声明', () => {
    assert.throws(() => packager.createPlatformHostContext({ ...base,
      selection: { ...platformClient, client: path.join(root, 'apps/rental-api/generated/client/index.d.ts') } }), /唯一 generated/);
    assert.throws(() => packager.createPlatformHostContext({ ...base,
      selection: { ...platformClient, declarations: 'export class PrismaClient {}' } }), /完整 Prisma Client/);
    assert.throws(() => packager.createPlatformHostContext({ ...base,
      selection: { ...platformClient, schema: platformClient.schema + '\nmodel RentalInjected {\n id String @id\n}\n' } }), /模型集合/);
  });
  await t.test('公共运行闭包拒绝另一Client、默认Client、动态路径和未选包', () => {
    for (const [statement, error] of [
      ['require("../../rental-api/generated/client");', /Client/],
      ['require("@prisma/client");', /默认 Client/],
      ['require(process.env.MODULE);', /动态模块路径/],
      ['require("@rental-os/rental-core");', /未声明|未选/],
    ]) {
      const files = new Map(sourceFiles), main = 'apps/platform-api/dist/main.js';
      files.set(main, Buffer.concat([Buffer.from(statement + '\n'), files.get(main)]));
      assert.throws(() => packager.createPlatformHostContext({ ...base, sourceFiles: files }), error);
    }
    const extra = new Map(sourceFiles); extra.set('packages/platform-core-host/dist/hidden.sh', Buffer.from('exit 0'));
    assert.throws(() => packager.createPlatformHostContext({ ...base, sourceFiles: extra }), /未声明格式/);
  });
  await t.test('公共运行包拒绝固定源码摘要与实际dist错配', () => {
    const source = new Map(platformFiles);
    source.set('packages/platform-contracts/src/index.ts', Buffer.from('export const changed = true;'));
    assert.throws(() => packager.createPlatformHostContext({ ...base, platformFiles: source }), /底座|源码|摘要/);
    const runtime = new Map(sourceFiles), target = 'packages/platform-contracts/dist/index.js';
    runtime.set(target, Buffer.concat([runtime.get(target), Buffer.from('\nexports.changed = true;\n')]));
    assert.throws(() => packager.createPlatformHostContext({ ...base, sourceFiles: runtime }), /运行产物.*编译不同/);
  });
  await t.test('公共CLI按真实文件运输生成同一归档并拒绝覆盖', () => {
    const directory = path.join(memory.task, 'platform-package'), output = path.join(directory, 'platform-host.tgz');
    const lockFile = path.join(directory, 'lock.json'), sourceArchive = path.join(directory, 'source.tgz');
    memory.put(lockFile, json(lock)); memory.put(sourceArchive, archive.createCoreArchive(platformFiles).bytes);
    memory.put(platformClient.client, platformClient.declarations);
    memory.put(path.join(path.dirname(platformClient.client), 'schema.prisma'), platformClient.schema);
    const args = ['--lock', lockFile, '--platform-package', sourceArchive, '--platform-client', platformClient.client,
      '--output', output, '--deps', build.deps];
    const written = packager.main(args);
    assert.equal(written.status, 'packaged'); assert.equal(written.host, 'platform');
    assert.equal(written.sha256, result.sha256);
    assert.equal(hash(memory.fs.readFileSync(output)), result.sha256);
    assert.equal(written.configuration, 'pending'); assert.equal(written.deployment, 'pending');
    assert.throws(() => packager.main(args), /已存在/);
    assert.throws(() => packager.main(args.map(value => value === output ? path.join(root, 'docs/private.tgz') : value)), /私有/);
  });
  await verifyRuntimeEvidence({ t, build, memory, platformFiles, result, lock, archive });
  return { files: result.files.size, runtimeFiles: result.receipt.runtime.files, sha256: result.sha256,
    models: result.receipt.clients[0].models, migrations: lock.platform.data.migrations.length,
    fixtureProvenance: true, diskOutputs: 0, imageBuild: 'not-run', configuration: 'pending', deployment: 'pending', result, lock };
};

// 独立导出供同一打包 runner 复用实际工单包；默认零 Core 用例不隐式选装业务。
module.exports.verifyTicketsHostPackage = async function verifyTicketsHostPackage({
  t, build, memory, sourceFiles, platformFiles, platformClient, platformRelease, archive, ticketsPackage, selectedLocks
}) {
  assert(ticketsPackage?.pin && ticketsPackage.files?.size, '须提供原打包器生成的完整工单固定包');
  for (const file of ['scripts/package-platform-host.cjs', 'scripts/package-rental-host.cjs', 'scripts/rental-host-lock.cjs',
    'scripts/build-selected-prisma.cjs', 'scripts/rental-platform-build.cjs'])
    memory.put(path.join(root, file), fs.readFileSync(path.join(root, file)));
  const packager = memory.load(path.join(root, 'scripts/package-platform-host.cjs'));
  const contracts = memory.load(build.exported('@rental-os/core-contracts', true));
  const { corePrismaMigrationName } = memory.load(build.exported('@rental-os/core-contracts/deployment', true));
  const platformPlan = memory.load(build.exported('@rental-os/platform-api/data-plan', true)).createPublicPlatformDataPlan();
  const lock = contracts.CoreDeploymentLockSchema.parse({ lockVersion: 1, platform: platformRelease, cores: [ticketsPackage.pin] });
  const host = 'apps/example-tickets-api', core = 'packages/example-tickets-core', deployment = host + '/prisma-deployment/';
  const workspaces = [...publicDirectories, host, core].sort();
  const base = { host: 'example-tickets', lock, ticketsFiles: ticketsPackage.files, sourceFiles, platformFiles,
    selection: platformClient, ts: build.ts, dependencyDirectory: build.deps };
  let result;

  await t.test('工单运行包保留完整固定包、八工作区、公共40Client及原13加1迁移', () => {
    result = packager.createPlatformHostContext(base);
    const decoded = archive.readCoreArchive(result.bytes, result.sha256);
    assert.equal(decoded.files.size, result.files.size);
    for (const [file, bytes] of result.files) assert.deepEqual(Buffer.from(decoded.files.get(file)), Buffer.from(bytes), file);
    assert.deepEqual(result.receipt.clients.map(item => [item.directory, item.mode, item.models]),
      [['apps/platform-api/generated/client', 'platform', 40]]);
    assert.deepEqual(result.receipt.runtime.clients, ['apps/platform-api/generated/client']);
    assert.equal(result.receipt.entry, host + '/dist/main.js');
    assert.equal(result.receipt.host, 'example-tickets');
    assert.equal(result.receipt.format, 'platform-host-context-1');
    assert.equal(result.receipt.imageBuild, 'not-run');
    assert.equal(result.receipt.configuration, 'pending');
    assert.equal(result.receipt.deployment, 'pending');
    assert.deepEqual(result.receipt.corePackages, [{ id: 'example-tickets', sha256: ticketsPackage.pin.sha256 }]);
    const metadata = JSON.parse(result.files.get('package.json'));
    assert.equal(metadata.name, 'example-tickets-host-runtime');
    assert.deepEqual(metadata.workspaces, workspaces);
    assert.equal(metadata.dependencies['@rental-os/example-tickets-api'], JSON.parse(sourceFiles.get(host + '/package.json')).version);
    const installedCore = new Map([...result.files].filter(([file]) => file.startsWith(core + '/'))
      .map(([file, bytes]) => [file.slice(core.length + 1), bytes]));
    assert.equal(installedCore.size, ticketsPackage.files.size);
    for (const [file, bytes] of ticketsPackage.files) assert.deepEqual(installedCore.get(file), bytes, file);
    assert.equal(archive.createCoreArchive(installedCore).sha256, ticketsPackage.pin.sha256);
    // admin/source 是完整 Core 包的声明材料，不因此加入宿主运行依赖，也不在打包时丢弃。
    assert.deepEqual(installedCore.get(ticketsPackage.pin.manifest.entries.admin),
      ticketsPackage.files.get(ticketsPackage.pin.manifest.entries.admin));
    assert.deepEqual(JSON.parse(result.files.get(deployment + 'core.deployment.lock.json')), lock);
    assert.equal(result.receipt.deploymentLockSha256, hash(result.files.get(deployment + 'core.deployment.lock.json')));
    assert.equal(lock.platform.data.migrations.length, 13);
    assert.equal(ticketsPackage.pin.manifest.data.migrations.length, 1);
    assert.deepEqual(platformPlan.data, lock.platform.data);
    const expectedMigrations = platformPlan.migrationNames.map(name => deployment + 'migrations/' + name + '/migration.sql');
    for (const [index, migration] of lock.platform.data.migrations.entries()) {
      const original = 'apps/platform-api/' + migration.file, bytes = platformFiles.get(original);
      assert.deepEqual(result.files.get(original), bytes, '原公共观察路径 ' + original);
      assert.deepEqual(result.files.get(expectedMigrations[index]), bytes, '组合部署路径 ' + expectedMigrations[index]);
      assert.equal(hash(bytes), migration.sha256);
    }
    for (const migration of ticketsPackage.pin.manifest.data.migrations) {
      const file = deployment + 'migrations/' + corePrismaMigrationName(ticketsPackage.pin.manifest.id, migration.id) + '/migration.sql';
      expectedMigrations.push(file);
      assert.deepEqual(result.files.get(file), ticketsPackage.files.get(migration.file));
      assert.equal(hash(result.files.get(file)), migration.sha256);
    }
    assert.deepEqual([...result.files.keys()].filter(file => file.startsWith(deployment) && file.endsWith('/migration.sql')).sort(),
      expectedMigrations.sort());
    assert.equal([...result.files.keys()].filter(file => file.startsWith('apps/platform-api/prisma/') && file.endsWith('/migration.sql')).length, 13);
    for (const file of ['apps/platform-api/prisma/schema.prisma', deployment + 'schema.prisma'])
      assert.deepEqual(result.files.get(file), platformFiles.get('apps/platform-api/prisma/schema.prisma'));
    assert.equal(result.receipt.clients[0].schemaSha256, hash(result.files.get(deployment + 'schema.prisma')));
    assert.match(result.files.get(deployment + 'migrations/migration_lock.toml').toString(), /provider = "mysql"/u);
    for (const file of result.files.keys()) {
      if (/^(?:apps|packages)\//u.test(file)) assert(workspaces.some(directory => file.startsWith(directory + '/')), file);
      if (!file.startsWith(core + '/'))
        assert(!/(?:^|\/)(?:node_modules|generated|docs|output|src|admin|\.env)(?:\/|$)/u.test(file), file);
    }
  });

  await t.test('工单锁投影保留原版本与完整性，运行闭包不引入Rental、AI或后台依赖', () => {
    const original = JSON.parse(sourceFiles.get('package-lock.json')), projected = JSON.parse(result.files.get('package-lock.json'));
    assert.deepEqual(Object.keys(projected.packages).filter(file => /^(?:apps|packages)\//u.test(file)).sort(), workspaces);
    for (const file of ['packages/rental-core', 'packages/shared', 'packages/ai-native-server', 'packages/ai-native-data',
      'apps/rental-api', 'apps/example-multi-core-api', 'packages/platform-admin', 'apps/platform-admin', 'node_modules/react'])
      assert.equal(projected.packages[file], undefined, file);
    const semver = build.requireDeps('semver'), { lockedDependency } = memory.load(path.join(root, 'scripts/rental-host-lock.cjs'));
    for (const [owner, metadata] of Object.entries(projected.packages)) {
      if (metadata.link) { assert.deepEqual(metadata, original.packages[owner], owner); continue; }
      if (owner.includes('node_modules/')) for (const field of ['version', 'integrity', 'resolved'])
        assert.equal(metadata[field], original.packages[owner][field], owner + ' ' + field);
      for (const [name, range] of Object.entries({ ...metadata.dependencies, ...metadata.devDependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies })) {
        let dependency = projected.packages[lockedDependency(projected, owner, name)];
        if (!dependency && (metadata.optionalDependencies?.[name] || metadata.peerDependenciesMeta?.[name]?.optional)) continue;
        assert(dependency, owner + ' missing ' + name);
        if (dependency.link) dependency = projected.packages[dependency.resolved];
        assert(semver.satisfies(dependency.version, range), owner + ' wrong version ' + name);
      }
    }
    assert.equal(projected.packages['node_modules/prisma'].dev, true);
    assert.equal(projected.packages['node_modules/@nestjs/core'].dev, undefined);
    assert.equal(result.receipt.originalNpmLockSha256, hash(sourceFiles.get('package-lock.json')));
    assert.deepEqual(result.receipt.platformBuild.release, lock.platform);
    assert.equal(result.receipt.platformBuild.sourceArchiveSha256, lock.platform.sha256);
    const packageNames = new Set(workspaces.map(directory => JSON.parse(result.files.get(directory + '/package.json')).name));
    assert(result.receipt.runtime.resolutions.some(item => item.from.startsWith(core + '/dist/')));
    for (const item of result.receipt.runtime.resolutions) {
      assert(workspaces.some(directory => item.from.startsWith(directory + '/dist/')), item.from);
      assert.notEqual(item.specifier, '@prisma/client', '只使用所选公共 Client；官方 runtime/library 可保留');
      if (item.specifier.startsWith('@rental-os/')) assert(packageNames.has(item.specifier.split('/').slice(0, 2).join('/')), item.specifier);
    }
    const docker = result.files.get('Dockerfile').toString('utf8');
    assert.equal((docker.match(/generate --schema/gu) || []).length, 1);
    assert.match(docker, /generate --schema apps\/platform-api\/prisma\/schema\.prisma/u);
    assert.match(docker, /CORE_DEPLOYMENT_LOCK=\/app\/apps\/example-tickets-api\/prisma-deployment\/core\.deployment\.lock\.json/u);
    assert.match(docker, /CMD \["node", "apps\/example-tickets-api\/dist\/main\.js"\]/u);
    assert(!/rental-api|ai-native|packages\/shared/u.test(docker));
  });

  await t.test('工单宿主拒绝零Core、额外Core、AI和不完整或摘要不符的固定包', () => {
    const other = selectedLocks?.flatMap(selected => selected.cores).find(pin => pin.manifest.id !== 'example-tickets');
    const ai = selectedLocks?.find(selected => selected.dataCapabilities?.length)?.dataCapabilities;
    assert(other && ai, '复用真实 Rental 和 AI 部署锁作为反例');
    for (const selected of [{ ...lock, cores: [] }, { ...lock, cores: [other] },
      { ...lock, cores: [...lock.cores, other] }, { ...lock, dataCapabilities: ai }])
      assert.throws(() => packager.createPlatformHostContext({ ...base, lock: selected }), /只选择一个完整工单包且无选装数据能力/);
    assert.throws(() => packager.createPlatformHostContext({ ...base, ticketsFiles: undefined }), /完整工单包/);
    assert.throws(() => packager.createPlatformHostContext({ ...base, host: 'platform', lock: { ...lock, cores: [] } }), /零 Core/);
    assert.throws(() => packager.createPlatformHostContext({ ...base, host: 'unregistered' }), /未登记/);
    const incomplete = new Map(ticketsPackage.files); incomplete.delete(ticketsPackage.pin.manifest.entries.server);
    const changed = new Map(ticketsPackage.files);
    changed.set('README.md', Buffer.concat([changed.get('README.md'), Buffer.from('\nchanged\n')]));
    for (const files of [new Map(), incomplete, changed])
      assert.throws(() => packager.createPlatformHostContext({ ...base, ticketsFiles: files }), /清单\/包文件与部署锁不一致/);
    const wrongHash = structuredClone(lock);
    wrongHash.cores[0].sha256 = (lock.cores[0].sha256[0] === '0' ? '1' : '0') + lock.cores[0].sha256.slice(1);
    assert.throws(() => packager.createPlatformHostContext({ ...base, lock: wrongHash }), /清单\/包文件与部署锁不一致/);
  });

  await t.test('显式工单CLI读取同一完整包生成同字节归档，拒绝错选、缺参和覆盖', () => {
    const directory = path.resolve(memory.task, 'tickets-platform-package'), relative = path.relative(path.resolve(memory.task), directory);
    assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    assert.equal(memory.fs.existsSync(directory), false, '本次内存 fixture 不覆盖已有材料');
    assert.equal(fs.existsSync(directory), false, '本次不创建磁盘目录');
    const output = path.join(directory, 'tickets-host.tgz'), lockFile = path.join(directory, 'lock.json');
    const sourceArchive = path.join(directory, 'platform.tgz'), tickets = path.join(directory, 'tickets');
    try {
      memory.put(lockFile, json(lock)); memory.put(sourceArchive, archive.createCoreArchive(platformFiles).bytes);
      for (const [file, bytes] of ticketsPackage.files) memory.put(path.join(tickets, file), bytes);
      memory.put(platformClient.client, platformClient.declarations);
      memory.put(path.join(path.dirname(platformClient.client), 'schema.prisma'), platformClient.schema);
      const args = ['--host', 'example-tickets', '--lock', lockFile, '--platform-package', sourceArchive,
        '--platform-client', platformClient.client, '--tickets-package', tickets, '--output', output, '--deps', build.deps];
      assert.deepEqual(packager.parseArguments(args), { host: 'example-tickets', ticketsPackage: tickets,
        lock: lockFile, platformPackage: sourceArchive, platformClient: platformClient.client, output, deps: build.deps });
      assert.throws(() => packager.parseArguments(args.filter((_, index) => index !== 8 && index !== 9)), /须显式提供 --tickets-package/);
      assert.throws(() => packager.parseArguments(args.map(value => value === 'example-tickets' ? 'platform' : value)), /只有工单宿主/);
      assert.throws(() => packager.parseArguments(args.map(value => value === 'example-tickets' ? 'unregistered' : value)), /未登记/);
      assert.throws(() => packager.parseArguments(args.map(value => value === tickets ? 'relative-tickets' : value)), /绝对路径/);
      assert.throws(() => packager.parseArguments([...args, '--tickets-package', tickets]), /重复/);
      const written = packager.main(args);
      assert.equal(written.status, 'packaged'); assert.equal(written.host, 'example-tickets');
      assert.equal(written.sha256, result.sha256);
      assert.deepEqual(memory.fs.readFileSync(output), Buffer.from(result.bytes));
      assert.equal(written.files, result.files.size); assert.equal(written.bytes, result.bytes.length);
      assert.equal(written.imageBuild, 'not-run'); assert.equal(written.configuration, 'pending'); assert.equal(written.deployment, 'pending');
      assert.throws(() => packager.main(args), /已存在/);
      assert.deepEqual(memory.fs.readFileSync(output), Buffer.from(result.bytes), '覆盖拒绝保留原归档');
    } finally {
      if (memory.fs.existsSync(directory)) {
        assert(!memory.fs.lstatSync(directory).isSymbolicLink());
        memory.fs.rmSync(directory, { recursive: true, force: true });
      }
      assert.equal(memory.fs.existsSync(directory), false);
      assert.equal(fs.existsSync(directory), false);
    }
  });
  return { result, lock, groups: 4, workspaces: workspaces.length, files: result.files.size,
    runtimeFiles: result.receipt.runtime.files, sha256: result.sha256, models: result.receipt.clients[0].models,
    platformMigrations: lock.platform.data.migrations.length, coreMigrations: ticketsPackage.pin.manifest.data.migrations.length,
    migrations: lock.platform.data.migrations.length + ticketsPackage.pin.manifest.data.migrations.length,
    fixtureProvenance: true, diskOutputs: 0, imageBuild: 'not-run', configuration: 'pending', deployment: 'pending' };
};

async function verifyRuntimeEvidence({ t, build, memory, platformFiles, result, lock, archive }) {
  const api = memory.load(build.exported('@rental-os/platform-core-host', true));
  const directory = path.join(memory.task, 'platform-installed'), receiptFile = 'platform-host.context.json';
  const deploymentLockFile = 'apps/platform-api/prisma/core.deployment.lock.json';
  for (const [file, bytes] of result.files) memory.put(path.join(directory, file), bytes);
  const runtimeDirectories = new Map(publicDirectories.map(item => [item, path.join(directory, item)]));
  const runtimeEntries = new Map(publicDirectories.map(item => [item,
    path.join(directory, item, item === 'apps/platform-api' ? 'dist/platform-data.js' : 'dist/index.js')]));
  const input = { directory, runtimeDirectories, runtimeEntries, platformFiles, lock, receiptFile, deploymentLockFile };
  await t.test('公共运行证据核实际包目录与入口，拒绝字节和收据篡改', () => {
    assert.equal(api.readPlatformRuntimeEvidence(input), true);
    assert.equal(memory.fs.existsSync(path.join(directory, 'apps/platform-api/src/main.ts')), false);
    const changed = new Map(runtimeEntries); changed.set('apps/platform-api', path.join(directory, 'apps/platform-api/dist/missing.js'));
    assert.throws(() => api.readPlatformRuntimeEvidence({ ...input, runtimeEntries: changed }), /实际加载入口/);
    const other = new Map(runtimeDirectories); other.set('apps/platform-api', path.join(directory, 'another-api'));
    assert.throws(() => api.readPlatformRuntimeEvidence({ ...input, runtimeDirectories: other }), /同一宿主|实际运行/);
    for (const file of ['packages/platform-contracts/dist/index.js', 'packages/platform-server/package.json', deploymentLockFile]) {
      const absolute = path.join(directory, file), original = result.files.get(file);
      memory.put(absolute, Buffer.concat([original, Buffer.from('\nchanged')]));
      try { assert.throws(() => api.readPlatformRuntimeEvidence(input), /摘要|固定包|JSON/); }
      finally { memory.put(absolute, original); }
    }
    const extra = path.join(directory, 'packages/platform-core-host/dist/unlisted.js');
    memory.put(extra, 'module.exports = {};');
    try { assert.throws(() => api.readPlatformRuntimeEvidence(input), /未声明产物/); }
    finally { memory.fs.unlinkSync(extra); }
    const receipt = JSON.parse(result.files.get(receiptFile)); delete receipt.platformBuild;
    memory.put(path.join(directory, receiptFile), json(receipt));
    try { assert.throws(() => api.readPlatformRuntimeEvidence(input), /编译证据/); }
    finally { memory.put(path.join(directory, receiptFile), result.files.get(receiptFile)); }
  });

  // 只替换原 archive reader 的普通 FileHandle 运输；读取边界/身份/摘要/归档检查沿原实现。
  const promises = require('node:fs/promises'), originals = { lstat: promises.lstat, open: promises.open };
  const readonlyFiles = new Map([[path.join(directory, deploymentLockFile), result.files.get(deploymentLockFile)]]);
  promises.lstat = async file => memory.fs.lstatSync(file);
  promises.open = async (file, flags) => {
    assert.equal(flags, 'r');
    // memfs 的读操作会推进 ctime；从已安装的同字节材料模拟只读句柄，避免把运输差异当成文件替换。
    assert(readonlyFiles.has(file), 'readonly handle only opens fixed installed materials');
    const bytes = Buffer.from(readonlyFiles.get(file)), stat = memory.fs.lstatSync(file);
    let closed = false;
    return { stat: async () => { assert(!closed); return stat; },
      read: async (buffer, offset, length, position) => {
        assert(!closed); const bytesRead = Math.max(0, Math.min(length, bytes.length - position));
        bytes.copy(buffer, offset, position, position + bytesRead); return { bytesRead, buffer };
      }, close: async () => { closed = true; } };
  };
  try {
    const storage = path.join(directory, 'managed-core-packages/archives'), reference = 'platform-fixture';
    readonlyFiles.set(path.join(storage, 'index.json'), json({ format: 'core-package-archives-1', artifacts: [
      { reference, file: 'platform.tgz', artifact: { kind: 'platform', release: lock.platform } }
    ] }));
    readonlyFiles.set(path.join(storage, 'platform.tgz'), archive.createCoreArchive(platformFiles).bytes);
    for (const [file, bytes] of readonlyFiles) memory.put(file, bytes);
    let databaseCalls = 0;
    const createSources = (installedDirectory, dirs, entries) => api.createPublicCorePackageDeploymentSources({
      database: { $queryRaw: async () => { databaseCalls++; throw Error('材料读取禁止访问数据库'); } },
      artifacts: api.createPlatformCorePackageArchiveIndexSource({ directory: storage }),
      lockFile: path.join(directory, deploymentLockFile), platformReference: reference,
      platformDirectory: installedDirectory, runtimeDirectories: dirs, ...(entries ? { runtimeEntries: entries } : {}),
      platformData: memory.load(path.join(directory, 'apps/platform-api/dist/platform-data.js')).createPublicPlatformDataPlan
    });
    await t.test('纯运行包从原固定归档读取13迁移材料，缺或坏证据不回退', async () => {
      const source = createSources(directory, runtimeDirectories, runtimeEntries), materials = await source.materials.read();
      assert.deepEqual(materials.base, lock); assert.equal(materials.platform.length, 13); assert.equal(materials.cores.size, 0);
      for (const [index, migration] of materials.platform.entries())
        assert.deepEqual(migration.sql, platformFiles.get('apps/platform-api/' + lock.platform.data.migrations[index].file));
      const receipt = JSON.parse(result.files.get(receiptFile)); delete receipt.platformBuild;
      memory.put(path.join(directory, receiptFile), json(receipt));
      try { await assert.rejects(source.materials.read(), /编译证据/); }
      finally { memory.put(path.join(directory, receiptFile), result.files.get(receiptFile)); }
      memory.fs.unlinkSync(path.join(directory, receiptFile));
      try { await assert.rejects(source.materials.read(), /不存在|不可读|file_unavailable/); }
      finally { memory.put(path.join(directory, receiptFile), result.files.get(receiptFile)); }
      assert.equal(databaseCalls, 0);
      await assert.rejects(source.deployment.read(), /材料读取禁止访问数据库/);
      assert.equal(databaseCalls, 1, '固定归档与运行证据不能代替原数据库观察');
    });
    await t.test('原完整源码目录仍可按旧接点读取，已有运行收据不能降级', async () => {
      const legacy = path.join(memory.task, 'platform-source-compatibility');
      for (const [file, bytes] of platformFiles) memory.put(path.join(legacy, file), bytes);
      const dirs = new Map(publicDirectories.map(item => [item, path.join(legacy, item)]));
      const source = createSources(legacy, dirs), materials = await source.materials.read();
      assert.deepEqual(materials.base, lock); assert.equal(materials.platform.length, 13);
      memory.put(path.join(legacy, receiptFile), json({ format: 'platform-host-context-1' }));
      await assert.rejects(source.materials.read(), /编译证据|运行模块|实际加载入口/);
      assert.equal(databaseCalls, 1, '旧源码兼容读取材料仍不访问数据库');
    });
  } finally { promises.lstat = originals.lstat; promises.open = originals.open; }
}
