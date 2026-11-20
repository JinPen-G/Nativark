'use strict';
/** 原 Core 管理/绑定、身份锁和 Rental 准备器的同事务接入验证。
 * 只用行存储/物理部署观察fixture；不连接DB、不安装、不写client/dist。
 * node packages/rental-core/test/legacy-access-adoption.test.cjs --deps <只读 node_modules>
 */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.resolve(root, 'output/.tmp/rental-lead-participants');
let ownsTemporary = false;
function cleanup() {
  if (!ownsTemporary) return;
  if (path.relative(root, temporary) !== path.join('output', '.tmp', 'rental-lead-participants')
    || fs.lstatSync(temporary).isSymbolicLink() || fs.realpathSync(temporary) !== temporary) throw Error('临时目录身份不符');
  const audit = path.join(temporary, 'audit.log');
  if (fs.existsSync(audit) && fs.statSync(audit).size) { process.exitCode = 1; console.error('离线守卫存在拒绝记录'); }
  fs.rmSync(temporary, { recursive: true });
  assert.equal(fs.existsSync(temporary), false);
  ownsTemporary = false;
}
if (fs.existsSync(temporary)) throw Error('任务临时目录已存在，拒绝覆盖');
for (const relative of ['', 'output', 'output/.tmp']) {
  const target = path.resolve(root, relative);
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target)) throw Error('临时父目录为链接');
}
process.once('exit', cleanup);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { process.exitCode = code; cleanup(); process.exit(); });
fs.mkdirSync(temporary, { recursive: true }); ownsTemporary = true;
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'audit.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const rd = Module.createRequire(path.join(deps, 'offline.cjs')), ts = rd('typescript'), aliases = new Map(), loaded = new Map();
for (const top of ['packages', 'apps']) for (const entry of fs.readdirSync(path.join(root, top), { withFileTypes: true })) {
  const directory = path.join(root, top, entry.name), manifest = path.join(directory, 'package.json');
  if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const target = typeof value === 'string' ? value : value.types ?? value.default;
    if (typeof target !== 'string' || key.includes('*')) continue;
    const file = path.resolve(directory, target.replace(/^\.\/dist\//u, './src/').replace(/\.d\.ts$/u, '.ts').replace(/\.js$/u, '.ts'));
    if (fs.existsSync(file)) aliases.set(pkg.name + (key === '.' ? '' : key.slice(1)), file);
  }
}
function load(file) {
  if (!fs.existsSync(file)) file += '.ts';
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts');
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} }; loaded.set(file, module);
  const text = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, esModuleInterop: true, experimentalDecorators: true } }).outputText;
  const requireSource = name => {
    if (name === '@prisma/client') throw Error('禁止加载默认生成 Client');
    if (aliases.has(name)) return load(aliases.get(name));
    if (name.startsWith('@rental-os/')) throw Error(`没有正式出口 ${name}`);
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : rd(name);
  };
  new Function('require', 'module', 'exports', '__dirname', '__filename', text)(requireSource, module, module.exports, path.dirname(file), file);
  return module.exports;
}
const sourceModule = name => load(path.join(root, 'packages/rental-core/src', name + '.ts'));
const { createRentalLegacyAccessPreparation } = sourceModule('legacy-access-preparation');
const { createRentalLegacyAccessAdoption } = sourceModule('legacy-access-adoption');
const { RentalMysqlAuthenticationRepository } = sourceModule('mysql-auth-source');
const { composeRentalPlatformHost } = sourceModule('platform-host');
const { createRentalManifest } = sourceModule('manifest');
const { coreBindingScopeKey, createCoreDeployedCatalogue } = load(aliases.get('@rental-os/core-host'));
const { createPlatformCoreAudit, composePlatformCoreManagement, composePlatformCoreBindings } = load(aliases.get('@rental-os/platform-core-host'));
const { runWithRequestIdentity } = load(aliases.get('@rental-os/platform-server/request-identity'));
const { readPublicSubscriptionTerm } = load(aliases.get('@rental-os/platform-server/subscription-reader'));
const copy = value => structuredClone(value), date = new Date('2026-01-02T00:00:00Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const source = { repository: 'https://github.com/example/offline-fixture', commit: 'a'.repeat(40) };
const manifest = createRentalManifest({ source, assets: ['dist/server.js', 'admin/index.tsx'] });
const lock = { lockVersion: 1, platform: { source, sha256: 'b'.repeat(64),
  versions: { platform: '0.1.0', contract: '0.1.1', node: '22.16.0', capabilities: {} },
  data: { version: '0.1.0', readable: { minInclusive: '0.1.0', maxExclusive: '0.2.0' }, migrations: [] } },
  cores: [{ manifest, sha256: 'c'.repeat(64) }] };

function fixture() {
  const makeUser = (id, tenantId, roleId, extra = {}) => ({ id, tenantId, roleId, isActive: true, isSaasAdmin: false,
    isPlatformAdmin: false, mustChangePassword: false, organizationId: tenantId === 'tenant' ? 'org' : null,
    tokenVersion: 1, updatedAt: date, roleAssignments: [], ...extra });
  const makeRole = (id, tenantId, codes, extra = {}) => ({ id, tenantId, name: id, isActive: true, fixedAllPermissions: false,
    scope: 'OPERATOR', dataScope: 'ALL', enabledBusinessScopes: ['rental-os'], buttonPermissions: [], updatedAt: date,
    permissions: codes.map(code => ({ permission: { id: code, code } })), ...extra });
  const state = {
    tenants: [{ id: 'tenant', status: 'ACTIVE', updatedAt: date }, { id: 'platform', status: 'ACTIVE', updatedAt: date }],
    users: [makeUser('admin', 'tenant', 'admin-role', { isPlatformAdmin: true }), makeUser('user', 'tenant', 'reader'),
      makeUser('saas', 'platform', 'saas-role', { isSaasAdmin: true })],
    roles: [makeRole('admin-role', 'tenant', ['system:user:manage', 'rental-os:order:view']),
      makeRole('reader', 'tenant', ['rental-os:order:view'], { scope: 'STORE', dataScope: 'ORGANIZATION' }),
      makeRole('saas-role', 'platform', ['system:tenant:manage'])],
    workspaces: [{ id: 'space', tenantId: 'tenant', status: 'ACTIVE', categoryCode: 'camera', categoryVersionId: 'old-category',
      categoryAdoptionRevision: 7, isDefault: true, runMode: 'production', updatedAt: date }],
    members: ['admin', 'user'].map(userId => ({ tenantId: 'tenant', workspaceId: 'space', userId,
      roleId: userId === 'admin' ? 'admin-role' : 'reader', isActive: true, dataScope: null,
      locationScope: { mode: 'selected', locationIds: ['location'] }, updatedAt: date })),
    organizations: [{ id: 'org', tenantId: 'tenant', parentId: null, status: 'enabled', type: 'STORE', updatedAt: date }],
    locations: [{ id: 'location', tenantId: 'tenant', workspaceId: 'space', organizationId: 'org', status: 'enabled', updatedAt: date }],
    subscription: { id: 'sub', tenantId: 'tenant', revision: 4, plan: 'PRO', source: 'PAID', startAt: date,
      endAt: new Date('2099-01-01'), updatedAt: date }, subscriptionSegments: [],
    sessions: ['admin', 'saas'].map(userId => ({ id: userId + '-session', userId, audience: 'operator',
      currentWorkspaceId: null, revokedAt: null, expiresAt: new Date('2099-01-01') })),
    grants: [], assignments: [], bindings: [], accessReceipts: [], bindingReceipts: [], logs: [],
    profile: { tenantId: 'tenant', categoryCode: 'camera' }, businessSettings: { tenantId: 'tenant' }
  };
  const trace = [], controls = {}; let sequence = 0, active;
  const matches = (row, where = {}) => Boolean(row) && Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' ? 'in' in value ? value.in.includes(row[key]) : 'gt' in value ? row[key] > value.gt : false : row[key] === value);
  const project = (row, select) => row ? select ? Object.fromEntries(Object.keys(select).map(key => [key, copy(row[key])])) : copy(row) : null;
  const database = { async $transaction(work, options) {
    assert(['RepeatableRead', 'ReadCommitted'].includes(options.isolationLevel));
    assert.equal(active, undefined, '禁止新外层/嵌套事务');
    const snapshot = copy(state), id = ++sequence, held = new Set(); let sourceLocked = false;
    const mark = (event, detail) => { assert.equal(active, id); trace.push({ id, event, detail }); };
    const rows = table => snapshot[table];
    const role = roleId => snapshot.roles.find(row => row.id === roleId) ?? null;
    const many = table => async query => {
      mark('read:' + table);
      let result = rows(table).filter(row => matches(row, query.where));
      if (query.orderBy) {
        const order = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
        result = result.slice().sort((a, b) => { for (const part of order) {
          const key = Object.keys(part)[0], difference = String(a[key]).localeCompare(String(b[key])); if (difference) return difference;
        } return 0; });
      }
      return result.map(row => project(row, query.select));
    };
    const tx = {
      tenant: { async findUnique({ where, select }) {
        mark('read:tenant'); const tenant = snapshot.tenants.find(row => row.id === where.id);
        if (!tenant) return null;
        return select.subscription ? { subscription: copy(snapshot.subscription), subscriptionSegments: copy(snapshot.subscriptionSegments) }
          : project(tenant, select);
      } },
      user: { findMany: many('users'), async findFirst({ where }) {
        mark('read:original-user'); const { tenant, ...filter } = where;
        const row = snapshot.users.find(user => matches(user, filter)
          && (!tenant || snapshot.tenants.some(item => item.id === user.tenantId && item.status === tenant.status)));
        if (!row) return null;
        return copy({ ...row, account: 'not-output', displayName: 'not-output', phone: null, needsTenantOnboarding: false,
          organization: snapshot.organizations.find(item => item.id === row.organizationId) ?? null, role: role(row.roleId),
          roleAssignments: row.roleAssignments.map(edge => ({ role: role(edge.roleId) })) });
      } },
      role: { findMany: many('roles') },
      businessWorkspace: { findMany: many('workspaces'), async findFirst({ where, select }) {
        mark('read:workspace'); return project(snapshot.workspaces.find(row => matches(row, where)), select);
      } },
      workspaceMember: { findMany: many('members'), async findFirst({ where }) {
        mark('read:workspace-member'); const { workspace, ...filter } = where;
        const row = snapshot.members.find(member => matches(member, filter)
          && snapshot.workspaces.some(item => item.id === member.workspaceId && item.status === workspace.status));
        return row ? copy({ ...row, role: role(row.roleId) }) : null;
      } },
      organizationUnit: { findMany: many('organizations') }, rentalFulfillmentLocation: { findMany: many('locations') },
      tenantSubscription: { async findUnique({ where, select }) { mark('read:subscription'); return matches(snapshot.subscription, where) ? project(snapshot.subscription, select) : null; } },
      tenantSubscriptionSegment: { findMany: many('subscriptionSegments') },
      authSession: { async findFirst({ where }) { mark('read:session'); return copy(snapshot.sessions.find(row => matches(row, where)) ?? null); } },
      operationLog: { async create({ data }) {
        mark('audit'); snapshot.logs.push(copy(data));
        if (controls.afterAudit) await controls.afterAudit(snapshot, tx);
        return data;
      } },
      async $queryRaw(strings, ...values) {
        if (!Array.isArray(strings)) { values = strings.values; strings = strings.strings; }
        assert(Array.isArray(strings)); const sql = strings.join('?').replace(/\s+/gu, ' ').trim();
        mark('sql', sql);
        if (controls.beforeQuery) await controls.beforeQuery(snapshot, tx, sql, values);
        if (/FROM Tenant /u.test(sql)) {
          const tenant = snapshot.tenants.find(row => row.id === values[0]);
          if (tenant) held.add('tenant:' + tenant.id);
          return tenant ? [{ id: tenant.id, status: tenant.status.toLowerCase() }] : [];
        }
        if (sql.includes('FROM `User`')) {
          if (sql.includes('NOWAIT')) {
            assert(held.has('tenant:' + values[0])); assert(held.has('core')); mark('source-lock');
            if (controls.userBusy) throw Error('ER_LOCK_NOWAIT');
            const selected = snapshot.users.filter(row => row.tenantId === values[0]).sort((a, b) => a.id.localeCompare(b.id));
            selected.forEach(row => held.add('user:' + row.id)); sourceLocked = true;
            return copy(selected.map(({ id, tenantId }) => ({ id, tenantId })));
          }
          assert(held.has('tenant:' + values[1]));
          const user = snapshot.users.find(row => row.id === values[0] && row.tenantId === values[1]);
          if (user) held.add('user:' + user.id);
          return user ? [copy(user)] : [];
        }
        if (sql.includes('FROM auth_sessions')) {
          assert(held.has('user:' + values[1])); return copy(snapshot.sessions.filter(row => row.id === values[0] && row.userId === values[1]));
        }
        if (sql.includes('FROM workspace_members')) {
          assert(held.has('tenant:' + values[0]) && held.has('user:' + values[2]));
          return copy(snapshot.members.filter(row => row.tenantId === values[0] && row.workspaceId === values[1] && row.userId === values[2]));
        }
        if (sql.includes('FROM `UserRole`')) return copy(snapshot.users.find(row => row.id === values[0])?.roleAssignments ?? []);
        if (sql.includes('FROM `Role`')) return copy(snapshot.roles.filter(row => row.id === values[0] && row.tenantId === values[1]));
        if (sql.includes('FROM `RolePermission`')) return (role(values[0])?.permissions ?? []).map(row => ({ permissionId: row.permission.id }));
        if (sql.includes('FROM `Permission`')) return [{ id: values[0] }];
        if (sql.includes('FROM platform_core_access_locks')) { assert(held.has('tenant:' + values[0])); held.add('core'); return [{ tenant_id: values[0] }]; }
        if (sql.includes('FROM platform_core_management_operations')) {
          mark('receipt:access'); return copy(snapshot.accessReceipts.filter(row => row.tenantId === values[0] && row.coreId === values[1] && row.operationId === values[2]));
        }
        if (sql.includes('FROM platform_core_binding_operations')) {
          mark('receipt:binding'); return copy(snapshot.bindingReceipts.filter(row => row.tenantId === values[0] && row.coreId === values[1] && row.scopeHash === values[2] && row.operationId === values[3]));
        }
        if (sql.includes('FROM platform_tenant_core_grants')) return copy(snapshot.grants.filter(row => row.tenantId === values[0]
          && (sql.includes("AND state = 'enabled' ORDER BY core_id") ? row.state === 'enabled' : row.coreId === values[1])));
        if (sql.includes('FROM platform_member_core_assignments')) return copy(snapshot.assignments.filter(row => row.tenantId === values[0]
          && (sql.includes('AND user_id = ? ORDER BY core_id') ? row.userId === values[1] : row.coreId === values[1]
          && (values.length < 3 || row.userId === values[2]))));
        if (sql.includes('FROM platform_core_bindings')) return copy(snapshot.bindings.filter(row => row.tenantId === values[0] && row.coreId === values[1]
          && (values.length < 3 || row.scopeHash === values[2])));
        throw Error('未知SQL: ' + sql);
      },
      async $executeRaw(strings, ...values) {
        assert.equal(options.isolationLevel, 'ReadCommitted');
        const sql = strings.join('?').replace(/\s+/gu, ' ').trim(); mark('execute', sql);
        if (sql.includes('INTO platform_core_access_locks')) { assert(held.has('tenant:' + values[0])); return 1; }
        assert(held.has('core'));
        if (!controls.generic) assert(sourceLocked, '新映射前必须在原事务锁定来源');
        const upsert = (table, row, key) => { const index = snapshot[table].findIndex(item => key(item));
          if (index < 0) snapshot[table].push(row); else snapshot[table][index] = row; };
        if (sql.includes('INTO platform_tenant_core_grants')) {
          const [tenantId, coreId, stateValue, revision, operationId] = values;
          upsert('grants', { tenantId, coreId, state: stateValue, revision, operationId }, row => row.tenantId === tenantId && row.coreId === coreId);
        } else if (sql.includes('INTO platform_member_core_assignments')) {
          const [tenantId, coreId, userId, stateValue, revision, operationId] = values;
          upsert('assignments', { tenantId, coreId, userId, state: stateValue, revision, operationId }, row => row.tenantId === tenantId && row.coreId === coreId && row.userId === userId);
        } else if (sql.includes('INTO platform_core_management_operations')) {
          const [tenantId, coreId, operationId, kind, actorTenantId, actorId, fingerprint, result] = values;
          snapshot.accessReceipts.push({ tenantId, coreId, operationId, kind, actorTenantId, actorId, fingerprint, result: JSON.parse(result) });
        } else if (sql.includes('INTO platform_core_binding_operations')) {
          const [tenantId, coreId, scopeHash, operationId, actorTenantId, actorId, fingerprint, operation, binding] = values;
          snapshot.bindingReceipts.push({ tenantId, coreId, scopeHash, operationId, actorTenantId, actorId, fingerprint, operation: JSON.parse(operation), binding: JSON.parse(binding) });
        } else if (sql.includes('INTO platform_core_bindings')) {
          const [tenantId, coreId, scopeHash, containerType, containerId, bindingId, revision, dataVersion] = values;
          snapshot.bindings.push({ tenantId, coreId, scopeHash, containerType, containerId, bindingId, revision, dataVersion });
        } else throw Error('未知写入: ' + sql);
        return 1;
      }
    };
    active = id; mark('transaction', options.isolationLevel);
    try {
      const result = await work(tx);
      if (options.isolationLevel === 'ReadCommitted') Object.assign(state, snapshot);
      mark('commit');
      if (controls.loseCommitReply && options.isolationLevel === 'ReadCommitted') { controls.loseCommitReply = false; throw Error('COMMIT_REPLY_UNKNOWN'); }
      return result;
    } catch (error) { mark('error', error.message); throw error; } finally { active = undefined; }
  } };
  const authentication = new RentalMysqlAuthenticationRepository({}), audit = createPlatformCoreAudit();
  const term = { async requireNewBusiness(tx, tenantId) {
    assert(active); trace.push({ id: active, event: 'term' });
    if (!(await readPublicSubscriptionTerm(tx, tenantId)).newBusinessAllowed) throw Error('原订阅已到期');
  } };
  let catalogue;
  const host = composeRentalPlatformHost({ database, users: authentication, term,
    deployment: { requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
      requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId) },
    configuration: { async loadWorkspaceSnapshot(tenantId, workspaceId, tx) {
      assert(active); assert.equal(tx.user !== undefined, true);
      trace.push({ id: active, event: 'configuration' });
      return { tenantId, workspaceId, profile: state.profile, businessSettings: state.businessSettings };
    } } });
  const observation = { platform: { version: lock.platform.data.version, appliedMigrations: [], execution: { state: 'ready' } },
    cores: [{ coreId: 'rental', version: manifest.data.version, execution: { state: 'ready' },
      appliedMigrations: manifest.data.migrations.map(({ id, sha256 }) => ({ id, sha256 })) }] };
  catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server: host.server }], observations: { async read() { return copy(observation); } } });
  const input = { database, authentication, audit, term, deployment: catalogue.availability,
    registrations: catalogue.registrations, authorizeContainer: host.authorizeContainer };
  const adoption = createRentalLegacyAccessAdoption(input), preparation = createRentalLegacyAccessPreparation({ database, authentication });
  const withActor = (id, work, overrides = {}) => runWithRequestIdentity({ tenantId: id === 'saas' ? 'platform' : 'tenant',
    userId: id, audience: 'operator', isSaasAdmin: id === 'saas',
    accessSession: { sessionId: id + '-session', expiresAt: 4070908800, workspaceId: null }, ...overrides }, work);
  const prepared = async () => {
    const current = await preparation.prepare('tenant');
    return { tenantId: current.tenantId, sourceFingerprint: current.sourceFingerprint, coreFingerprint: current.coreFingerprint };
  };
  const operation = async (operationId = 'explicit-original') => ({ confirmed: await prepared(), operationId, expectedRevision: 0 });
  const existingGrant = () => state.grants.push({ tenantId: 'tenant', coreId: 'rental', state: 'enabled', revision: 4, operationId: 'old-grant' });
  const existingAssignment = (userId = 'admin') => state.assignments.push({ tenantId: 'tenant', coreId: 'rental', userId, state: 'assigned', revision: 3, operationId: 'old-' + userId });
  return { state, controls, trace, database, input, adoption, preparation, withActor, operation, existingGrant, existingAssignment, observation };
}

