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
    for (const option of ['--ai', '--host', '--client', '--rental-package', '--tickets-package', '--ai-data-package'])
      assert.throws(() => packager.parseArguments([option, 'enabled']), /未知/);
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
