'use strict';
/** Called by the installed-host fixture after its disabled Rental + tickets root.
 * The original package applications, principal/repository, migration observers and
 * file-store execute unchanged. Only SQL rows and a private memfs transport are
 * supplied here. Candidate releases are explicit format fixtures derived from the
 * complete installed archives; no candidate code, DDL or lifecycle is executed.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const cloneFiles = files => new Map([...files].map(([file, bytes]) => [file, Buffer.from(bytes)]));
const slash = file => path.resolve(file).split(path.sep).join('/');
const patchVersion = (version, increment = 1) => {
  const parts = version.split('.').map(Number);
  assert(parts.length === 3 && parts.every(Number.isSafeInteger), 'fixture needs a stable release version');
  return [parts[0], parts[1], parts[2] + increment].join('.');
};

/** A fresh memory volume owns exactly one directory. Outside reads retain the
 * parent's installed-byte checks; no native filesystem operation is introduced.
 * In particular this does not use the build helper's existing temporary root.
 */
function privateFileTransport({ build, memory, root }) {
  const directory = path.resolve(root, 'output/.tmp/rental-participants-recovery');
  const slash = file => {
    const prefix = '\\\\?\\', uncPrefix = prefix + 'UNC\\';
    if (file.startsWith(uncPrefix)) file = '\\\\' + file.slice(uncPrefix.length);
    else if (file.startsWith(prefix)) file = file.slice(prefix.length);
    return path.resolve(file).split(path.sep).join('/');
  };
  const { Volume, createFsFromVolume } = build.requireDeps('memfs');
  const nodes = new Volume(), volume = createFsFromVolume(nodes), restores = [];
  // memfs 3.5 derives birthtime from mutable ctime. Use the same per-Node
  // creation identity as the build adapter, including reused inode generations.
  const births = new WeakMap();
  let nextBirth = 0;
  const assignBirth = node => {
    nextBirth = Math.max(Date.now(), nextBirth + 1);
    births.set(node, nextBirth);
    return node;
  };
  for (const node of Object.values(nodes.inodes)) assignBirth(node);
  const createNode = nodes.createNode;
  nodes.createNode = function (...args) {
    return assignBirth(createNode.apply(this, args));
  };
  const stableStats = (stats, node) => {
    const birth = births.get(node);
    if (birth === undefined) throw Error('private recovery file creation identity is unavailable');
    stats.birthtime = new Date(birth);
    stats.birthtimeMs = typeof stats.birthtimeMs === 'bigint' ? BigInt(birth) : birth;
    return stats;
  };
  for (const name of ['statSync', 'lstatSync']) {
    const original = volume[name];
    volume[name] = (...args) => {
      const stats = original(...args);
      if (stats === undefined) return stats;
      return stableStats(stats, nodes.inodes[Number(stats.ino)]);
    };
  }
  const fstat = volume.fstatSync;
  volume.fstatSync = (descriptor, ...args) =>
    stableStats(fstat(descriptor, ...args), nodes.getFileByFd(descriptor).node);
  const descriptors = new Set();
  const key = file => '/' + slash(file), base = slash(directory);
  const owns = file => slash(file) === base || slash(file).startsWith(base + '/');
  const ancestor = file => base.startsWith(slash(file) + '/') && slash(file).startsWith(slash(root) + '/');
  const totals = { publications: 0, writes: 0 };
  volume.mkdirSync(key(directory), { recursive: true });
  const replace = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(memory.fs, name);
    Object.defineProperty(memory.fs, name, { configurable: true, writable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(memory.fs, name, descriptor) : delete memory.fs[name]);
  };
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'accessSync', 'existsSync']) {
    const original = memory.fs[name];
    replace(name, (file, ...args) => {
      if (name === 'readFileSync' && typeof file === 'number')
        return descriptors.has(file) ? volume.readFileSync(file, ...args) : original(file, ...args);
      return owns(file) || ancestor(file) ? volume[name](key(file), ...args) : original(file, ...args);
    });
  }
  const originalRealpath = memory.fs.realpathSync;
  const realpath = (file, ...args) => {
    if (!owns(file) && !ancestor(file)) return originalRealpath(file, ...args);
    volume.realpathSync(key(file)); return path.resolve(file);
  };
  realpath.native = realpath;
  replace('realpathSync', realpath);
  for (const name of ['mkdirSync', 'writeFileSync', 'rmSync', 'unlinkSync', 'rmdirSync']) {
    const original = memory.fs[name];
    replace(name, (file, ...args) => {
      if (name === 'writeFileSync' && typeof file === 'number') {
        if (!descriptors.has(file)) return original(file, ...args);
        totals.writes++; return volume.writeFileSync(file, ...args);
      }
      if (!owns(file)) return original(file, ...args);
      totals.writes++; return volume[name](key(file), ...args);
    });
  }
  const originalOpen = memory.fs.openSync;
  replace('openSync', (file, ...args) => {
    if (!owns(file)) return originalOpen(file, ...args);
    const descriptor = volume.openSync(key(file), ...args);
    descriptors.add(descriptor);
    return descriptor;
  });
  const originalFstat = memory.fs.fstatSync, originalClose = memory.fs.closeSync;
  replace('fstatSync', (descriptor, ...args) => descriptors.has(descriptor)
    ? volume.fstatSync(descriptor, ...args) : originalFstat(descriptor, ...args));
  replace('closeSync', descriptor => {
    if (!descriptors.has(descriptor)) return originalClose(descriptor);
    volume.closeSync(descriptor);
    descriptors.delete(descriptor);
  });
  const originalTemp = memory.fs.mkdtempSync;
  replace('mkdtempSync', (prefix, ...args) => owns(prefix)
    ? path.resolve(volume.mkdtempSync(key(prefix), ...args).slice(1)) : originalTemp(prefix, ...args));
  for (const name of ['renameSync', 'linkSync']) {
    const original = memory.fs[name];
    replace(name, (from, to, ...args) => {
      if (!owns(from) && !owns(to)) return original(from, to, ...args);
      assert(owns(from) && owns(to), 'publication cannot cross the private fixture boundary');
      const result = volume[name](key(from), key(to), ...args);
      totals.publications++; return result;
    });
  }
  return {
    directory, totals,
    write(relative, bytes) {
      const file = path.resolve(directory, relative);
      assert(owns(file) && file !== directory);
      volume.mkdirSync(path.posix.dirname(key(file)), { recursive: true });
      volume.writeFileSync(key(file), bytes);
      return file;
    },
    read: relative => volume.readFileSync(key(path.resolve(directory, relative))),
    snapshot() {
      const result = new Map();
      const visit = current => {
        for (const entry of volume.readdirSync(key(current), { withFileTypes: true })) {
          const file = path.join(current, entry.name);
          if (entry.isDirectory()) visit(file);
          else result.set(path.relative(directory, file).split(path.sep).join('/'), volume.readFileSync(key(file)));
        }
      };
      visit(directory); return result;
    },
    close() {
      try {
        for (const descriptor of descriptors) volume.closeSync(descriptor);
        descriptors.clear();
        assert.equal(slash(directory), slash(path.resolve(root, 'output/.tmp/rental-participants-recovery')));
        volume.rmSync(key(directory), { recursive: true });
        assert.equal(volume.existsSync(key(directory)), false);
      } finally { for (const restore of restores.reverse()) restore(); }
    }
  };
}

/** Translate the original migration parser's structures into explicit query rows.
 * These are simulated information_schema rows, not an assertion of a real DB.
 * The original physical readers still check each row and the negative cases
 * independently corrupt physical rows and original migration receipts.
 */