const noMappings = f => { assert.equal(f.state.grants.length, 0); assert.equal(f.state.accessReceipts.length, 0); assert.equal(f.state.logs.length, 0); };

test('原Auth/Tenant/Core→完整来源锁→原事实/收据/审计，逐项管理应用且保留全部原范围', async () => {
  const f = fixture(), sourceBefore = await f.preparation.prepare('tenant');
  const grantOperation = await f.operation('grant-one');
  const grant = await f.withActor('saas', () => f.adoption.grantTenant(grantOperation));
  assert.deepEqual(grant, { tenantId: 'tenant', coreId: 'rental', state: 'enabled', revision: 1, operationId: 'grant-one' });
  for (const userId of ['admin', 'user']) {
    const command = await f.operation('assign-' + userId);
    const result = await f.withActor('admin', () => f.adoption.assignMember({ ...command, userId }));
    assert.equal(result.userId, userId); assert.equal(result.revision, 1);
  }
  const command = { ...await f.operation('bind-one'), workspaceId: 'space' };
  const binding = await f.withActor('admin', () => f.adoption.bindScope(command));
  assert.equal(binding.container.id, 'space'); assert.equal(binding.revision, 1);
  const after = await f.preparation.prepare('tenant');
  assert.equal(after.sourceFingerprint, sourceBefore.sourceFingerprint);
  assert.deepEqual(after.originalEvidence, sourceBefore.originalEvidence);
  assert.equal(f.state.logs.length, 4); assert.equal(f.state.accessReceipts.length, 3); assert.equal(f.state.bindingReceipts.length, 1);
  for (const tx of f.trace.filter(row => row.event === 'transaction' && row.detail === 'ReadCommitted')) {
    const entries = f.trace.filter(row => row.id === tx.id), receipt = entries.findIndex(row => row.event.startsWith('receipt:'));
    const sourceLock = entries.findIndex(row => row.event === 'source-lock'), audit = entries.findIndex(row => row.event === 'audit');
    assert(receipt > 0 && sourceLock > receipt && audit > sourceLock);
    assert(entries.slice(audit + 1).some(row => row.event === 'read:users'), '提交前原来源复验');
    assert.equal(entries.at(-1).event, 'commit');
  }
});

