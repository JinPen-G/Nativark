'use strict';
/** 原宿主打包 runner 的定向插件，共用本次真实 emit、Rental/AI 包和工单完整包。
 * 这里只读材料并在内存准备候选；不另编译、不执行包入口、不落盘或连接数据库。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// The host runner consumes these cases too; the pure parser can be checked alone
// with the same loader without rebuilding the fixed Rental/AI/tickets artifacts.
async function runArgumentCases({ t, parse }) {
  let groups = 0, cases = 0;
  const run = async (name, work) => { await t.test(name, work); groups++; };
  const base = ['platform.json', 'prepared-rental', 'new-migrations'];
  const ai = ['ai-release.json', 'prepared-ai'];
  const directory = name => path.resolve(root, 'output/explicit-package-fixture', name);
  const expected = { releaseFile: base[0], rentalPackageDirectory: base[1], targetDirectory: base[2], additionalCoreDirectories: [] };
  const check = (args, result) => {
    const original = [...args]; assert.deepEqual(parse(args), result); assert.deepEqual(args, original); cases++;
  };
  const refuse = (args, pattern) => { assert.throws(() => parse(args), pattern); cases++; };
  await run('CLI 原三个或五个位置参数保持兼容，不发现额外 Core', () => {
    check(base, expected);
    check([...base, ...ai], { ...expected, ai: { releaseFile: ai[0], packageDirectory: ai[1] } });
  });
  await run('CLI 额外完整目录只从末尾显式选入，顺序与 AI 原位置保持', () => {
    const paths = [directory('tickets'), directory('second')];
    const flags = paths.flatMap(value => ['--additional-core', value]);
    check([...base, ...flags], { ...expected, additionalCoreDirectories: paths });
    check([...base, ...ai, ...flags], { ...expected, ai: { releaseFile: ai[0], packageDirectory: ai[1] }, additionalCoreDirectories: paths });
    const bounded = Array.from({ length: 8 }, (_, index) => directory(`core-${index}`));
    check([...base, ...bounded.flatMap(value => ['--additional-core', value])], { ...expected, additionalCoreDirectories: bounded });
    refuse([...base, ...[...bounded, directory('core-8')].flatMap(value => ['--additional-core', value])], /最多.*8/u);
  });
  await run('CLI 缺值、相对目录、未知参数及交错位置不触发包准备', () => {
    for (const args of [[], base.slice(0, 2), [...base, ai[0]], [...base, ...ai, 'extra-positional'],
      [...base.slice(0, 2), '--additional-core', directory('tickets'), base[2]]]) refuse(args, /用法/u);
    for (const suffix of [['--additional-core'], ['--additional-core', ''], ['--additional-core', '--unknown']])
      refuse([...base, ...suffix], /缺少/u);
    for (const value of ['relative/package', '../package']) refuse([...base, '--additional-core', value], /绝对目录/u);
    refuse([...base, '--unknown', directory('tickets')], /未知/u);
    refuse([...base, '--additional-core=' + directory('tickets')], /未知/u);
    refuse([...base, '--additional-core', directory('tickets'), ...ai], /未知/u);
    if (process.platform === 'win32') {
      refuse([...base, '--additional-core', '\\root-relative'], /绝对目录/u);
      refuse([...base, '--additional-core', 'C:drive-relative'], /绝对目录/u);
    }
  });
  await run('CLI 相同、规范化相同或重复 Rental 的目录拒绝', () => {
    const target = directory('tickets');
    for (const duplicate of [target, target + path.sep + '.', path.join(target, 'nested', '..')])
      refuse([...base, '--additional-core', target, '--additional-core', duplicate], /目录重复/u);
    refuse([...base, '--additional-core', path.resolve(base[1])], /Rental/u);
    if (process.platform === 'win32') refuse([...base, '--additional-core', target, '--additional-core', target.toUpperCase()], /目录重复/u);
  });
  return { groups, cases, diskOutputs: 0, databaseCalls: 0 };
}

module.exports = async function runCases({ t, load, preparationInput, aiFormatFixture, ticketsPackage }) {
  assert(t?.test && typeof load === 'function' && preparationInput && aiFormatFixture && ticketsPackage,
    '须复用原宿主 runner 的加载器和三个完整固定包');
  const { createRentalDeploymentFiles, parseRentalDeploymentArguments } = load(path.join(root, 'apps/rental-api/dist/prepare-deployment.js'));
  const { rentalHostLegacyApiRoutes } = load(path.join(root, 'apps/rental-api/dist/openapi.js'));
  const { createCoreArchive } = load(path.join(root, 'packages/core-contracts/dist/archive.js'));
  const { inspectCorePackageFiles } = load(path.join(root, 'packages/core-contracts/dist/package.js'));
  const { createCoreMigrationDeployment, corePrismaMigrationName, platformCapabilityPrismaMigrationName } =
    load(path.join(root, 'packages/core-contracts/dist/deployment.js'));
  const { composeCorePrismaSchema } = load(path.join(root, 'packages/core-contracts/dist/prisma.js'));
  const { composeAiNativePrismaSchema } = load(path.join(root, 'packages/ai-native-data/dist/prisma-schema.js'));
  const { coreDeploymentHostVersions } = load(path.join(root, 'packages/core-contracts/dist/index.js'));
  const originals = [preparationInput.coreFiles, ticketsPackage.files, aiFormatFixture.files]
    .map(files => [...files].map(([file, bytes]) => [file, hash(bytes)]));
  const legacyApiRoutes = { rental: rentalHostLegacyApiRoutes() };
  let groups = 0, cases = 0;
  const run = async (name, work) => { await t.test(name, work); groups++; };
  const refuse = (value, expected) => {
    assert.throws(() => createRentalDeploymentFiles({ ...preparationInput, additionalCores: value }), expected);
    cases++;
  };
  function changed(mutate) {
    const files = new Map([...ticketsPackage.files].map(([file, bytes]) => [file, Buffer.from(bytes)]));
    const manifest = JSON.parse(files.get('core.manifest.json'));
    mutate(files, manifest);
    files.set('core.manifest.json', json(manifest));
    return { pin: { manifest, sha256: createCoreArchive(files).sha256 }, files };
  }
  function noExtraResult(ai) {
    const result = createRentalDeploymentFiles({ ...preparationInput, ...(ai ? { ai } : {}) });
    const expectedLock = { lockVersion: 1, platform: preparationInput.release, cores: [preparationInput.pin],
      ...(ai ? { dataCapabilities: [ai.release] } : {}) };
    const original = new Map(createCoreMigrationDeployment({ lock: expectedLock, platform: preparationInput.publicMigrations,
      cores: new Map([['rental', preparationInput.coreFiles]]), legacyApiRoutes,
      ...(ai ? { dataCapabilities: new Map([[ai.release.id, ai.files]]) } : {}) }));
    const base = composeCorePrismaSchema(preparationInput.publicSchema, [result.rental.prisma]);
    original.set('schema.prisma', Buffer.from(ai ? composeAiNativePrismaSchema(base, result.ai.contribution) : base));
    assert.deepEqual(result.lock, expectedLock); assert.deepEqual(result.files, original);
    assert.deepEqual(createRentalDeploymentFiles({ ...preparationInput, ...(ai ? { ai } : {}), additionalCores: [] }).files, original);
    return result;
  }
  try {
    const argumentsResult = await runArgumentCases({ t, parse: parseRentalDeploymentArguments });
    groups += argumentsResult.groups; cases += argumentsResult.cases;
    await run('省略或空额外 Core 时，公共/Rental/可选 AI 原候选逐字节兼容', () => {
      for (const ai of [undefined, aiFormatFixture]) {
        noExtraResult(ai); cases++;
      }
    });
    await run('真实工单完整包加入锁与迁移；schema/原迁移字节和 prepared 边界保持', () => {
      assert.equal(ticketsPackage.pin.manifest.id, 'example-tickets');
      assert.equal(createCoreArchive(ticketsPackage.files).sha256, ticketsPackage.pin.sha256);
      for (const ai of [undefined, aiFormatFixture]) {
        const baseline = noExtraResult(ai);
        const result = createRentalDeploymentFiles({ ...preparationInput, ...(ai ? { ai } : {}), additionalCores: [ticketsPackage] });
        assert.equal(result.status, 'prepared'); assert.equal(result.deployment, 'pending');
        assert.equal(result.aiMode, ai ? 'enabled' : 'disabled');
        assert.deepEqual(result.lock.cores, [preparationInput.pin, ticketsPackage.pin]);
        assert.deepEqual(result.lock.dataCapabilities, baseline.lock.dataCapabilities);
        assert.deepEqual(JSON.parse(result.files.get('core.deployment.lock.json')), result.lock);
        for (const [file, bytes] of baseline.files) if (file !== 'core.deployment.lock.json')
          assert.deepEqual(result.files.get(file), bytes, '原文件不能被额外 Core 改写：' + file);
        for (const migration of ticketsPackage.pin.manifest.data.migrations)
          assert.deepEqual(result.files.get(`migrations/${corePrismaMigrationName(ticketsPackage.pin.manifest.id, migration.id)}/migration.sql`),
            ticketsPackage.files.get(migration.file));
        assert.equal(result.files.size, baseline.files.size + ticketsPackage.pin.manifest.data.migrations.length);
        const ordered = [...result.files.keys()].filter(file => /^migrations\/.+\/migration\.sql$/u.test(file));
        assert.deepEqual(ordered, [...ordered].sort(), '保持原 Prisma 目录执行排序');
        if (ai) for (const migration of ai.release.data.migrations)
          assert.deepEqual(result.files.get(`migrations/${platformCapabilityPrismaMigrationName(ai.release.id, migration.id)}/migration.sql`),
            ai.files.get(migration.file));
        cases++;
      }
    });
    await run('重复、替换 Rental、非 tenant 与自带 Prisma 均不成为 prepared', () => {
      refuse([ticketsPackage, ticketsPackage], /重复|替换 Rental/u);
      refuse([{ pin: preparationInput.pin, files: preparationInput.coreFiles }], /重复|替换 Rental/u);
      refuse([changed((_files, manifest) => { manifest.scope = { kind: 'container', containerType: 'project' }; })], /tenant/u);
      for (const file of ['prisma/schema.prisma', 'PRISMA/SCHEMA.PRISMA', 'prisma.config.ts', 'generated/client/index.js']) {
        const extra = changed((files, manifest) => {
          manifest.assets.push(file); files.set(file, Buffer.from('/* 固定但不受本期合成支持的贡献 */'));
        });
        refuse([extra], /Prisma/u);
      }
      refuse([changed(files => {
        const metadata = JSON.parse(files.get('package.json')); metadata.prisma = { schema: 'schema.txt' };
        files.set('package.json', json(metadata));
      })], /Prisma/u);
    });
    await run('完整包摘要、来源、声明、宿主合同和未知文件不可由调用者补证', () => {
      for (const mutate of [
        pin => { pin.sha256 = '0'.repeat(64); },
        pin => { pin.manifest.source.commit = 'c'.repeat(40); },
        pin => { pin.manifest.source.repository = 'https://github.com/offline-fixture/other-source'; },
        pin => { pin.manifest.description += '改变固定声明'; }
      ]) {
        const pin = structuredClone(ticketsPackage.pin); mutate(pin);
        refuse([{ pin, files: ticketsPackage.files }], /完整包.*不一致/u);
      }
      refuse([changed((_files, manifest) => {
        manifest.compatibility.contract = { minInclusive: '9.0.0', maxExclusive: '10.0.0' };
      })], /完整包.*不一致/u);
      const missing = new Map(ticketsPackage.files); missing.delete(ticketsPackage.pin.manifest.entries.server);
      refuse([{ pin: { ...ticketsPackage.pin, sha256: createCoreArchive(missing).sha256 }, files: missing }], /完整包.*不一致/u);
      const unknown = new Map(ticketsPackage.files); unknown.set('undeclared.txt', Buffer.from('不属于固定声明'));
      refuse([{ pin: { ...ticketsPackage.pin, sha256: createCoreArchive(unknown).sha256 }, files: unknown }], /未声明/u);
    });
    await run('缺失或篡改迁移拒绝；通过完整原校验的迁移原字节才进入候选', () => {
      const migration = ticketsPackage.pin.manifest.data.migrations[0];
      assert(migration);
      refuse([changed(files => { files.delete(migration.file); })], /完整包.*不一致/u);
      refuse([changed(files => { files.set(migration.file, Buffer.concat([files.get(migration.file), Buffer.from('\n-- changed\n')])); })], /完整包.*不一致/u);
      const pin = structuredClone(ticketsPackage.pin); pin.manifest.data.migrations[0].sha256 = '0'.repeat(64);
      refuse([{ pin, files: ticketsPackage.files }], /完整包.*不一致/u);
    });
    await run('Rental 旧路径许可不能借给额外 Core，即使完整包自身摘要已重算', () => {
      const stolen = changed(files => {
        const api = JSON.parse(files.get(ticketsPackage.pin.manifest.entries.openapi));
        const own = Object.keys(api.paths).find(route => api.paths[route].get);
        const rentalRoute = legacyApiRoutes.rental.find(route => route.startsWith('GET ')).slice(4);
        assert(own); api.paths[rentalRoute] = { get: api.paths[own].get }; delete api.paths[own].get;
        if (!Object.keys(api.paths[own]).length) delete api.paths[own];
        files.set(ticketsPackage.pin.manifest.entries.openapi, json(api));
      });
      const host = coreDeploymentHostVersions({ lockVersion: 1, platform: preparationInput.release,
        cores: [preparationInput.pin, stolen.pin] });
      assert.equal(inspectCorePackageFiles(stolen.files, host, legacyApiRoutes.rental).ok, true,
        '反例仅因宿主没有授予额外 Core 旧路径许可而拒绝');
      assert.equal(inspectCorePackageFiles(stolen.files, host).ok, false);
      refuse([stolen], /完整包.*不一致/u);
    });
    return { groups, cases, diskOutputs: 0, databaseCalls: 0, deployment: 'pending' };
  } finally {
    assert.deepEqual([preparationInput.coreFiles, ticketsPackage.files, aiFormatFixture.files]
      .map(files => [...files].map(([file, bytes]) => [file, hash(bytes)])), originals, '不得修改共享固定包材料');
  }
};

module.exports.runArgumentCases = runArgumentCases;