function physicalRows(structures) {
  const rows = { tables: [], columns: [], indexes: [], checks: [], foreignKeys: [] };
  for (const table of structures) {
    const tableName = table.name;
    rows.tables.push({ tableName, engine: 'InnoDB', collation: table.collation });
    for (const field of table.columns) rows.columns.push({ tableName, ...field,
      nullable: field.nullable ? 'YES' : 'NO', extra: '' });
    for (const index of table.indexes) index.columns.forEach((columnName, at) => rows.indexes.push({
      tableName, name: index.name, columnName, position: at + 1, nonUnique: index.unique ? 0 : 1, prefix: null, direction: 'A'
    }));
    for (const check of table.checks) rows.checks.push({ tableName, ...check, enforced: 'YES' });
    for (const key of table.foreignKeys) key.columns.forEach((columnName, at) => rows.foreignKeys.push({
      tableName, name: key.name, position: at + 1, columnName, targetTable: key.targetTable,
      targetColumn: key.targetColumns[at], sameSchema: 1, deleteRule: key.deleteRule, updateRule: key.updateRule
    }));
  }
  return rows;
}

function rowDatabase({ rawSql, plans, physical }) {
  const expiresAt = new Date(Date.now() + 3_600_000);
  const state = {
    tenant: { id: 'package-manager-tenant', status: 'ACTIVE' },
    user: { id: 'package-manager-user', tenantId: 'package-manager-tenant', account: 'offline-package-manager',
      displayName: 'Offline package manager', isActive: true, isSaasAdmin: true, isPlatformAdmin: false,
      mustChangePassword: false, organization: null, organizationId: null, roleId: 'package-manager-role', roleAssignments: [] },
    role: { id: 'package-manager-role', tenantId: 'package-manager-tenant', name: 'Package manager',
      scope: 'OPERATOR', dataScope: 'ALL', isActive: true, fixedAllPermissions: false, buttonPermissions: [],
      permissions: [{ permission: { id: 'package-manager-permission', code: 'system:tenant:manage' } }] },
    session: { id: 'package-manager-session', userId: 'package-manager-user', audience: 'operator',
      currentWorkspaceId: null, revokedAt: null, expiresAt },
    receipts: plans.flatMap(plan => plan.migrationNames.map((migrationName, index) => ({ migrationName,
      checksum: plan.data.migrations[index].sha256, finishedAt: new Date('2026-11-01T00:00:00.000Z'),
      rolledBackAt: null, hasFailure: false }))),
    physical, audits: [], reads: [], transactions: 0, loseAuditCommit: false,
    forbiddenWrites: 0
  };
  const query = async (strings, ...values) => {
    const statement = Array.isArray(strings) ? rawSql(strings, ...values) : strings;
    const sql = statement.sql.replace(/\s+/gu, ' ').trim(), bindings = statement.values;
    assert(/^SELECT\b/u.test(sql), 'only original SELECT statements are allowed: ' + sql);
    state.reads.push({ sql, values: [...bindings] });
    if (sql.includes('FROM _prisma_migrations')) {
      assert(sql.includes('ORDER BY started_at, id'));
      const tail = sql.slice(sql.indexOf('FROM _prisma_migrations'));
      if (/\bWHERE\b/u.test(tail)) {
        assert.match(tail, /^FROM _prisma_migrations WHERE migration_name IN \(\?(?:, ?\?)*\) ORDER BY started_at, id$/u);
        assert(bindings.length && bindings.every(value => typeof value === 'string'));
        assert.equal((tail.match(/\?/gu) || []).length, bindings.length);
        return structuredClone(state.receipts.filter(row => bindings.includes(row.migrationName)));
      }
      // The current observer reads the entire original ledger to detect newer
      // owned migrations. Preserve its row order; no bindings means no filtering.
      assert.equal(tail, 'FROM _prisma_migrations ORDER BY started_at, id');
      assert.deepEqual(bindings, []);
      return structuredClone(state.receipts);
    }
    const table = sql.includes('information_schema.TABLES') ? 'tables'
      : sql.includes('information_schema.COLUMNS') ? 'columns'
        : sql.includes('information_schema.STATISTICS') ? 'indexes'
          : sql.includes('information_schema.TABLE_CONSTRAINTS') ? 'checks'
            : sql.includes('information_schema.KEY_COLUMN_USAGE') ? 'foreignKeys' : undefined;
    if (table) return structuredClone(state.physical[table].filter(row => bindings.includes(row.tableName)));
    assert(sql.endsWith('FOR UPDATE'), 'principal reads keep the original locking statement');
    if (sql.includes('FROM Tenant WHERE')) return bindings[0] === state.tenant.id
      ? [{ id: state.tenant.id, status: state.tenant.status.toLowerCase() }] : [];
    if (sql.includes('FROM `User` WHERE')) return bindings[0] === state.user.id && bindings[1] === state.user.tenantId
      ? [{ roleId: state.user.roleId, isActive: state.user.isActive, isSaasAdmin: state.user.isSaasAdmin }] : [];
    if (sql.includes('FROM auth_sessions WHERE')) return bindings[0] === state.session.id && bindings[1] === state.session.userId
      ? [{ id: state.session.id }] : [];
    if (sql.includes('FROM `UserRole` WHERE')) { assert.equal(bindings[0], state.user.id); return []; }
    if (sql.includes('FROM `Role` WHERE')) return bindings[0] === state.role.id && bindings[1] === state.role.tenantId
      ? [{ id: state.role.id }] : [];
    if (sql.includes('FROM `RolePermission` WHERE')) {
      assert.equal(bindings[0], state.role.id);
      return state.role.permissions.map(item => ({ permissionId: item.permission.id }));
    }
    if (sql.includes('FROM `Permission` WHERE')) return state.role.permissions
      .filter(item => item.permission.id === bindings[0]).map(item => ({ id: item.permission.id }));
    throw Error('unexpected SQL: ' + sql);
  };
  const denyWrite = () => { state.forbiddenWrites++; throw Error('no migration, business or initialization write is allowed'); };
  const database = {
    $queryRaw: query, $executeRaw: denyWrite, $executeRawUnsafe: denyWrite,
    async $transaction(work, options) {
      assert.equal(options?.isolationLevel, 'ReadCommitted');
      state.transactions++;
      let active = true;
      const pending = [], requireActive = () => assert(active, 'transaction handle cannot escape');
      const transaction = {
        $queryRaw: (...args) => { requireActive(); return query(...args); },
        $executeRaw: denyWrite,
        user: { async findFirst({ where }) {
          requireActive();
          assert.deepEqual(where, { id: state.user.id, isActive: true, tenant: { status: 'ACTIVE' } });
          return state.user.isActive && state.tenant.status === 'ACTIVE'
            ? structuredClone({ ...state.user, role: state.role }) : null;
        } },
        authSession: { async findFirst({ where }) {
          requireActive();
          assert.equal(where.id, state.session.id); assert.equal(where.userId, state.user.id);
          assert.equal(where.audience, 'operator'); assert.equal(where.revokedAt, null);
          return !state.session.revokedAt && state.session.expiresAt > where.expiresAt.gt
            ? structuredClone(state.session) : null;
        } },
        operationLog: { async create({ data }) {
          requireActive();
          assert.equal(data.tenantId, state.tenant.id); assert.equal(data.userId, state.user.id);
          assert.equal(data.action, 'core.package.preparation.requested');
          pending.push(structuredClone(data)); return { id: 'audit-' + state.transactions, ...data };
        } }
      };
      try {
        const result = await work(transaction);
        state.audits.push(...pending);
        if (pending.length && state.loseAuditCommit) {
          state.loseAuditCommit = false;
          throw Error('fixture: commit completed but its reply was lost');
        }
        return result;
      } finally { active = false; }
    }
  };
  const identity = { tenantId: state.tenant.id, userId: state.user.id, audience: 'operator',
    accessSession: { sessionId: state.session.id, expiresAt: Math.floor(expiresAt.getTime() / 1000), workspaceId: null } };
  return { database, state, identity };
}