test('准备后角色/空间/数据范围/订阅/其他成员改密漂移均拒绝，不以两次快照替代User锁', async () => {
  for (const drift of [s => { s.roles[1].permissions = []; }, s => { s.members[1].isActive = false; },
    s => { s.members[1].locationScope.locationIds = []; }, s => { s.workspaces[0].categoryAdoptionRevision++; },
    s => { s.subscription.revision++; }, s => { s.users[1].tokenVersion++; }, s => { s.users[1].mustChangePassword = true; }]) {
    const f = fixture(), command = await f.operation(); drift(f.state);
    await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), { code: 'source_changed' }); noMappings(f);
  }
  const f = fixture(), command = await f.operation(); f.controls.userBusy = true;
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), /ER_LOCK_NOWAIT/u); noMappings(f);
  assert.equal(f.trace.filter(row => row.event === 'source-lock').length, 1, '锁冲突不自动重试');
});

test('同ID跨租户、缺来源和当前旧修订拒绝，原disabled/revoked不会复活', async () => {
  const f = fixture(), command = await f.operation(); f.state.users[1].tenantId = 'other-tenant';
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), { code: 'inconsistent_source' }); noMappings(f);
  const missing = fixture(), missingCommand = await missing.operation(); missing.state.roles.splice(1, 1);
  await assert.rejects(missing.withActor('saas', () => missing.adoption.grantTenant(missingCommand)), /同租户角色/u); noMappings(missing);
  const revision = fixture(), revisionCommand = await revision.operation(); revision.existingGrant();
  await assert.rejects(revision.withActor('saas', () => revision.adoption.grantTenant(revisionCommand)), { code: 'source_changed' });
  assert.equal(revision.state.grants[0].revision, 4); assert.equal(revision.state.accessReceipts.length, 0);
  const disabled = fixture(); disabled.existingGrant(); disabled.state.grants[0].state = 'disabled';
  const disabledCommand = { ...await disabled.operation(), expectedRevision: 4 };
  await assert.rejects(disabled.withActor('saas', () => disabled.adoption.grantTenant(disabledCommand)), { code: 'mapping_not_prepared' });
  assert.equal(disabled.state.grants[0].state, 'disabled'); assert.equal(disabled.state.logs.length, 0);
  const revoked = fixture(); revoked.existingGrant(); revoked.existingAssignment('user'); revoked.state.assignments[0].state = 'revoked';
  const revokeCommand = { ...await revoked.operation(), expectedRevision: 3, userId: 'user' };
  await assert.rejects(revoked.withActor('admin', () => revoked.adoption.assignMember(revokeCommand)), { code: 'mapping_not_prepared' });
  assert.equal(revoked.state.assignments[0].state, 'revoked'); assert.equal(revoked.state.logs.length, 0);
  const foreign = fixture(); foreign.existingGrant(); const foreignCommand = { ...await foreign.operation(), userId: 'user' };
  foreign.state.users[1].tenantId = 'platform';
  await assert.rejects(foreign.withActor('admin', () => foreign.adoption.assignMember(foreignCommand)), /目标成员不存在/u);
  assert.equal(foreign.state.assignments.length, 0); assert.equal(foreign.state.accessReceipts.length, 0);
});

