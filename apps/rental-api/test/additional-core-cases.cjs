'use strict';
/** 复用宿主包测试的真实 emit、部署锁和 memfs。工单标准包由原打包器生成；
 * 只替换文件存储与不可访问的数据库/运输，不执行入口脚本、迁移或物理部署。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const slash = value => path.resolve(value).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

module.exports = async function runCases({ t, build, memory, lock }) {
  assert(build && memory && lock, '复用原宿主 build/memory/lock，不另造运行器或部署锁');
  assert.equal(build.runtimeAliases.size, 0, '不得替换正式包校验/授权实现');
  const folder = path.join(memory.task, 'additional-core-cases');
  assert.equal(memory.fs.existsSync(folder), false, '本次独占内存 fixture 不覆盖已有材料');
  assert.equal(fs.existsSync(folder), false, 'fixture 只能存在于原 memfs');
  const packageRoot = path.join(root, 'packages/example-tickets-core');
  if (!build.outputs.has(slash(path.join(packageRoot, 'dist/index.js'))))
    build.compile('packages/example-tickets-core/tsconfig.json');
  for (const [file, text] of build.outputs) if (file.startsWith(slash(packageRoot) + '/')) memory.put(file, text);
  const load = name => memory.load(build.exported(name, true));
  const { prepareRentalAdditionalCores } = memory.load(path.join(root, 'apps/rental-api/dist/additional-cores.js'));
  const { createTicketsManifest, createTicketsHttpContribution, createTicketsOpenApi } = load('@rental-os/example-tickets-core');
  const { composeTicketsPlatformHost } = load('@rental-os/example-tickets-core/platform-host');
  const { readTicketsPhysicalData } = load('@rental-os/example-tickets-core/mysql');
  const { packTicketsPackage } = load('@rental-os/example-tickets-core/package');
  const { corePackageFiles } = load('@rental-os/core-contracts/package');
  const { createCoreArchive, readCoreArchive } = load('@rental-os/core-contracts/archive');
  const { corePrismaMigrationName } = load('@rental-os/core-contracts/deployment');
  const source = { repository: 'https://github.com/offline-fixture/additional-cores', commit: 'b'.repeat(40) };
  const manifest = createTicketsManifest(source), original = path.join(folder, 'original');
  let sequence = 0, groups = 0, bindCalls = 0, forbiddenCalls = 0;
  const forbid = () => { forbiddenCalls++; throw Error('prepare/bind 不得访问数据库或运输'); };
  const context = { database: { $queryRaw: forbid, $executeRaw: forbid, $transaction: forbid },
    users: { findUserById: forbid }, audit: { recordCoreBusinessReceipt: forbid },
    term: { requireNewBusiness: forbid }, deployment: { requireAvailable: forbid, requireRegistered: forbid } };
  const run = async (name, work) => { await t.test(name, work); groups++; };
  try {
    // 原生成器负责清单/API/指南；其余文件来自实际源码和本次 emit，未伪造空 server。
    for (const file of corePackageFiles(manifest)) {
      if (['core.manifest.json', 'openapi.json', 'CORE_GUIDE.md'].includes(file)) continue;
      const absolute = path.join(packageRoot, file);
      const content = build.outputs.get(slash(absolute))
        ?? build.sourceRead(file === 'LICENSE' ? path.join(root, 'LICENSE') : absolute);
      assert.notEqual(content, undefined, '缺实际包材料 ' + file);
      memory.put(path.join(original, file), content);
    }
    const archive = packTicketsPackage({ directory: original, source, sourceDirectory: 'packages/example-tickets-core',
      platformSource: source, platformTask: build.sourceRead(path.join(root, 'packages/core-contracts/README.md')),
      host: lock.platform.versions });
    const packageFiles = readCoreArchive(archive.bytes, archive.sha256).files;
    assert.deepEqual(JSON.parse(packageFiles.get('openapi.json')), createTicketsOpenApi());

    function fixture(mutate) {
      const files = new Map([...packageFiles].map(([file, bytes]) => [file, Buffer.from(bytes)]));
      const selected = JSON.parse(files.get('core.manifest.json'));
      mutate?.(files, selected);
      files.set('core.manifest.json', json(selected));
      const directory = path.join(folder, String(++sequence));
      for (const [file, bytes] of files) memory.put(path.join(directory, file), bytes);
      const pin = { manifest: selected, sha256: createCoreArchive(files).sha256 };
      const setup = { coreId: selected.id, entry: path.join(directory, selected.entries.server),
        dataPlan: { data: structuredClone(selected.data),
          migrationNames: selected.data.migrations.map(migration => corePrismaMigrationName(selected.id, migration.id)),
          readPhysical: readTicketsPhysicalData }, http: createTicketsHttpContribution(),
        bind(actual) {
          bindCalls++;
          for (const key of Object.keys(context)) assert.equal(actual[key], context[key], '原宿主同实例 ' + key);
          const binding = composeTicketsPlatformHost(actual);
          return { server: binding.server, binding };
        } };
      return { files, directory, pin, setup, lock: { ...structuredClone(lock), cores: [
        structuredClone(lock.cores.find(pin => pin.manifest.id === 'rental')), pin] } };
    }

    await run('真实工单固定包准备不执行业务；绑定保留原数据库/账号/审计/期限且只调用一次', async () => {
      const f = fixture(), before = bindCalls;
      const [description] = prepareRentalAdditionalCores(f.lock, [f.setup]);
      assert.equal(bindCalls, before);
      assert.equal(description.sha256, f.pin.sha256);
      assert.equal(description.root, f.directory);
      assert.equal(description.entry, f.setup.entry);
      assert.equal(prepareRentalAdditionalCores(f.lock, [{ ...f.setup, entry: slash(f.setup.entry) }])[0].entry, f.setup.entry);
      assert.deepEqual(description.openapi, createTicketsOpenApi());
      assert.deepEqual(description.http, createTicketsHttpContribution());
      assert.deepEqual(description.dataPlan.migrationNames, ['core.example-tickets.tickets.initial']);
      assert(Object.isFrozen(description) && Object.isFrozen(description.manifest.data.migrations));
      assert(Object.isFrozen(description.http.routes[0].permissions));
      const bound = description.bind(context);
      assert.equal(bound.server, bound.binding.server);
      assert.equal(bound.server.coreId, 'example-tickets');
      assert.equal(typeof bound.binding.service.create, 'function');
      assert.equal(bindCalls, before + 1);
      assert.equal(forbiddenCalls, 0);
      assert.throws(() => description.bind(context), /只能绑定一次/);
      let physicalReads = 0;
      assert.equal(await description.dataPlan.readPhysical({ $queryRaw: async () => { physicalReads++; return []; } }), undefined);
      assert.equal(physicalReads, 5, '原五类结构观察缺证据返回 unknown，不从包声明产生 ready');
    });

    await run('Rental 唯一且额外集合精确；缺项/重复/冒充/越出固定锁都拒绝', () => {
      const f = fixture();
      assert.deepEqual(prepareRentalAdditionalCores({ ...f.lock, cores: [f.lock.cores[0]] }, []), []);
      for (const [selected, setups] of [
        [{ ...f.lock, cores: [f.pin] }, [f.setup]],
        [{ ...f.lock, cores: [...f.lock.cores, f.lock.cores[0]] }, [f.setup]],
        [f.lock, []], [f.lock, [f.setup, f.setup]],
        [f.lock, [{ ...f.setup, coreId: 'rental' }]],
        [f.lock, [{ ...f.setup, coreId: 'unselected' }]],
        [f.lock, [{ ...f.setup, bind: undefined }]],
      ]) assert.throws(() => prepareRentalAdditionalCores(selected, setups), /Rental|额外 Core|重复 Core/);
    });

    await run('整包摘要/完整清单/正式出口及无链接实际路径逐项拒绝', () => {
      const f = fixture();
      for (const mutate of [
        pin => { pin.sha256 = '0'.repeat(64); },
        pin => { pin.manifest.source.commit = 'c'.repeat(40); },
        pin => { pin.manifest.version = '0.1.1'; },
        pin => { pin.manifest.description += '改写锁'; },
      ]) {
        const selected = structuredClone(f.lock); mutate(selected.cores[1]);
        assert.throws(() => prepareRentalAdditionalCores(selected, [f.setup]), /不一致/);
      }
      const fakeDist = path.join(folder, 'unprepared-workspace/dist/index.js');
      memory.put(fakeDist, packageFiles.get(manifest.entries.server));
      for (const entry of ['dist/index.js', path.join(f.directory, 'dist/http.js'), path.join(packageRoot, 'src/index.ts'), fakeDist])
        assert.throws(() => prepareRentalAdditionalCores(f.lock, [{ ...f.setup, entry }]));
      const wrongExport = fixture((files) => {
        const metadata = JSON.parse(files.get('package.json'));
        metadata.exports['.'].default = './dist/http.js';
        files.set('package.json', json(metadata));
      });
      assert.throws(() => prepareRentalAdditionalCores(wrongExport.lock, [wrongExport.setup]), /精确运行出口/);
      const sourceEntry = fixture((files, selected) => {
        selected.entries.server = 'src/index.js'; files.set('src/index.js', files.get('dist/index.js'));
      });
      assert.throws(() => prepareRentalAdditionalCores(sourceEntry.lock, [sourceEntry.setup]), /源码|dist/);
      const stat = memory.fs.lstatSync;
      try {
        for (const linked of [f.setup.entry, path.dirname(f.setup.entry), f.directory]) {
          memory.fs.lstatSync = (file, ...args) => {
            const result = stat(file, ...args);
            if (path.resolve(file) === linked) result.isSymbolicLink = () => true;
            return result;
          };
          assert.throws(() => prepareRentalAdditionalCores(f.lock, [f.setup]), /链接/);
        }
      } finally { memory.fs.lstatSync = stat; }
      const read = memory.fs.readFileSync;
      let manifests = 0;
      try {
        memory.fs.readFileSync = (file, ...args) => {
          if (path.resolve(file) === path.join(f.directory, 'core.manifest.json') && ++manifests === 2)
            memory.put(f.setup.entry, 'throw Error("准备绝不执行包入口");');
          return read(file, ...args);
        };
        assert.throws(() => prepareRentalAdditionalCores(f.lock, [f.setup]), /准备期间发生变化/);
      } finally { memory.fs.readFileSync = read; }
    });

    await run('原迁移计划与物理观察必需；容器与显式或隐藏公共外键扩展拒绝', () => {
      const f = fixture();
      for (const plan of [
        { ...f.setup.dataPlan, data: { ...f.setup.dataPlan.data, version: '0.1.1' } },
        { ...f.setup.dataPlan, migrationNames: ['tickets.initial'] },
        { ...f.setup.dataPlan, migrationNames: [] },
        { ...f.setup.dataPlan, readPhysical: undefined },
        { ...f.setup.dataPlan, publicForeignKeys: [{ table: 'Tenant' }] },
      ]) assert.throws(() => prepareRentalAdditionalCores(f.lock, [{ ...f.setup, dataPlan: plan }]), /数据计划|公共外键/);
      const container = fixture((_files, selected) => { selected.scope = { kind: 'container', containerType: 'project' }; });
      assert.throws(() => prepareRentalAdditionalCores(container.lock, [container.setup]), /容器 Core/);
      const prisma = fixture((files, selected) => {
        selected.assets.push('prisma/schema.prisma'); files.set('prisma/schema.prisma', Buffer.from('// 未装配贡献\n'));
      });
      assert.throws(() => prepareRentalAdditionalCores(prisma.lock, [prisma.setup]), /Prisma/);
      const externalKey = fixture((files, selected) => {
        const migration = selected.data.migrations[0];
        const bytes = Buffer.concat([files.get(migration.file), Buffer.from('\nALTER TABLE `Tenant` ADD CONSTRAINT `hidden` FOREIGN KEY (`id`) REFERENCES `example_tickets` (`id`);\n')]);
        files.set(migration.file, bytes); migration.sha256 = createHash('sha256').update(bytes).digest('hex');
      });
      assert.throws(() => prepareRentalAdditionalCores(externalKey.lock, [externalKey.setup]), /外部表外键/);
    });

    await run('HTTP 与固定包同源：别 Core/越权/改路径/收据用途及 Rental 路由均拒绝', () => {
      const f = fixture();
      for (const mutate of [
        http => { http.coreId = 'rental'; },
        http => { http.implementationVersion = '0.1.1'; },
        http => { http.routes[0].permissions = []; },
        http => { http.routes[0].audiences = ['client']; },
        http => { http.routes[0].path = '/rental/v1/orders'; },
        http => { http.routes[0].purpose = 'original_receipt'; },
        http => { http.routes.find(route => route.id === 'create').startsNewBusiness = false; },
        http => { http.routes.pop(); },
      ]) {
        const http = structuredClone(f.setup.http); mutate(http);
        assert.throws(() => prepareRentalAdditionalCores(f.lock, [{ ...f.setup, http }]), /不一致|当前清单/);
      }
      const stolen = fixture((files) => {
        const api = JSON.parse(files.get('openapi.json'));
        api.paths['/api/rental/v1/orders'] = api.paths['/api/cores/example-tickets/tickets'];
        delete api.paths['/api/cores/example-tickets/tickets']; files.set('openapi.json', json(api));
      });
      assert.throws(() => prepareRentalAdditionalCores(stolen.lock, [stolen.setup]), /route_namespace|新接口/);
    });

    await run('候选固定快照且绑定失败不重试；实际服务错身份/版本/容器或缺合同拒绝', () => {
      const f = fixture(), [description] = prepareRentalAdditionalCores(f.lock, [f.setup]);
      f.setup.http.routes[0].permissions.length = 0;
      f.setup.dataPlan.data.migrations.length = 0;
      f.setup.bind = forbid;
      assert.equal(description.http.routes[0].permissions.length, 1);
      assert.equal(description.dataPlan.data.migrations.length, 1);
      description.bind(context);
      for (const mutate of [
        result => { result.server.coreId = 'rental'; },
        result => { result.server.implementationVersion = '0.1.1'; },
        result => { result.server.readReadiness = undefined; },
        result => { result.authorizeContainer = forbid; },
        result => { delete result.binding; },
        result => { result.binding = undefined; },
      ]) {
        const candidate = fixture(), originalBind = candidate.setup.bind;
        candidate.setup.bind = value => { const result = originalBind(value); mutate(result); return result; };
        const [fixed] = prepareRentalAdditionalCores(candidate.lock, [candidate.setup]), before = bindCalls;
        assert.throws(() => fixed.bind(context), /服务端|binding|容器/);
        assert.throws(() => fixed.bind(context), /只能绑定一次/);
        assert.equal(bindCalls, before + 1);
      }
      assert.equal(forbiddenCalls, 0);
    });
    return { groups, packageFiles: packageFiles.size, routes: manifest.id + ':8', diskOutputs: 0, databaseCalls: forbiddenCalls,
      ticketsPackage: { pin: { manifest: archive.manifest, sha256: archive.sha256 }, files: packageFiles } };
  } finally {
    assert.equal(path.dirname(folder), memory.task);
    if (memory.fs.existsSync(folder)) {
      assert.equal(memory.fs.lstatSync(folder).isSymbolicLink(), false);
      memory.fs.rmSync(folder, { recursive: true });
    }
    assert.equal(memory.fs.existsSync(folder), false);
    assert.equal(fs.existsSync(folder), false);
  }
};
