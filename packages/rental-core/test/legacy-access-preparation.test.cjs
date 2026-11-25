'use strict';
/** 实际原身份/空间仓储、权限映射与只读准备器。只替换持久化行委托；不生成 Client，
 * 不连接数据库，不写 dist。正式 exports → 原源码仅在内存加载。
 * node packages/rental-core/test/legacy-access-preparation.test.cjs --deps <只读 node_modules>
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
const { createRentalLegacyAccessPreparation } = load(path.join(root, 'packages/rental-core/src/legacy-access-preparation.ts'));
const { RentalMysqlAuthenticationRepository } = load(path.join(root, 'packages/rental-core/src/mysql-auth-source.ts'));
const { coreBindingScopeKey } = load(aliases.get('@rental-os/core-host'));
const { CORE_MANAGEMENT_HTTP } = load(aliases.get('@rental-os/core-contracts'));
const copy = value => structuredClone(value), date = new Date('2026-01-02T00:00:00Z');

function fixture() {
  const state = {
    tenant: { id: 'tenant', status: 'ACTIVE', updatedAt: date },
    users: [{ id: 'user', tenantId: 'tenant', isActive: true, isSaasAdmin: false, isPlatformAdmin: false,
      mustChangePassword: false, roleId: 'reader', organizationId: 'org', tokenVersion: 1, updatedAt: date, roleAssignments: [] }],
    roles: [{ id: 'reader', tenantId: 'tenant', name: 'restricted', isActive: true, fixedAllPermissions: false,
      scope: 'STORE', dataScope: 'ORGANIZATION', enabledBusinessScopes: ['rental-os'], buttonPermissions: [], updatedAt: date,
      permissions: [{ permission: { id: 'order-view', code: 'rental-os:order:view' } }] }],
    workspaces: [{ id: 'space', tenantId: 'tenant', status: 'ACTIVE', categoryCode: 'camera', categoryVersionId: 'category-old',
      categoryAdoptionRevision: 7, isDefault: true, runMode: 'production', updatedAt: date }],
    members: [{ tenantId: 'tenant', workspaceId: 'space', userId: 'user', roleId: 'reader', isActive: true,
      dataScope: null, locationScope: { mode: 'selected', locationIds: ['loc-allowed', 'loc-foreign-org'] }, updatedAt: date }],
    organizations: [{ id: 'org', tenantId: 'tenant', parentId: null, status: 'enabled', type: 'STORE', updatedAt: date },
      { id: 'other-org', tenantId: 'tenant', parentId: null, status: 'enabled', type: 'STORE', updatedAt: date }],
    locations: [{ id: 'loc-allowed', tenantId: 'tenant', workspaceId: 'space', organizationId: 'org', status: 'enabled', updatedAt: date },
      { id: 'loc-foreign-org', tenantId: 'tenant', workspaceId: 'space', organizationId: 'other-org', status: 'enabled', updatedAt: date }],
    subscription: { id: 'sub', tenantId: 'tenant', revision: 4, plan: 'PRO', source: 'PAID', startAt: date,
      endAt: new Date('2026-02-01T00:00:00Z'), updatedAt: date }, subscriptionSegments: [],
    grants: [], assignments: [], bindings: []
  };
  const reads = []; let sequence = 0, activeTransaction;
  const matches = (row, where = {}) => row && Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value);
  const project = (row, select) => select ? Object.fromEntries(Object.entries(select).map(([key]) => [key, copy(row[key])])) : copy(row);
  const database = { async $transaction(read, options) {
    assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
    const snapshot = copy(state), transactionId = ++sequence;
    const noWrite = () => { throw Error('准备器不得写入原事实/收据/锁表'); };
    const role = id => snapshot.roles.find(row => row.id === id) ?? null;
    const many = (table, rows) => async query => {
      assert.equal(activeTransaction, transactionId); reads.push({ transactionId, table, query: copy(query) });
      let result = rows.filter(row => matches(row, query.where));
      if (query.orderBy) {
        const order = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
        result = result.slice().sort((left, right) => {
          for (const item of order) { const key = Object.keys(item)[0], difference = String(left[key]).localeCompare(String(right[key])); if (difference) return difference; }
          return 0;
        });
      }
      return result.map(row => project(row, query.select));
    };
    const tx = {
      tenant: { findUnique: async ({ where, select }) => matches(snapshot.tenant, where) ? project(snapshot.tenant, select) : null },
      user: { findMany: many('users', snapshot.users), async findFirst({ where }) {
        reads.push({ transactionId, table: 'original-user' });
        const { tenant, ...filter } = where;
        const row = snapshot.users.find(user => matches(user, filter) && (!tenant || snapshot.tenant.status === tenant.status));
        if (!row) return null;
        return copy({ ...row, account: 'private-account-not-output', displayName: 'private-name-not-output', phone: 'private-phone-not-output',
          passwordHash: 'private-hash-not-output', needsTenantOnboarding: false, organization: snapshot.organizations.find(org => org.id === row.organizationId) ?? null,
          role: role(row.roleId), roleAssignments: row.roleAssignments.map(edge => ({ role: role(edge.roleId) })) });
      }, update: noWrite },
      role: { findMany: many('roles', snapshot.roles) },
      businessWorkspace: { findMany: many('workspaces', snapshot.workspaces) },
      workspaceMember: { findMany: many('members', snapshot.members), async findFirst({ where }) {
        reads.push({ transactionId, table: 'original-workspace' });
        const { workspace, ...filter } = where;
        const row = snapshot.members.find(member => matches(member, filter)
          && snapshot.workspaces.some(space => space.id === member.workspaceId && space.status === workspace.status));
        return row ? copy({ ...row, role: role(row.roleId) }) : null;
      } },
      organizationUnit: { findMany: many('organizations', snapshot.organizations) },
      rentalFulfillmentLocation: { findMany: many('locations', snapshot.locations) },
      tenantSubscription: { findUnique: async ({ where, select }) => matches(snapshot.subscription, where) ? project(snapshot.subscription, select) : null },
      tenantSubscriptionSegment: { findMany: many('subscriptionSegments', snapshot.subscriptionSegments) },
      async $queryRaw(strings, ...values) {
        assert(Array.isArray(strings)); const sql = strings.join('?').replace(/\s+/gu, ' ').trim();
        assert.match(sql, /^SELECT /u); assert.doesNotMatch(sql, /FOR UPDATE|LOCK IN|INSERT|UPDATE|DELETE/iu);
        assert.deepEqual(values, ['tenant', 'rental']); reads.push({ transactionId, sql });
        if (sql.includes('FROM platform_tenant_core_grants')) return copy(snapshot.grants);
        if (sql.includes('FROM platform_member_core_assignments')) return copy(snapshot.assignments);
        if (sql.includes('FROM platform_core_bindings')) return copy(snapshot.bindings);
        throw Error('未知 SQL');
      }, $executeRaw: noWrite
    };
    activeTransaction = transactionId;
    try { return await read(tx); } finally { activeTransaction = undefined; }
  } };
  // 原仓储只能消费显式事务；漏传会触发缺委托而失败，不能读到 root 或另一快照。
  const authentication = new RentalMysqlAuthenticationRepository({});
  const preparation = createRentalLegacyAccessPreparation({ database, authentication });
  const grant = (stateValue = 'enabled', revision = 3) => ({ tenantId: 'tenant', coreId: 'rental', state: stateValue, revision, operationId: 'grant-original' });
  const assignment = (stateValue = 'assigned', revision = 8) => ({ tenantId: 'tenant', coreId: 'rental', userId: 'user', state: stateValue, revision, operationId: 'assignment-original' });
  const binding = (workspaceId = 'space') => {
    const scope = { tenantId: 'tenant', coreId: 'rental', ...(workspaceId ? { container: { type: 'rental-workspace', id: workspaceId } } : {}) };
    return { tenantId: 'tenant', coreId: 'rental', scopeHash: createHash('sha256').update(coreBindingScopeKey(scope)).digest('hex'),
      bindingId: 'original-binding', revision: 5, dataVersion: '0.1.0', containerType: workspaceId ? 'rental-workspace' : null, containerId: workspaceId ?? null };
  };
  return { state, reads, preparation, grant, assignment, binding };
}

test('存量准备仅生成 Rental 缺失映射，保留真实组织/空间范围、品类采纳与正式操作入口', async () => {
  const f = fixture(), before = copy(f.state), prepared = await f.preparation.prepare('tenant');
  assert.equal(prepared.status, 'prepared'); assert.deepEqual(f.state, before);
  assert.equal(prepared.grant.difference, 'propose_missing');
  assert.deepEqual(prepared.members[0].proposal, { coreId: 'rental', userId: 'user', state: 'assigned', expectedRevision: 0 });
  assert.equal(prepared.members[0].original.scope, 'store');
  assert.equal(prepared.members[0].original.dataScope, 'organization');
  const workspace = prepared.members[0].workspaces[0];
  assert.deepEqual(workspace.businessLocationScope, { mode: 'selected', locationIds: ['loc-allowed'] });
  assert.deepEqual(workspace.original.locationScope.locationIds, ['loc-allowed', 'loc-foreign-org']);
  assert.deepEqual(workspace.operatorDirectoryCodes, ['rental:order:view', 'rental:page.workbench:view', 'rental:setup:view']);
  assert.equal(prepared.originalEvidence.workspaces[0].categoryVersionId, 'category-old');
  assert.equal(prepared.originalEvidence.workspaces[0].categoryAdoptionRevision, 7);
  assert.equal(prepared.bindings.find(row => !row.scope.container).proposal, null);
  const proposal = prepared.bindings.find(row => row.scope.container).proposal;
  assert.deepEqual(proposal, { coreId: 'rental', container: { type: 'rental-workspace', id: 'space' }, expectedRevision: 0 });
  assert.equal(prepared.grant.management.path, '/platform/core-host/' + CORE_MANAGEMENT_HTTP.tenantGrant.path);
  assert.equal(prepared.members[0].management.path, '/platform/core-host/' + CORE_MANAGEMENT_HTTP.memberAssignment.path);
  assert.equal(prepared.bindings[1].management.path, '/platform/core-host/' + CORE_MANAGEMENT_HTTP.bind.path);
  assert.equal(CORE_MANAGEMENT_HTTP.tenantGrant.request.safeParse(prepared.grant.proposal).success, false, '缺原操作键的建议不可执行');
  assert.deepEqual(prepared.comparison.rows.find(row => row.scope.container).conditionalPreparedMappingCodes, workspace.operatorDirectoryCodes);
  assert.equal(prepared.execution.supported, false); assert.equal(prepared.execution.runtimeAuthority, false);
  assert.doesNotMatch(JSON.stringify(prepared), /private-|passwordHash|refreshToken|temporaryPassword/u);
  assert.deepEqual(await f.preparation.prepare('tenant'), prepared, '相同原事实无需第二次初始化');
  assert.equal((await f.preparation.compare(JSON.parse(JSON.stringify(prepared)))).status, 'unchanged');
  assert.deepEqual(Object.keys(f.preparation).sort(), ['compare', 'prepare']);
});

test('同租户原通配只投影已登记 Rental；不把租户通配展开到停用空间角色或其他 Core', async () => {
  const f = fixture(); f.state.users[0].isPlatformAdmin = true; f.state.roles[0].isActive = false;
  const prepared = await f.preparation.prepare('tenant');
  assert(prepared.members[0].tenantDirectoryCodes.length > 0);
  assert.deepEqual(prepared.members[0].workspaces[0].operatorDirectoryCodes, []);
  assert.deepEqual(prepared.members[0].workspaces[0].original.permissions, []);
  assert.equal(prepared.bindings.find(row => row.scope.container).proposal, null);
  assert(prepared.members[0].tenantDirectoryCodes.every(code => code.startsWith('rental:') && !code.includes('*')));
  assert(prepared.grant.proposal.coreId === 'rental');
});

test('已有 disabled/revoked 逐条保留，已有绑定与修订不重复初始化', async () => {
  for (const [grantState, memberState] of [['disabled', 'assigned'], ['enabled', 'revoked'], ['enabled', 'assigned']]) {
    const f = fixture(); f.state.grants = [f.grant(grantState)]; f.state.assignments = [f.assignment(memberState)]; f.state.bindings = [f.binding()];
    const prepared = await f.preparation.prepare('tenant');
    assert.equal(prepared.grant.proposal, null); assert.equal(prepared.members[0].proposal, null);
    assert.equal(prepared.grant.expectedRevision, 3); assert.equal(prepared.members[0].expectedRevision, 8);
    assert.equal(prepared.bindings[1].expectedRevision, 5); assert.equal(prepared.bindings[1].proposal, null);
    assert.equal(prepared.bindings[1].current.bindingId, 'original-binding');
    if (grantState === 'disabled') assert.equal(prepared.grant.difference, 'preserve_revocation');
    if (memberState === 'revoked') assert.equal(prepared.members[0].difference, 'preserve_revocation');
    const comparison = prepared.comparison.rows.find(row => row.scope.container);
    assert.equal(comparison.difference, grantState === 'enabled' && memberState === 'assigned' ? 'unchanged' : 'restricted_preserved');
  }
  const f = fixture(); f.state.grants = [f.grant('disabled')];
  assert.equal((await f.preparation.prepare('tenant')).members[0].proposal, null);
});

test('账号/租户/空间/成员停用与改密不自动授予，也不把已有映射改为撤销', async () => {
  const changes = [f => f.state.tenant.status = 'FROZEN', f => f.state.users[0].isActive = false,
    f => f.state.users[0].mustChangePassword = true, f => f.state.users[0].isSaasAdmin = true,
    f => f.state.workspaces[0].status = 'DISABLED', f => f.state.members[0].isActive = false, f => f.state.roles[0].isActive = false];
  for (const change of changes) {
    const f = fixture(); change(f);
    const missing = await f.preparation.prepare('tenant');
    assert.equal(missing.members[0].proposal, null); assert.equal(missing.grant.proposal, null);
    f.state.grants = [f.grant()]; f.state.assignments = [f.assignment()];
    const existing = await f.preparation.prepare('tenant');
    assert.equal(existing.members[0].current.state, 'assigned'); assert.equal(existing.members[0].difference, 'preserve_existing');
    assert.equal(existing.grant.current.state, 'enabled');
  }
  const f = fixture(); f.state.subscription.endAt = new Date('2000-01-01T00:00:00Z');
  assert((await f.preparation.prepare('tenant')).members[0].proposal, '到期不由准备器改写原历史授权规则');
});

test('固定事实或当前修订变化会 stale；纯比较不执行新授权', async () => {
  for (const change of [f => f.state.roles[0].permissions = [], f => f.state.members[0].dataScope = 'OWN',
    f => f.state.workspaces[0].categoryAdoptionRevision++, f => f.state.subscription.revision++,
    f => f.state.locations[0].organizationId = 'other-org']) {
    const f = fixture(), previous = await f.preparation.prepare('tenant'); change(f);
    const before = copy(f.state), result = await f.preparation.compare(previous);
    assert.equal(result.status, 'stale'); assert(result.changed.includes('original_facts')); assert.deepEqual(f.state, before);
  }
  const f = fixture(); f.state.grants = [f.grant()]; f.state.assignments = [f.assignment()]; f.state.bindings = [f.binding()];
  const previous = await f.preparation.prepare('tenant');
  f.state.assignments[0] = f.assignment('revoked', 9);
  const result = await f.preparation.compare(previous);
  assert.equal(result.status, 'stale'); assert.deepEqual(result.changed, ['core_records']);
  assert.equal(result.current.members[0].current.revision, 9); assert.equal(result.current.members[0].proposal, null);
  assert.equal(result.runtimeAuthority, false);
});

test('同 ID 跨租户、缺失来源和损坏 Core 记录不生成候选，JSON 权限不能替代原事实', async () => {
  const changes = [f => f.state.grants = [{ ...f.grant(), tenantId: 'other' }],
    f => f.state.assignments = [{ ...f.assignment(), tenantId: 'other' }],
    f => f.state.bindings = [{ ...f.binding(), scopeHash: '0'.repeat(64) }],
    f => f.state.grants = [{ ...f.grant(), revision: 0 }],
    f => f.state.roles[0].tenantId = 'other', f => f.state.users[0].roleId = 'missing-role',
    f => f.state.roles[0].buttonPermissions = '*',
    f => f.state.users[0].organizationId = 'missing-org', f => f.state.workspaces[0].categoryAdoptionRevision = undefined];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.preparation.prepare('tenant')); }
  const f = fixture(); await assert.rejects(f.preparation.prepare('not-found'), /原租户不存在/u);
  await assert.rejects(f.preparation.prepare({ tenantId: 'tenant', permissions: ['*'] }), /原租户标识/u);
  await assert.rejects(f.preparation.compare({ tenantId: 'tenant', sourceFingerprint: 'bad', coreFingerprint: 'bad' }), /指纹/u);
  f.state.roles[0].permissions = [{ permission: { id: 'fake', code: 'rental:order:create' } }];
  assert.equal((await f.preparation.prepare('tenant')).members[0].proposal, null, '标准码 JSON 不是原角色权限');
});