test('提交前来源/身份变化与审计失败，原事实、收据、审计一起回滚', async () => {
  for (const change of [s => { s.users[1].tokenVersion++; }, s => { s.roles[1].isActive = false; },
    s => { s.sessions.find(row => row.userId === 'saas').revokedAt = new Date(); }, () => { throw Error('AUDIT_UNAVAILABLE'); }]) {
    const f = fixture(), command = await f.operation(); f.controls.afterAudit = change;
    await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), /来源|会话|AUDIT_UNAVAILABLE/u);
    noMappings(f); assert(f.trace.some(row => row.event === 'audit'));
  }
});

test('已提交应答unknown保留原收据；来源后变只重读原结果，不再次写入或初始化', async () => {
  const f = fixture(), command = await f.operation(); f.controls.loseCommitReply = true;
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), /COMMIT_REPLY_UNKNOWN/u);
  assert.equal(f.state.grants.length, 1); assert.equal(f.state.accessReceipts.length, 1);
  f.state.members[1].isActive = false; f.state.users[1].tokenVersion++;
  const index = f.trace.length, result = await f.withActor('saas', () => f.adoption.grantTenant(command));
  assert.equal(result.operationId, command.operationId); assert.equal(f.state.logs.length, 1);
  assert(!f.trace.slice(index).some(row => row.event === 'source-lock' || row.event === 'audit'));
  f.state.grants[0].state = 'disabled';
  const original = await f.withActor('saas', () => f.adoption.readTenantGrantOperation({ tenantId: 'tenant', operationId: command.operationId }));
  assert.equal(original.status, 'recorded'); assert.equal(original.grant.state, 'enabled'); assert.equal(f.state.grants[0].state, 'disabled');
  assert.deepEqual(await f.withActor('saas', () => f.adoption.readTenantGrantOperation({ tenantId: 'tenant', operationId: 'never-recorded' })), { status: 'unavailable' });
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant({ ...command, expectedRevision: 1 })), { code: 'operation_conflict' });
  assert.equal(f.state.logs.length, 1);
  const member = fixture(); member.existingGrant(); const assign = { ...await member.operation('member-original'), userId: 'user' };
  const assigned = await member.withActor('admin', () => member.adoption.assignMember(assign));
  member.state.users[1].isActive = false; member.state.assignments[0].state = 'revoked';
  const memberIndex = member.trace.length;
  const memberReceipt = await member.withActor('admin', () => member.adoption.readMemberAssignmentOperation({ userId: 'user', operationId: assign.operationId }));
  assert.deepEqual(memberReceipt, { status: 'recorded', assignment: assigned });
  assert.equal(member.state.assignments[0].state, 'revoked'); assert.equal(member.state.logs.length, 1);
  assert(!member.trace.slice(memberIndex).some(row => row.event === 'source-lock' || row.event === 'audit'));
});