/** onPreparedCandidate only collects detached candidate materials. The caller must
 * await the enclosing root's finally before packing or loading another runtime.
 * Its payload is { request, artifact, record }; artifact includes the complete fixed
 * archive bytes, and the original record.plan contains base/candidate. Unchanged
 * packages remain in the caller's original maps; no live handle is handed out.
 */
module.exports = async function multiCoreRecoveryCases({ build, memory, load, root, lock, catalogue,
  materials, platformArchive, ticketsPackage, rentalPackage, onPreparedCandidate }) {
  assert(onPreparedCandidate === undefined || typeof onPreparedCandidate === 'function');
  assert.deepEqual(lock.cores.map(pin => pin.manifest.id).sort(), ['example-tickets', 'rental']);
  assert.equal(lock.dataCapabilities?.length ?? 0, 0, 'this fixture must not omit selected AI data');
  const contracts = load('@rental-os/core-contracts');
  const archive = load('@rental-os/core-contracts/archive');
  const install = load('@rental-os/core-contracts/install');
  const deployment = load('@rental-os/core-contracts/deployment');
  const publicCore = load('@rental-os/platform-core-host');
  const { createCoreDeployedCatalogue } = load('@rental-os/core-host');
  const { createMysqlCoreDeploymentObservation } = load('@rental-os/core-host/mysql-deployment');
  const { PlatformAuthenticationRepository } = load('@rental-os/platform-server');
  const { runWithRequestIdentity } = load('@rental-os/platform-server/request-identity');
  const { prismaRuntime } = load('@rental-os/platform-server/prisma-runtime');
  const rental = rentalPackage();
  const source = await materials.read();
  assert(source); assert.deepEqual(source.base, lock);
  assert.deepEqual(source.cores.get('example-tickets'), ticketsPackage.files);
  const originalMaterials = { base: structuredClone(source.base),
    platform: source.platform.map(item => ({ ...item, sql: Buffer.from(item.sql) })),
    cores: new Map([...source.cores].map(([id, files]) => [id, cloneFiles(files)])) };
  const publicPlan = load('@rental-os/platform-api/data-plan').createPublicPlatformDataPlan(rental.dataPlan.publicForeignKeys);
  const ticketsPlan = { coreId: 'example-tickets', data: ticketsPackage.pin.manifest.data,
    migrationNames: ticketsPackage.pin.manifest.data.migrations.map(item => deployment.corePrismaMigrationName('example-tickets', item.id)),
    readPhysical: load('@rental-os/example-tickets-core/mysql').readTicketsPhysicalData };
  const corePlans = [{ ...rental.dataPlan, coreId: 'rental' }, ticketsPlan];
  assert.deepEqual(publicPlan.data, lock.platform.data);
  const sql = [...source.platform.map(item => Buffer.from(item.sql).toString()),
    ...lock.cores.flatMap(pin => pin.manifest.data.migrations.map(item =>
      Buffer.from(source.cores.get(pin.manifest.id).get(item.file)).toString()))];
  // The tickets SQL omits actions; information_schema reports MySQL's RESTRICT
  // defaults. Add only this exact fixture spelling for the common row projector.
  const fixtureSql = sql.map(text => text.replace(
    /REFERENCES `example_tickets` \(`tenant_id`, `id`\)(?=\s*\n\))/u,
    '$& ON DELETE RESTRICT ON UPDATE RESTRICT'));
  const rows = physicalRows(publicCore.mysqlStructureFromMigrations(fixtureSql));
  const f = rowDatabase({ rawSql: prismaRuntime.sql, plans: [publicPlan, ...corePlans], physical: rows });
  const observer = createMysqlCoreDeploymentObservation({ database: f.database, platform: publicPlan, cores: corePlans });
  const currentCatalogue = createCoreDeployedCatalogue({ lock,
    registrations: [...catalogue.registrations.values()], observations: observer });
  const users = new PlatformAuthenticationRepository(f.database);
  const legacyApiRoutes = { rental: memory.load(path.join(root, 'apps/rental-api/dist/openapi.js')).rentalHostLegacyApiRoutes() };
  const sourceFactory = memory.load(path.join(root, 'apps/rental-api/dist/core-package-sources.js'));
  const sources = sourceFactory.createRentalCorePackageSources({ lock, rentalPackage,
    configuration: { get: name => ({ CORE_PACKAGE_STORAGE_ROOT: path.join(root, 'managed-core-packages'),
      CORE_PLATFORM_PACKAGE_REFERENCE: 'current-platform' }[name]) },
    additionalCorePackages: [{ root: path.join(root, 'packages/example-tickets-core'),
      entry: path.resolve(build.exported('@rental-os/example-tickets-core', true)), ...ticketsPackage.pin }],
    observe: () => observer.read() });
  const files = privateFileTransport({ build, memory, root });
  let groups = 0, assertions = 0, artifactReads = 0, deploymentReads = 0, materialReads = 0;
  let unavailableSources = false, corruptMaterials = false;
  const artifacts = new Map();
  const asManager = work => runWithRequestIdentity(structuredClone(f.identity), work);
  const checked = (value, expected, message) => { assert.deepEqual(value, expected, message); assertions++; };
  const group = async (name, work) => { await work(); groups++; console.log('PASS multi-Core recovery: ' + name); };
  const compose = () => publicCore.composePlatformCorePackageAssembly({ database: f.database, users,
    catalogue: currentCatalogue, audit: publicCore.createPlatformCorePackageAudit(),
    storageDirectory: path.join(files.directory, 'store'), legacyApiRoutes,
    fetcher: () => { throw Error('recovery fixture cannot use a network release'); },
    localArtifacts: { async read(reference) {
      artifactReads++; assert(!unavailableSources, 'receipt must not reread the selected package'); return artifacts.get(reference);
    } },
    deployment: { async read() {
      deploymentReads++; assert(!unavailableSources, 'receipt must not revalidate a later active deployment');
      return sources.deployment.read();
    } },
    materials: { async read() {
      materialReads++; assert(!unavailableSources, 'receipt must not reconstruct its original candidate');
      const value = await sources.materials.read();
      if (!corruptMaterials || !value) return value;
      const changed = { ...value, cores: new Map(value.cores) }, selected = cloneFiles(changed.cores.get('example-tickets'));
      selected.delete(ticketsPlan.data.migrations[0].file); changed.cores.set('example-tickets', selected);
      return changed;
    } }
  });
  const request = (kind, reference) => ({ operation: 'update', package: { kind, reference,
    ...(kind === 'core' ? { coreId: 'example-tickets' } : {}) } });
  const coreCandidate = increment => {
    const target = cloneFiles(ticketsPackage.files), manifest = structuredClone(ticketsPackage.pin.manifest);
    manifest.version = patchVersion(manifest.version, increment);
    manifest.source.commit = digest('offline tickets candidate ' + increment).slice(0, 40);
    target.set('core.manifest.json', json(manifest));
    const metadata = JSON.parse(target.get('package.json')); metadata.version = manifest.version;
    target.set('package.json', json(metadata));
    // This is a complete version-only fixture, not a declaration of new business
    // behavior. Keep the emitted implementation's own release constant in sync.
    for (const name of ['dist/contracts.js', 'dist/contracts.d.ts']) {
      const text = target.get(name).toString(), before = ticketsPackage.pin.manifest.version;
      const pattern = /TICKETS_CORE_VERSION = "([^"]+)"/u;
      assert.equal(text.match(pattern)?.[1], before);
      target.set(name, Buffer.from(text.replace(pattern, 'TICKETS_CORE_VERSION = "' + manifest.version + '"')));
    }
    const candidateRoot = path.join(files.directory, 'inputs', 'tickets-' + increment);
    for (const [name, bytes] of target) files.write(path.relative(files.directory, path.join(candidateRoot, name)), bytes);
    const packed = install.packCoreDirectory(candidateRoot, contracts.coreDeploymentHostVersions(lock));
    checked(packed.manifest, manifest, 'original packer reads the entire candidate package');
    return { kind: 'core', pin: { manifest, sha256: packed.sha256 }, bytes: packed.bytes };
  };
  try {
    for (const name of ['store/releases', 'store/candidates']) memory.fs.mkdirSync(path.join(files.directory, name), { recursive: true });
    const configuration = json({ locale: 'zh-CN', userValue: 'preserve-this-local-setting', coreChoices: ['rental', 'example-tickets'] });
    files.write('configuration/user.json', configuration);
    const core = coreCandidate(1); artifacts.set('tickets-next', core);
    const platformInputs = cloneFiles(archive.readCoreArchive(platformArchive.bytes, lock.platform.sha256).files);
    const rootMetadata = JSON.parse(platformInputs.get('package.json'));
    rootMetadata.version = patchVersion(lock.platform.versions.platform); platformInputs.set('package.json', json(rootMetadata));
    const platformSource = { ...lock.platform.source, commit: digest('offline compatible platform candidate').slice(0, 40) };
    const nextSource = load('@rental-os/core-contracts/platform-source').createPlatformSource(platformInputs, platformSource);
    const packedPlatform = archive.createCoreArchive(nextSource.files);
    const platform = { kind: 'platform', release: { ...structuredClone(lock.platform), source: platformSource,
      sha256: packedPlatform.sha256, versions: { ...lock.platform.versions, platform: nextSource.version } }, bytes: packedPlatform.bytes };
    artifacts.set('platform-next', platform);
    const application = compose();

    await group('actual installed materials preserve both pins, or only replace tickets', async () => {
      const snapshot = await sources.deployment.read();
      assert(snapshot); checked(snapshot.lock, lock); checked(snapshot.installed.cores, lock.cores);
      checked(snapshot.data.cores.map(item => item.coreId).sort(), ['example-tickets', 'rental']);
      const publications = files.totals.publications;
      for (const [kind, reference] of [['platform', 'platform-next'], ['core', 'tickets-next']]) {
        const input = request(kind, reference);
        const planned = await asManager(() => application.preflight.update(input.package));
        checked(planned.status, 'inspected'); checked(planned.plan.status, 'checked'); checked(planned.plan.result.ok, true);
        checked(planned.plan.deployment, 'pending');
        const preview = await asManager(() => application.preparation.preview(input));
        checked(preview.status, 'ready'); checked(preview.plan.deployment, 'pending'); checked(preview.plan.base, lock);
        if (kind === 'platform') checked(preview.plan.candidate.cores, lock.cores);
        else {
          checked(preview.plan.candidate.platform, lock.platform);
          checked(preview.plan.candidate.cores.find(pin => pin.manifest.id === 'rental'), lock.cores.find(pin => pin.manifest.id === 'rental'));
          checked(preview.plan.candidate.cores.find(pin => pin.manifest.id === 'example-tickets'), core.pin);
        }
        const result = await asManager(() => application.preparation.prepare({ request: input, expectedSha256: preview.sha256 }));
        checked(result.status, 'prepared'); checked(result.record.plan, preview.plan);
        for (const migration of preview.plan.files.filter(item => item.file.endsWith('/migration.sql'))) {
          const bytes = files.read('store/candidates/' + preview.sha256 + '/' + migration.file);
          checked(digest(bytes), migration.sha256);
        }
        if (onPreparedCandidate) {
          const beforeReceipt = { artifactReads, deploymentReads, materialReads,
            publications: files.totals.publications, audits: f.state.audits.length };
          const receipt = await asManager(() => application.preparation.receipt({ sha256: preview.sha256 }));
          checked(receipt.status, 'recorded'); checked(receipt.record, result.record);
          checked({ artifactReads, deploymentReads, materialReads,
            publications: files.totals.publications, audits: f.state.audits.length }, beforeReceipt,
          'candidate handoff reads the original receipt without preparing or publishing again');
          const plan = receipt.record.plan;
          const preparedFiles = new Map(plan.files.map(item => [item.file,
            Buffer.from(files.read('store/candidates/' + receipt.record.sha256 + '/' + item.file))]));
          checked([...preparedFiles].map(([file, bytes]) => ({ file, sizeBytes: bytes.length, sha256: digest(bytes) })),
            plan.files, 'handoff bytes match every file in the original receipt');
          assert(plan.artifact.kind === 'core' || plan.artifact.kind === 'platform');
          const pin = plan.artifact.kind === 'core' ? plan.artifact.pin : undefined;
          const prefix = pin ? `package/${pin.manifest.id}-${pin.manifest.version}-${pin.sha256}/` : 'platform/';
          const contents = new Map([...preparedFiles].filter(([file]) => file.startsWith(prefix))
            .map(([file, bytes]) => [file.slice(prefix.length), bytes]));
          const packed = archive.createCoreArchive(contents);
          checked(packed.sha256, pin ? pin.sha256 : plan.artifact.release.sha256,
            'complete published candidate bytes retain their fixed archive identity');
          // No loader, transaction, filesystem closure or mutable live fixture is
          // handed out. In particular, do not place archive buffers in the result log.
          await onPreparedCandidate({ request: structuredClone(plan.request),
            artifact: { ...structuredClone(plan.artifact), bytes: Buffer.from(packed.bytes) },
            record: structuredClone(receipt.record) });
        }
      }
      assert(files.totals.publications > publications);
      checked(files.read('configuration/user.json'), configuration);
      const unchanged = await materials.read();
      checked(unchanged.base, originalMaterials.base); checked(unchanged.platform, originalMaterials.platform);
      checked(unchanged.cores, originalMaterials.cores);
      const beforeReject = files.totals.publications;
      artifacts.set('platform-incompatible', { ...platform, release: { ...platform.release,
        versions: { ...platform.release.versions, contract: '9.0.0' } } });
      checked((await asManager(() => application.preparation.preview(request('platform', 'platform-incompatible')))).status, 'unavailable');
      corruptMaterials = true;
      try {
        const refused = await asManager(() => application.preparation.preview(request('core', 'tickets-next')));
        checked(refused.status, 'unavailable'); checked(refused.error.code, 'materials_invalid');
      } finally { corruptMaterials = false; }
      checked(files.totals.publications, beforeReject, 'rejected preparation never publishes');
    });

    await group('original unknown receipt and physical evidence independently control readiness', async () => {
      const row = f.state.receipts.find(value => value.migrationName === ticketsPlan.migrationNames[0]);
      assert(row); const original = structuredClone(row);
      await currentCatalogue.availability.requireAvailable('rental');
      await currentCatalogue.availability.requireAvailable('example-tickets');
      row.finishedAt = null;
      try {
        const observed = await observer.read();
        const pending = observed.cores.find(item => item.coreId === 'example-tickets');
        checked(pending.execution.state, 'unknown');
        checked(pending.execution.migration, { id: ticketsPlan.data.migrations[0].id, sha256: original.checksum });
        checked(pending.appliedMigrations, []);
        await assert.rejects(currentCatalogue.availability.requireAvailable('example-tickets'), /迁移|就绪/u); assertions++;
        await currentCatalogue.availability.requireAvailable('rental');
        const before = files.totals.publications;
        checked((await asManager(() => application.preparation.preview(request('platform', 'platform-next')))).status, 'unavailable');
        checked(files.totals.publications, before);
        checked((await observer.read('example-tickets')).cores[0].execution.state, 'unknown', 'rereading intact physical rows does not finish a migration');
        row.finishedAt = original.finishedAt; row.checksum = 'f'.repeat(64);
        await assert.rejects(currentCatalogue.availability.requireAvailable('example-tickets'), /迁移|就绪/u); assertions++;
        row.checksum = original.checksum;
        const physical = f.state.physical.tables;
        f.state.physical.tables = physical.filter(table => table.tableName !== 'example_tickets');
        try {
          await assert.rejects(currentCatalogue.availability.requireAvailable('example-tickets'), /迁移|就绪/u); assertions++;
          await currentCatalogue.availability.requireAvailable('rental');
        } finally { f.state.physical.tables = physical; }
        await currentCatalogue.availability.requireAvailable('example-tickets');
        checked((await asManager(() => application.preparation.preview(request('platform', 'platform-next')))).status, 'ready');
        checked(row, original, 'only the fixture restored the original migration row');
      } finally { Object.assign(row, original); }
    });

    await group('future owned migrations and optional physical failures preserve module isolation', async () => {
      const receipts = f.state.receipts, physical = f.state.physical;
      const before = { transactions: f.state.transactions, audits: f.state.audits.length, writes: f.state.forbiddenWrites };
      const denied = error => error.code === 'core_unavailable';
      const baseline = await observer.read(), rentalPhysical = await rental.dataPlan.readPhysical(f.database);
      assert(rentalPhysical);
      for (const coreId of ['rental', 'example-tickets']) await currentCatalogue.availability.requireAvailable(coreId);
      // Future SQL is a format fixture only. A new table or a data-only backfill
      // can leave every old table's physical digest unchanged; the full ledger
      // must still reject this older Rental implementation.
      const newTable = 'CREATE TABLE `rental_future_fixture` (\n'
        + '  `id` VARCHAR(191) NOT NULL,\n  PRIMARY KEY (`id`)\n'
        + ') DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;';
      const extra = physicalRows(publicCore.mysqlStructureFromMigrations([newTable]));
      const backfill = 'UPDATE `business_workspaces` SET `id` = `id`;';
      try {
        for (const [kind, text, finishedAt, hasFailure, rolledBackAt = null] of [
          ['new-table', newTable, new Date('2026-11-02T00:00:00.000Z'), false],
          ['backfill', backfill, new Date('2026-11-02T00:00:00.000Z'), false],
          ['failed', backfill, null, true], ['unknown', backfill, null, false],
          ['rolled-back-table', newTable, null, true, new Date('2026-11-03T00:00:00.000Z')],
          ['rolled-back-backfill', backfill, null, true, new Date('2026-11-03T00:00:00.000Z')]
        ]) {
          f.state.receipts = [...receipts, { migrationName: deployment.corePrismaMigrationName('rental', 'rental.future-' + kind),
            checksum: digest(text), finishedAt, rolledBackAt, hasFailure }];
          f.state.physical = text === newTable
            ? Object.fromEntries(Object.entries(physical).map(([name, values]) => [name, [...values, ...extra[name]]])) : physical;
          const oldTables = await rental.dataPlan.readPhysical(f.database);
          checked(oldTables?.sha256, rentalPhysical.sha256, kind + ': old physical evidence alone still matches');
          const observed = await observer.read();
          checked(observed.cores.find(item => item.coreId === 'rental'), undefined, kind + ': unknown owned migration omits Rental');
          checked(observed.cores.find(item => item.coreId === 'example-tickets'),
            baseline.cores.find(item => item.coreId === 'example-tickets'), kind + ': Tickets evidence is retained');
          await assert.rejects(currentCatalogue.availability.requireAvailable('rental'), denied); assertions++;
          await currentCatalogue.availability.requireAvailable('example-tickets');
        }
        f.state.receipts = receipts; f.state.physical = physical;
        const knownReceipt = receipts.find(row => row.migrationName.startsWith('core.rental.'));
        assert(knownReceipt);
        f.state.receipts = [...receipts, { ...knownReceipt, finishedAt: null,
          rolledBackAt: new Date('2026-11-03T00:00:00.000Z'), hasFailure: true }];
        checked(await observer.read(), baseline, 'known rolled-back attempt does not duplicate the applied receipt');
        f.state.receipts = receipts.filter(row => row !== knownReceipt).concat({ ...knownReceipt, finishedAt: null,
          rolledBackAt: new Date('2026-11-03T00:00:00.000Z'), hasFailure: true });
        await assert.rejects(currentCatalogue.availability.requireAvailable('rental'), denied); assertions++;
        await currentCatalogue.availability.requireAvailable('example-tickets');
        f.state.receipts = receipts;

        // This disabled installed root has no AI package. Select an explicit
        // capability contract fixture with a throwing physical transport; never
        // load an AI runtime or provide a fabricated successful observation.
        const range = version => ({ minInclusive: version, maxExclusive: patchVersion(version) });
        const schema = { file: 'prisma/schema.prisma', sha256: digest('offline unavailable AI schema fixture') };
        const capability = contracts.CorePlatformDataCapabilityReleaseSchema.parse({
          id: 'ai-native', version: '0.1.0', source: lock.platform.source, sha256: digest('offline unavailable AI package fixture'),
          compatibility: { platform: range(lock.platform.versions.platform), contract: range(lock.platform.versions.contract) },
          runtime: { node: range(lock.platform.versions.node) }, schema, files: [schema],
          data: { version: '0.1.0', readable: range('0.1.0'), migrations: [] },
          prerequisites: { platform: range(lock.platform.data.version), cores: [] }
        });
        let failedPhysicalReads = 0;
        const isolated = createMysqlCoreDeploymentObservation({ database: f.database, platform: publicPlan, cores: corePlans,
          dataCapabilities: [{ capabilityId: capability.id, data: capability.data, migrationNames: [],
            async readPhysical() { failedPhysicalReads++; throw Error('fixture: optional AI physical read failed'); } }] });
        const withAi = createCoreDeployedCatalogue({ lock: { ...lock, dataCapabilities: [capability] },
          registrations: [...currentCatalogue.registrations.values()], observations: isolated });
        const observed = await isolated.read();
        checked(observed.dataCapabilities, [], 'failed physical evidence cannot become a ready capability');
        checked(observed.cores, baseline.cores, 'optional AI failure preserves both ordinary Core observations');
        for (const coreId of ['rental', 'example-tickets']) await withAi.availability.requireAvailable(coreId);
        await assert.rejects(withAi.requireDataCapabilityAvailable('ai-native'), denied); assertions++;
        assert(failedPhysicalReads > 0, 'the optional physical reader really threw'); assertions++;

        for (const [migrationName, rolledBackAt] of [
          ['20990101000000_public_future', null], ['20261001000000_legacy_mixed', null],
          ['20990101000000_public_future', new Date('2026-11-03T00:00:00.000Z')]
        ]) {
          f.state.receipts = [...receipts, { migrationName, checksum: digest(migrationName),
            finishedAt: rolledBackAt ? null : new Date('2026-11-02T00:00:00.000Z'), rolledBackAt, hasFailure: false }];
          await assert.rejects(observer.read(), denied); assertions++;
          for (const coreId of ['rental', 'example-tickets']) {
            await assert.rejects(currentCatalogue.availability.requireAvailable(coreId), denied); assertions++;
          }
        }
      } finally { f.state.receipts = receipts; f.state.physical = physical; }
      checked(await observer.read(), baseline, 'restoring original evidence restores the original observations');
      checked({ transactions: f.state.transactions, audits: f.state.audits.length, writes: f.state.forbiddenWrites }, before,
        'migration admission checks never execute DDL, business writes or recovery actions');
    });

    await group('lost commit reply reopens the original file receipt without re-publication', async () => {
      artifacts.set('tickets-recovery', coreCandidate(2));
      const input = request('core', 'tickets-recovery');
      const preview = await asManager(() => application.preparation.preview(input));
      checked(preview.status, 'ready');
      const before = files.totals.publications;
      f.state.loseAuditCommit = true;
      const result = await asManager(() => application.preparation.prepare({ request: input, expectedSha256: preview.sha256 }));
      checked(result.status, 'unknown'); checked(result.sha256, preview.sha256);
      assert(files.totals.publications > before, 'original file publication completed before the lost reply'); assertions++;
      const persisted = files.snapshot(), published = files.totals.publications, auditCount = f.state.audits.length;
      const readsBefore = { artifactReads, deploymentReads, materialReads };
      artifacts.delete('tickets-recovery'); unavailableSources = true;
      try {
        const reopened = compose();
        const receipt = await asManager(() => reopened.preparation.receipt({ sha256: preview.sha256 }));
        checked(receipt.status, 'recorded'); checked(receipt.record.plan, preview.plan);
        checked(receipt.record.plan.deployment, 'pending');
        checked({ artifactReads, deploymentReads, materialReads }, readsBefore, 'recovery is not a new preflight');
        checked(files.totals.publications, published); checked(files.snapshot(), persisted); checked(f.state.audits.length, auditCount);
        f.state.role.isActive = false;
        try { await assert.rejects(asManager(() => reopened.preparation.receipt({ sha256: preview.sha256 })), /权限/u); assertions++; }
        finally { f.state.role.isActive = true; }
        const originalFile = 'store/candidates/' + preview.sha256 + '/deployment/core.deployment.lock.json';
        const bytes = files.read(originalFile);
        files.write(originalFile, Buffer.concat([bytes, Buffer.from(' ')]));
        try {
          await assert.rejects(asManager(() => reopened.preparation.receipt({ sha256: preview.sha256 })),
            error => error.code === 'operation_conflict'); assertions++;
          checked(files.totals.publications, published, 'damaged original receipt is not overwritten');
        } finally { files.write(originalFile, bytes); }
      } finally { unavailableSources = false; }
      checked(f.state.forbiddenWrites, 0);
      checked(files.read('configuration/user.json'), configuration);
    });
    return { groups, assertions, transactions: f.state.transactions, originalAudits: f.state.audits.length,
      publications: files.totals.publications, sqlReads: f.state.reads.length,
      diskOutputs: 0, migrationWrites: f.state.forbiddenWrites, lifecycle: 'not-run', deployment: 'pending' };
  } finally { files.close(); }
};

