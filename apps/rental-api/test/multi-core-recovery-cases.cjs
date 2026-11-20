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
  const { Volume, createFsFromVolume } = build.requireDeps('memfs');
  const volume = createFsFromVolume(new Volume()), restores = [];
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
    replace(name, (file, ...args) => owns(file) || ancestor(file)
      ? volume[name](key(file), ...args) : original(file, ...args));
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
      if (!owns(file)) return original(file, ...args);
      totals.writes++; return volume[name](key(file), ...args);
    });
  }
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
      return structuredClone(state.receipts.filter(row => bindings.includes(row.migrationName)));
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

module.exports = async function multiCoreRecoveryCases({ build, memory, load, root, lock, catalogue,
  materials, platformArchive, ticketsPackage, rentalPackage }) {
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