test('绑定原结果与现有绑定复用均不init；缺绑定遇新初始化器拒绝且原期限/空间权限仍生效', async () => {
  const f = fixture(); f.existingGrant(); f.existingAssignment();
  const command = { ...await f.operation('bind-unknown'), workspaceId: 'space' };
  f.controls.loseCommitReply = true;
  await assert.rejects(f.withActor('admin', () => f.adoption.bindScope(command)), /COMMIT_REPLY_UNKNOWN/u);
  const originalBinding = copy(f.state.bindings[0]);
  f.state.users[1].tokenVersion++;
  const replay = await f.withActor('admin', () => f.adoption.bindScope(command));
  assert.equal(replay.bindingId, originalBinding.bindingId); assert.equal(f.state.bindings.length, 1); assert.equal(f.state.logs.length, 1);
  let initialized = 0;
  const registration = f.input.registrations.get('rental');
  const guarded = createRentalLegacyAccessAdoption({ ...f.input, registrations: new Map([['rental', { ...registration,
    server: { ...registration.server, initialization: { async initialize() { initialized++; throw Error('不应初始化'); } } } }]]) });
  const reuse = { ...await f.operation('reuse-existing'), workspaceId: 'space', expectedRevision: 1 };
  assert.equal((await f.withActor('admin', () => guarded.bindScope(reuse))).bindingId, replay.bindingId);
  assert.equal(initialized, 0); assert.equal(f.state.bindings.length, 1); assert.equal(f.state.bindingReceipts.length, 2);
  f.state.bindings = []; const fresh = { ...await f.operation('missing-binding'), workspaceId: 'space' };
  await assert.rejects(f.withActor('admin', () => guarded.bindScope(fresh)), { code: 'source_unavailable' }); assert.equal(initialized, 0);
  f.state.subscription.endAt = date;
  await assert.rejects(f.withActor('admin', () => f.adoption.bindScope(fresh)), /订阅已到期/u);
  f.state.subscription.endAt = new Date('2099-01-01'); f.state.members[0].isActive = false;
  await assert.rejects(f.withActor('admin', () => f.adoption.bindScope(fresh)), /成员关系/u);
  const read = await f.withActor('admin', () => f.adoption.readBindingOperation({ workspaceId: 'space', operationId: command.operationId }));
  assert.equal(read.status, 'recorded'); assert.equal(read.binding.bindingId, replay.bindingId);
});