/** One original row store is retained across the old and both candidate installed
 * loaders. These are explicit SQL/Auth transport facts, not recreated grants or
 * initialization calls. The current ticket deliberately differs from its receipt.
 */
function createOriginalCoreFacts() {
  const tenantId = 'original-tenant', coreIds = ['rental', 'example-tickets'];
  const accounts = [
    ['saas', 'tenant_platform', ['system:tenant:manage']],
    ['manager', tenantId, ['system:user:manage', 'example-tickets:ticket:read']],
    ['other', 'another-tenant', ['system:user:manage', 'example-tickets:ticket:read']]
  ];
  const expiresAt = new Date(Date.now() + 3_600_000);
  const auth = accounts.map(([name, tenant, permissions]) => {
    const user = { id: 'original-' + name, tenantId: tenant, account: name, displayName: name,
      isActive: true, isSaasAdmin: name === 'saas', isPlatformAdmin: false, mustChangePassword: false,
      organization: null, organizationId: null, roleId: 'role-' + name, roleAssignments: [] };
    const role = { id: user.roleId, tenantId: tenant, name, scope: 'OPERATOR', dataScope: 'ALL',
      isActive: true, fixedAllPermissions: false, buttonPermissions: [], permissions: permissions.map((code, index) => ({
        permission: { id: name + '-permission-' + index, code }
      })) };
    const session = { id: 'session-' + name, userId: user.id, audience: 'operator', currentWorkspaceId: null,
      revokedAt: null, expiresAt };
    return { name, user, role, session,
      actor: { tenantId: tenant, subjectId: user.id, audience: 'operator' },
      identity: { tenantId: tenant, userId: user.id, audience: 'operator',
        accessSession: { sessionId: session.id, expiresAt: Math.floor(expiresAt.getTime() / 1000), workspaceId: null } } };
  });
  const [saas, manager] = auth, grants = [], assignments = [], management = [], bindings = [], bindingOperations = [];
  for (const coreId of coreIds) {
    const grant = { tenantId, coreId, state: 'enabled', revision: 3, operationId: coreId + '-grant' };
    const assignment = { tenantId, coreId, userId: manager.user.id, state: 'assigned', revision: 2, operationId: coreId + '-member' };
    grants.push(grant); assignments.push(assignment);
    for (const [kind, actor, result] of [['tenant_grant', saas.actor, grant], ['member_assignment', manager.actor, assignment]]) {
      const input = kind === 'tenant_grant'
        ? { tenantId, coreId, state: result.state, expectedRevision: result.revision - 1, operationId: result.operationId }
        : { coreId, userId: result.userId, state: result.state, expectedRevision: result.revision - 1, operationId: result.operationId };
      management.push({ tenantId, coreId, kind, actorTenantId: actor.tenantId, actorId: actor.subjectId,
        fingerprint: digest(JSON.stringify([actor.tenantId, actor.subjectId, actor.audience, kind, input])), result });
    }
    const scope = { tenantId, coreId, ...(coreId === 'rental' ? { container: { type: 'workspace', id: 'original-workspace' } } : {}) };
    const scopeHash = digest(JSON.stringify([coreId, tenantId, scope.container?.type ?? null, scope.container?.id ?? null]));
    const binding = { ...scope, bindingId: coreId + '-original-binding', revision: 1, dataVersion: '0.1.0' };
    const operation = { ...scope, operationId: coreId + '-initialize', action: 'initialize', implementationVersion: '0.1.0' };
    const input = { coreId, ...(scope.container ? { container: scope.container } : {}), operationId: operation.operationId, expectedRevision: 0 };
    const normalize = value => value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
    bindings.push({ scopeHash, binding });
    bindingOperations.push({ tenantId, coreId, scopeHash, actorId: manager.user.id, actorTenantId: tenantId,
      fingerprint: digest(JSON.stringify(normalize({ actor: manager.actor, scope, request: input }))), operation, binding });
  }
  const historical = { id: 'original-ticket', tenantId, subject: 'Retained original ticket', description: 'Original business fact',
    createdBy: manager.user.id, assigneeId: manager.user.id, state: 'in_progress', revision: 4,
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
  const ticket = { ...historical, state: 'closed', revision: 5, updatedAt: '2026-11-03T00:00:00.000Z' };
  const operationId = 'original-ticket-start';
  return { tenantId, coreIds, auth, tenants: accounts.map(([, id]) => ({ id, status: 'ACTIVE' })),
    grants, assignments, management, bindings, bindingOperations, ticket,
    ticketOperation: { tenantId, operationId, actorId: manager.user.id, fingerprint: digest(JSON.stringify([
      manager.user.id, 'start', { operationId, ticketId: ticket.id, expectedRevision: 3 }
    ])), result: historical } };
}

/** Load only the caller's installed formal exports. Original receipt paths do not
 * need a new deployment/term admission; those unused ports throw instead of
 * supplying a fake available catalogue. TicketsService.receipt still reads the
 * current ticket for ACL before returning its distinct historical result.
 */
async function verifyOriginalCoreFacts({ load, facts }) {
  const before = structuredClone(facts), stats = { groups: 0, transactions: 0, sqlReads: 0, identityReads: 0,
    writes: 0, audits: 0, initializations: 0, newAdmission: 0, originalReceipts: 0 };
  const { PlatformAuthenticationRepository } = load('@rental-os/platform-server/authentication');
  const { runWithRequestIdentity } = load('@rental-os/platform-server/request-identity');
  const { prismaRuntime } = load('@rental-os/platform-server/prisma-runtime');
  const { composePlatformCoreManagement, composePlatformCoreBindings } = load('@rental-os/platform-core-host');
  const { composeTicketsPlatformHost } = load('@rental-os/example-tickets-core/platform-host');
  const denied = key => () => { stats[key]++; throw Error('original facts cannot perform ' + key); };
  const forbiddenWrite = denied('writes');
  const database = { $queryRaw: () => { throw Error('original facts require the original transaction'); },
    $executeRaw: forbiddenWrite, $executeRawUnsafe: forbiddenWrite,
    async $transaction(work, options) {
      assert.deepEqual(options, { isolationLevel: 'ReadCommitted' }); stats.transactions++;
      let active = true, currentObjectReads = 0;
      const trace = [], check = () => assert(active, 'original transaction cannot escape');
      const tx = {
        async $queryRaw(parts, ...values) {
          check(); stats.sqlReads++;
          const statement = Array.isArray(parts) ? prismaRuntime.sql(parts, ...values) : parts;
          const sql = statement.sql.replace(/\s+/gu, ' ').trim(), args = statement.values;
          const read = (expected, find) => { assert.equal(sql, expected); return structuredClone(find()); };
          if (sql.includes('FROM Tenant WHERE')) return read('SELECT id, status FROM Tenant WHERE id = ? FOR UPDATE', () => {
            assert.equal(args.length, 1); trace.push('Tenant');
            return facts.tenants.filter(row => row.id === args[0]).map(row => ({ id: row.id, status: row.status.toLowerCase() }));
          });
          if (sql.includes('FROM `User` WHERE')) return read('SELECT roleId, isActive, isSaasAdmin FROM `User` WHERE id = ? AND tenantId = ? FOR UPDATE', () => {
            assert.equal(args.length, 2); trace.push('User');
            return facts.auth.filter(row => row.user.id === args[0] && row.user.tenantId === args[1]).map(({ user }) => ({
              roleId: user.roleId, isActive: user.isActive, isSaasAdmin: user.isSaasAdmin
            }));
          });
          if (sql.includes('FROM auth_sessions WHERE')) return read('SELECT id FROM auth_sessions WHERE id = ? AND userId = ? FOR UPDATE', () => {
            assert.equal(args.length, 2); trace.push('Session');
            return facts.auth.filter(row => row.session.id === args[0] && row.session.userId === args[1]).map(row => ({ id: row.session.id }));
          });
          if (sql.includes('FROM `UserRole` WHERE')) return read('SELECT roleId FROM `UserRole` WHERE userId = ? ORDER BY roleId FOR UPDATE', () => {
            assert.equal(args.length, 1); assert(facts.auth.some(row => row.user.id === args[0])); return [];
          });
          if (sql.includes('FROM `Role` WHERE')) return read('SELECT id FROM `Role` WHERE id = ? AND tenantId = ? FOR UPDATE', () => {
            assert.equal(args.length, 2); trace.push('Role');
            return facts.auth.filter(row => row.role.id === args[0] && row.role.tenantId === args[1]).map(row => ({ id: row.role.id }));
          });
          if (sql.includes('FROM `RolePermission` WHERE')) return read('SELECT permissionId FROM `RolePermission` WHERE roleId = ? ORDER BY permissionId FOR UPDATE', () => {
            assert.equal(args.length, 1); return facts.auth.filter(row => row.role.id === args[0])
              .flatMap(row => row.role.permissions.map(item => ({ permissionId: item.permission.id })));
          });
          if (sql.includes('FROM `Permission` WHERE')) return read('SELECT id FROM `Permission` WHERE id = ? FOR UPDATE', () => {
            assert.equal(args.length, 1); return facts.auth.flatMap(row => row.role.permissions)
              .filter(row => row.permission.id === args[0]).map(row => ({ id: row.permission.id }));
          });
          assert(trace.indexOf('Tenant') >= 0 && trace.indexOf('Tenant') < trace.indexOf('User')
            && trace.indexOf('User') < trace.indexOf('Session') && trace.indexOf('Session') < trace.indexOf('Role')
            && trace.includes('auth:session') && trace.includes('auth:user'), 'original Auth/Tenant locks precede every Core read');
          if (sql.includes('FROM platform_core_access_locks')) return read('SELECT tenant_id FROM platform_core_access_locks WHERE tenant_id = ? AND core_id = ? FOR UPDATE', () => {
            assert.equal(args.length, 2); trace.push('Core');
            return facts.grants.filter(row => row.tenantId === args[0] && row.coreId === args[1]).map(row => ({ tenant_id: row.tenantId }));
          });
          if (sql.includes('FROM platform_core_management_operations')) return read('SELECT kind, actor_tenant_id AS actorTenantId, actor_id AS actorId, fingerprint, result FROM platform_core_management_operations WHERE tenant_id = ? AND core_id = ? AND operation_id = ?', () => {
            assert(trace.includes('Core')); assert.equal(args.length, 3);
            return facts.management.filter(row => row.tenantId === args[0] && row.coreId === args[1] && row.result.operationId === args[2])
              .map(({ kind, actorTenantId, actorId, fingerprint, result }) => ({ kind, actorTenantId, actorId, fingerprint, result }));
          });
          if (sql.includes('FROM platform_core_binding_operations')) return read('SELECT actor_id AS actorId, actor_tenant_id AS actorTenantId, fingerprint, operation, binding FROM platform_core_binding_operations WHERE tenant_id = ? AND core_id = ? AND scope_hash = ? AND operation_id = ?', () => {
            assert(trace.includes('Core')); assert.equal(args.length, 4);
            return facts.bindingOperations.filter(row => row.tenantId === args[0] && row.coreId === args[1]
              && row.scopeHash === args[2] && row.operation.operationId === args[3]);
          });
          if (sql.includes('FROM platform_core_bindings')) return read('SELECT binding_id AS bindingId, revision, data_version AS dataVersion, container_type AS containerType, container_id AS containerId FROM platform_core_bindings WHERE tenant_id = ? AND core_id = ? AND scope_hash = ?', () => {
            assert.equal(args.length, 3); return facts.bindings.filter(row => row.binding.tenantId === args[0]
              && row.binding.coreId === args[1] && row.scopeHash === args[2]).map(({ binding }) => ({ bindingId: binding.bindingId,
              revision: binding.revision, dataVersion: binding.dataVersion, containerType: binding.container?.type ?? null, containerId: binding.container?.id ?? null }));
          });
          if (sql.includes('FROM example_ticket_operations')) return read('SELECT actor_id AS actorId, fingerprint, result FROM example_ticket_operations WHERE tenant_id = ? AND operation_id = ?', () => {
            assert.equal(args.length, 2); const row = facts.ticketOperation;
            return row.tenantId === args[0] && row.operationId === args[1] ? [{ actorId: row.actorId, fingerprint: row.fingerprint, result: row.result }] : [];
          });
          if (sql.includes('FROM example_tickets WHERE')) return read('SELECT id, tenant_id AS tenantId, subject, description, created_by AS createdBy, assignee_id AS assigneeId, state, revision, created_at AS createdAt, updated_at AS updatedAt FROM example_tickets WHERE tenant_id = ? AND id = ?', () => {
            assert.equal(args.length, 2); const row = facts.ticket;
            if (row.tenantId !== args[0] || row.id !== args[1]) return [];
            currentObjectReads++;
            return [{ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }];
          });
          throw Error('unexpected original-facts SQL: ' + sql);
        },
        $executeRaw: forbiddenWrite, $executeRawUnsafe: forbiddenWrite,
        user: { async findFirst({ where, include }) {
          check(); stats.identityReads++; trace.push('auth:user');
          assert.deepEqual(where, { id: where.id, isActive: true, tenant: { status: 'ACTIVE' } });
          assert(include.role?.include?.permissions?.include?.permission && include.roleAssignments?.include?.role);
          const row = facts.auth.find(item => item.user.id === where.id);
          return row?.user.isActive && facts.tenants.some(tenant => tenant.id === row.user.tenantId && tenant.status === 'ACTIVE')
            ? structuredClone({ ...row.user, role: row.role }) : null;
        }, create: forbiddenWrite, update: forbiddenWrite, updateMany: forbiddenWrite },
        authSession: { async findFirst({ where }) {
          check(); stats.identityReads++; trace.push('auth:session');
          assert.deepEqual(Object.keys(where).sort(), ['audience', 'expiresAt', 'id', 'revokedAt', 'userId']);
          assert.equal(where.audience, 'operator'); assert.equal(where.revokedAt, null); assert(where.expiresAt.gt instanceof Date);
          const row = facts.auth.find(item => item.session.id === where.id && item.session.userId === where.userId);
          return row && !row.session.revokedAt && row.session.expiresAt > where.expiresAt.gt ? structuredClone(row.session) : null;
        }, create: forbiddenWrite, updateMany: forbiddenWrite },
        operationLog: { create: denied('audits') }
      };
      try {
        const result = await work(tx);
        if (result?.receipt?.ticket) assert.equal(currentObjectReads, 1, 'receipt must check the current object once');
        return result;
      } finally { active = false; }
    } };
  const users = new PlatformAuthenticationRepository(database);
  const deployment = { requireRegistered: denied('newAdmission'), requireAvailable: denied('newAdmission') };
  const audit = { recordCoreAccessReceipt: denied('audits'), recordCoreBindingReceipt: denied('audits'), recordCoreBusinessReceipt: denied('audits') };
  const term = { requireNewBusiness: denied('newAdmission') };
  const management = composePlatformCoreManagement({ database, users, audit, deployment }).service;
  const binding = composePlatformCoreBindings({ database, users, audit, term, deployment, registrations: new Map(),
    authorizeContainer: denied('initializations'), mutationPrecondition: denied('initializations') }).service;
  const tickets = composeTicketsPlatformHost({ database, users, audit, term, deployment }).service;
  const [saas, manager, other] = facts.auth;
  const as = (account, work) => runWithRequestIdentity(structuredClone(account.identity), work);
  const reads = facts.coreIds.flatMap(coreId => {
    const grant = facts.grants.find(row => row.coreId === coreId), assignment = facts.assignments.find(row => row.coreId === coreId);
    const original = facts.bindingOperations.find(row => row.coreId === coreId);
    return [
      { account: saas, call: actor => management.readTenantGrantOperation(actor, { tenantId: facts.tenantId, coreId, operationId: grant.operationId }),
        expected: { status: 'recorded', grant } },
      { account: manager, call: actor => management.readMemberAssignmentOperation(actor, { coreId, userId: manager.user.id, operationId: assignment.operationId }),
        expected: { status: 'recorded', assignment } },
      { account: manager, call: actor => binding.readOperation(actor, { coreId, ...(original.binding.container ? { container: original.binding.container } : {}),
        operationId: original.operation.operationId }), expected: { status: 'recorded', operation: original.operation, binding: original.binding } }
    ];
  });
  const ticketRead = { account: manager, call: actor => tickets.receipt(actor, facts.ticketOperation.operationId),
    expected: { status: 'recorded', receipt: { operationId: facts.ticketOperation.operationId, ticket: facts.ticketOperation.result } } };
  reads.push(ticketRead);
  const rejected = status => error => status ? error.getStatus?.() === status : error.code === 'denied' || error.getStatus?.() === 403;
  const verify = async () => {
    for (const read of reads) {
      assert.deepEqual(await as(read.account, () => read.call(read.account.actor)), read.expected); stats.originalReceipts++;
    }
  };
  try {
    await verify(); stats.groups++;
    for (const account of [saas, manager]) account.role.isActive = false;
    try { for (const read of reads) await assert.rejects(as(read.account, () => read.call(read.account.actor)), rejected()); }
    finally { for (const account of [saas, manager]) account.role.isActive = true; }
    stats.groups++;
    for (const account of [saas, manager]) account.session.revokedAt = new Date();
    try { for (const read of reads) await assert.rejects(as(read.account, () => read.call(read.account.actor)), rejected(401)); }
    finally { for (const account of [saas, manager]) account.session.revokedAt = null; }
    stats.groups++;
    // A real current account in another tenant cannot borrow the original actor,
    // select another tenant's member, or find its binding receipt by operation key.
    for (const read of reads) await assert.rejects(as(other, () => read.call(read.account.actor)), rejected(403));
    await assert.rejects(as(other, () => reads[0].call(other.actor)), rejected());
    await assert.rejects(as(other, () => reads[1].call(other.actor)), rejected(403));
    for (const read of [reads[2], reads[5]]) assert.deepEqual(await as(other, () => read.call(other.actor)), { status: 'unavailable' });
    // A missing foreign-tenant binding is denied before the ticket receipt query.
    await assert.rejects(as(other, () => ticketRead.call(other.actor)), rejected());
    stats.groups++;
    await verify(); stats.groups++;
    assert.equal(facts.ticket.state, 'closed'); assert.equal(facts.ticket.revision, 5);
    assert.equal(facts.ticketOperation.result.state, 'in_progress'); assert.equal(facts.ticketOperation.result.revision, 4);
    return { ...stats, factSha256: digest(JSON.stringify(facts)), diskOutputs: 0 };
  } finally {
    assert.deepEqual(facts, before, 'every installed runtime must leave the same original row store unchanged');
    assert.deepEqual({ writes: stats.writes, audits: stats.audits, initializations: stats.initializations, newAdmission: stats.newAdmission },
      { writes: 0, audits: 0, initializations: 0, newAdmission: 0 });
  }
}

module.exports.createOriginalCoreFacts = createOriginalCoreFacts;
module.exports.verifyOriginalCoreFacts = verifyOriginalCoreFacts;