test('prepared/JSON不授予身份，原管理会话/主体/租户/权限和部署当前检查均保留', async () => {
  const f = fixture(), command = await f.operation();
  await assert.rejects(Promise.resolve().then(() => f.adoption.grantTenant(command)), /会话身份/u);
  await assert.rejects(f.withActor('admin', () => f.adoption.grantTenant({ ...command, actor: { subjectId: 'saas', tenantId: 'platform', audience: 'operator' } })), /管理权限/u);
  for (const overrides of [{ audience: 'client' }, { audience: 'staff' }, { tenantId: 'platform' },
    { accessSession: { sessionId: 'admin-session', expiresAt: 1, workspaceId: null } }]) {
    await assert.rejects(Promise.resolve().then(() => f.withActor('admin', () => f.adoption.assignMember({ ...command, userId: 'user' }), overrides)));
  }
  f.state.sessions.find(row => row.userId === 'saas').revokedAt = date;
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), /会话/u);
  f.state.sessions.find(row => row.userId === 'saas').revokedAt = null;
  f.observation.cores[0].appliedMigrations = [];
  await assert.rejects(f.withActor('saas', () => f.adoption.grantTenant(command)), /迁移执行状态/u);
  noMappings(f);
});

test('泛Core未装来源hook保留原行为；已配置hook缺租约必须在写前拒绝', async () => {
  const f = fixture(); f.controls.generic = true; f.controls.userBusy = true;
  const args = { database: f.database, users: f.input.authentication, audit: f.input.audit, deployment: f.input.deployment };
  const generic = composePlatformCoreManagement(args);
  const result = await f.withActor('saas', () => generic.service.changeTenantGrant(generic.principals.current(),
    { tenantId: 'tenant', coreId: 'rental', state: 'enabled', expectedRevision: 0, operationId: 'generic-grant' }));
  assert.equal(result.revision, 1); assert(!f.trace.some(row => row.event === 'source-lock'));
  const broken = composePlatformCoreManagement({ ...args, async mutationPrecondition() {} });
  await assert.rejects(f.withActor('saas', () => broken.service.changeTenantGrant(broken.principals.current(),
    { tenantId: 'tenant', coreId: 'rental', state: 'disabled', expectedRevision: 1, operationId: 'broken-hook' })), /有效同事务租约/u);
  assert.equal(f.state.grants[0].state, 'enabled'); assert.equal(f.state.logs.length, 1);
  f.existingAssignment();
  const genericBindings = composePlatformCoreBindings({ ...args, term: f.input.term, registrations: f.input.registrations,
    authorizeContainer: f.input.authorizeContainer });
  const binding = await f.withActor('admin', () => genericBindings.service.bind(genericBindings.principals.current(),
    { coreId: 'rental', expectedRevision: 0, operationId: 'generic-bind', container: { type: 'rental-workspace', id: 'space' } }));
  assert.equal(binding.container.id, 'space'); assert.equal(f.state.logs.length, 2);
});

require('./core-session-cases.cjs')({ test, fixture, sourceModule,
  loadPackage: name => load(aliases.get(name)), lock, source });
