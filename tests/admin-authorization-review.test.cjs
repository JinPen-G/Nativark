const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, preferTsExts: true, compilerOptions: {
  target: 'ES2022', module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { PlatformRepository } = require('../apps/api/src/modules/platform/platform.repository');
const { OriginalPublicManagementAdapter } = require('../apps/api/src/modules/platform/public-management.adapter');
const { fixture: publicManagementFixture } = require('./fixtures/platform-management.cjs');
const { getRequestIdentity } = require('@rental-os/platform-server/request-identity');
const { rentalPublicManagementCompatibility } = require('@rental-os/rental-core/public-management-compatibility');
const { PlatformService } = require('../apps/api/src/modules/platform/platform.service');
const { PlatformController } = require('../apps/api/src/modules/platform/platform.controller');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { Prisma } = require('@prisma/client');

test('platform parameter navigation follows explicit server grants without giving other tenant capabilities', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const source = ts.createSourceFile('browser-auth-store.ts', fs.readFileSync(path.join(__dirname, '../packages/rental-core/admin/browser-auth-store.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  let body;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'hasPermission') body = node.body.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(body);
  const check = new Function('get', 'permission', body.slice(1, -1));
  for (const permissions of [[], ['system:params:manage'], ['*']]) {
    const user = { ...actor(permissions), isSaasAdmin: true };
    assert.equal(check(() => ({ user }), 'system:params:manage'), permissions.length > 0);
    assert.equal(check(() => ({ user }), 'system:user:manage'), false);
    if (permissions.length) assert.equal(await guardCall(user, 'GET', '/platform/security-baseline'), true);
    else await assert.rejects(guardCall(user, 'GET', '/platform/security-baseline'), forbidden);
  }
});

test('SaaS parameter access permits the baseline but never opens tenant utilities or the legacy AI test', async () => {
  for (const permissions of [['system:params:manage'], ['*']]) {
    const user = { ...actor(permissions), isSaasAdmin: true };
    assert.equal(await guardCall(user, 'GET', '/platform/security-baseline'), true);
    for (const [method, path] of [
      ['GET', '/platform/system-rules'], ['PUT', '/platform/system-rules/memberRegister'],
      ['POST', '/platform/system-rules/ai-test'], ['POST', '/platform/security-baseline/second-confirmation/check'],
      ['GET', '/platform/users'], ['GET', '/platform/dictionaries'], ['GET', '/platform/number-rules'],
      ['GET', '/platform/filter-presets'], ['GET', '/integrations/dashboard'], ['GET', '/files'],
      ['GET', '/notifications/logs'], ['POST', '/jobs/run-due'],
    ]) await assert.rejects(guardCall(user, method, path), forbidden, `${method} ${path}`);
  }
});

test('the route view observes permission and capability changes without changing account or workspace', () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const declaration = (file, name) => {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
    const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, name);
    return ts.transpileModule(node.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  };
  const access = {};
  new Function('exports', 'APP_ROUTES', declaration('apps/admin/src/app/navigation.tsx', 'canAccessRoute'))(access, { aiOperator: { path: '/ai-operator' }, platformCorePackages: { path: '/platform/core-packages' } });
  const source = declaration('apps/admin/src/app/AppRouter.tsx', 'RouteAccess');
  const cases = [
    { route: { path: '/platform/system', audience: 'saas', permission: 'system:params:manage' }, saas: true, change: 'permission' },
    { route: { path: '/rental/items', audience: 'tenant', permission: 'rental-core:catalog:view' }, change: 'permission' },
    { route: { path: '/rental/items', audience: 'tenant', permission: 'rental-core:catalog:view', capability: 'catalog' }, change: 'capability' },
    { route: { path: '/rental/members', audience: 'tenant', permission: 'rental-os:member:manage', scope: 'tenant-membership' }, change: 'membership' },
  ];
  for (const scenario of cases) {
    let state = { user: { id: 'same-user', isSaasAdmin: Boolean(scenario.saas), permissions: [scenario.route.permission],
      tenantMembership: { permissions: [scenario.route.permission] } }, tenant: { categoryCode: 'camera', capabilities: ['catalog'] } };
    const methods = {
      hasPermission: permission => !permission || state.user.permissions.includes(permission),
      hasCapability: capability => !capability || state.tenant.capabilities.includes(capability),
      hasTenantMembershipPermission: permission => !permission || state.user.tenantMembership.permissions.includes(permission),
    };
    let observed = [];
    const render = new Function('exports', 'require', 'useAuthStore', 'useLocale', 'useNavigate', 'canAccessRoute', 'Result', 'Button', `${source};return RouteAccess;`)(
      {}, require, selector => { const value = selector({ ...state, ...methods }); observed.push({ selector, value }); return value; },
      () => ({ t: text => text }), () => () => {}, access.canAccessRoute, 'access-result', 'return-button');
    assert.equal(render({ route: scenario.route, children: 'protected-content' }).props.children, 'protected-content');
    const initial = state;
    if (scenario.change === 'capability') state = { ...state, tenant: { ...state.tenant, capabilities: [] } };
    else if (scenario.change === 'membership') state = { ...state, user: { ...state.user, tenantMembership: { permissions: [] } } };
    else state = { ...state, user: { ...state.user, permissions: [] } };
    assert.ok(observed.some(({ selector, value }) => !Object.is(selector({ ...state, ...methods }), value)), `${scenario.change}: the real store subscriptions must notify the route after revocation`);
    observed = [];
    assert.equal(render({ route: scenario.route, children: 'protected-content' }).type, 'access-result');
    state = initial;
    assert.ok(observed.some(({ selector, value }) => !Object.is(selector({ ...state, ...methods }), value)), `${scenario.change}: restored permission must also notify the route`);
    assert.equal(render({ route: scenario.route, children: 'protected-content' }).props.children, 'protected-content');
  }
});

const tenantId = 'tenant-a';
const actor = (permissions = ['system:user:manage']) => ({
  id: 'actor', tenantId, account: 'actor', displayName: 'Operator', isActive: true,
  isSaasAdmin: false, isPlatformAdmin: false, dataScope: 'all', permissions,
  locationScope: { mode: 'all', locationIds: [] }, mustChangePassword: false
});
const forbidden = error => error?.status === 403;
const invalid = error => error?.status === 400;

async function guardCall(user, method, path) {
  const guard = new ApiAuthGuard({ resolveAccessContext: async () => ({
    user, tenantUser: user, workspaceId: undefined, workspaceValid: true
  }) });
  const request = { method, url: `/api${path}`, headers: { authorization: 'Bearer test' }, body: {} };
  return guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
}

function fixture() {
  const current = publicManagementFixture();
  return { ...current, management: new OriginalPublicManagementAdapter(current.service),
    workspaceRepository: new PlatformRepository(current.database) };
}

test('SaaS workspace management reads the tenant through public management before Core delegation', async () => {
  const current = fixture();
  const tenant = {
    id: tenantId, code: 'TENANT_A', name: 'Tenant A', status: 'ACTIVE',
    createdAt: new Date('2024-01-01T00:00:00Z'), updatedAt: new Date('2024-01-01T00:00:00Z'),
    _count: { users: 3, organizations: 0, rentalOrders: 2 }, rentalProfile: null, businessWorkspaces: []
  };
  const tenantReads = [], workspaceCalls = [];
  let tenantExists = true;
  current.tx.tenant.findMany = async (query) => {
    tenantReads.push(query);
    return tenantExists ? [tenant] : [];
  };
  const workspace = { id: 'workspace-a', tenantId };
  const repository = {
    async listBusinessWorkspacesForTenant(id) {
      workspaceCalls.push(['list', id]);
      return [workspace];
    },
    async createBusinessWorkspaceForTenant(id, input, onBeforeCommit, actorId) {
      assert.equal(typeof onBeforeCommit, 'function');
      workspaceCalls.push(['create', id, input, actorId]);
      return workspace;
    },
    async updateBusinessWorkspaceForTenant(id, workspaceId, input) {
      workspaceCalls.push(['update', id, workspaceId, input]);
      return workspace;
    }
  };
  const platform = new PlatformService({ get: () => 'mysql' }, repository, { async onApplicationBootstrap() {} });
  platform.publicManagement = current.service;
  const user = current.operators.saas;
  const createInput = { code: 'CAMERA', name: 'Camera', categoryCode: 'camera' };
  const updateInput = { name: 'Updated workspace' };
  const operations = [
    () => platform.listTenantBusinessWorkspaces(tenantId, user),
    () => platform.createTenantBusinessWorkspace(tenantId, createInput, user),
    () => platform.updateTenantBusinessWorkspace(tenantId, workspace.id, updateInput, user)
  ];
  for (const operation of operations) await current.as('saas', operation);
  assert.deepEqual(workspaceCalls, [
    ['list', tenantId], ['create', tenantId, createInput, user.id], ['update', tenantId, workspace.id, updateInput]
  ]);
  assert.equal(tenantReads.length, 6, 'each entry reads the public tenant and the original Rental projection');
  assert.deepEqual(tenantReads[0].where, { id: tenantId });
  assert.deepEqual(tenantReads[1].where, { id: { in: [tenantId] } });
  assert.ok(tenantReads[1].include.rentalProfile);

  await assert.rejects(current.as('actor', () => platform.listTenantBusinessWorkspaces(tenantId, current.operators.actor)), forbidden);
  assert.equal(tenantReads.length, 6, 'ordinary tenant accounts fail before reading the tenant');
  current.operators.saas.permissions = [];
  await assert.rejects(current.as('saas', operations[0]), forbidden, 'the current persisted SaaS permission is rechecked');
  assert.equal(tenantReads.length, 6);
  current.operators.saas.permissions = ['system:tenant:manage'];
  tenantExists = false;
  for (const operation of operations) await assert.rejects(current.as('saas', operation), error => error?.status === 404);
  assert.equal(workspaceCalls.length, 3, 'a missing tenant fails before every Core workspace delegate');

  const unavailable = new PlatformService({ get: () => 'mysql' }, repository);
  await assert.rejects(unavailable.listTenantBusinessWorkspaces(tenantId, user), error => error?.status === 503);
  const memory = new PlatformService({ get: () => 'memory' }, undefined);
  await assert.rejects(memory.listTenantBusinessWorkspaces(tenantId, user), invalid, 'memory construction keeps its original data-source refusal');
});

const legacyManagementWrites = [
  { name: 'saveUser', permission: 'system:user:manage', execute: current => current.management.saveUser({
    id: 'target', tenantId, account: 'target', displayName: 'Target', roleIds: ['role-a'], isPlatformAdmin: false, isActive: true
  }) },
  { name: 'userStatus', permission: 'system:user:manage', execute: current => current.management.setUserStatus('target', false, tenantId) },
  { name: 'resetUserPassword', permission: 'system:user:manage', execute: current => current.management.resetUserPassword('target', tenantId) },
  { name: 'saveRole', permission: 'system:role:manage', execute: current => current.management.saveRole({
    id: 'role-a', tenantId, code: 'OPERATOR', name: 'Updated role', scope: 'operator', permissions: []
  }) },
  { name: 'saveRolePermissions', permission: 'system:role:manage', execute: current => current.management.saveRolePermissions(
    'role-a', ['rental-os:order:view'], tenantId
  ) },
  { name: 'deleteRole', permission: 'system:role:manage', execute: current => current.management.deleteRole('role-a', tenantId) }
];

test('the six legacy management writes retain exact permissions and current administrator authority', async () => {
  for (const write of legacyManagementWrites) {
    const exact = fixture();
    exact.operators.actor.permissions = [write.permission];
    await exact.as('actor', () => write.execute(exact));
    assert.equal(exact.state.logs.length, 1, write.name + ' exact permission commits the original audit');
    const admin = fixture();
    admin.operators.admin.permissions = [];
    await admin.as('admin', () => write.execute(admin));
    assert.equal(admin.state.logs.length, 1, write.name + ' current tenant administrator remains authorized');
    for (const wildcard of ['*', 'system:*']) {
      const denied = fixture();
      denied.operators.actor.permissions = [wildcard];
      await assert.rejects(denied.as('actor', () => write.execute(denied)), forbidden, write.name + ' rejects ' + wildcard);
      assert.deepEqual(denied.state.userWrites, [], write.name);
      assert.deepEqual(denied.state.roles, [], write.name);
      assert.deepEqual(denied.state.revoked, [], write.name);
      assert.deepEqual(denied.state.logs, [], write.name);
      assert.deepEqual(denied.state.permissions, ['old'], write.name);
    }
  }
});

test('loss of the legacy exact permission before commit rolls back all six writes and their audit', async () => {
  for (const write of legacyManagementWrites) {
    const current = fixture();
    current.operators.actor.permissions = [write.permission];
    current.tx.operationLog.create = async ({ data }) => {
      current.state.logs.push(structuredClone(data));
      current.operators.actor.permissions = ['*'];
      return {};
    };
    await assert.rejects(current.as('actor', () => write.execute(current)), forbidden, write.name);
    assert.deepEqual(current.state.userWrites, [], write.name);
    assert.deepEqual(current.state.roles, [], write.name);
    assert.deepEqual(current.state.revoked, [], write.name);
    assert.deepEqual(current.state.logs, [], write.name);
    assert.deepEqual(current.state.permissions, ['old'], write.name);
    assert.deepEqual(current.operators.actor.permissions, [write.permission], write.name);
  }
});

test('the original self-revocation checkpoints retain legal status, password and role permission changes', async () => {
  const status = fixture();
  status.operators.actor.permissions = ['system:user:manage'];
  await status.as('actor', () => status.management.setUserStatus('actor', false, tenantId));
  assert.equal(status.operators.actor.isActive, false);
  assert.deepEqual(status.state.revoked, ['actor']);
  assert.equal(status.state.logs.length, 1);

  const password = fixture();
  password.operators.actor.permissions = ['system:user:manage'];
  const result = await password.as('actor', () => password.management.resetUserPassword('actor', tenantId));
  assert.ok(result.temporaryPassword);
  assert.equal(password.operators.actor.mustChangePassword, true);
  assert.deepEqual(password.state.revoked, ['actor']);
  assert.equal(password.state.logs.length, 1);

  const role = fixture();
  role.operators.actor.roleIds = ['role-a'];
  role.state.permissions = ['p-role'];
  await role.as('actor', () => role.management.saveRolePermissions('role-a', [], tenantId));
  assert.deepEqual(role.state.permissions, []);
  assert.equal(role.state.logs.length, 1);
});

test('the legacy hook retains public permissions, selected-location rejection and existing role reads', async () => {
  const generic = fixture();
  generic.operators.actor.permissions = ['*'];
  await generic.as('actor', () => generic.service.resetUserPassword('target', tenantId));
  assert.equal(generic.state.userWrites.length, 1, 'the original public global wildcard remains effective');
  const prefix = fixture();
  prefix.operators.actor.permissions = ['system:*'];
  await assert.rejects(prefix.as('actor', () => prefix.service.resetUserPassword('target', tenantId)), forbidden);
  assert.deepEqual(prefix.state.userWrites, [], 'the original public matcher already rejects prefix wildcards');
  const missing = fixture();
  missing.operators.actor.permissions = [];
  await assert.rejects(missing.as('actor', () => missing.service.userStatus('target', false, tenantId, {
    ...rentalPublicManagementCompatibility, allowsTenantAccess: () => true
  })), forbidden, 'a compatibility predicate cannot provide missing public permission');
  assert.deepEqual(missing.state.logs, []);
  const selected = fixture();
  await assert.rejects(selected.as('admin', () => {
    getRequestIdentity().locationScope = { mode: 'selected', locationIds: ['location-a'] };
    return selected.management.resetUserPassword('target', tenantId);
  }), forbidden, 'the original selected-location restriction precedes the legacy predicate');
  assert.deepEqual(selected.state.userWrites, []);
  assert.deepEqual(selected.state.logs, []);
  const reads = fixture();
  reads.operators.actor.permissions = ['system:user:manage'];
  assert.equal((await reads.as('actor', () => reads.management.listRoles(tenantId))).length, 2);
  reads.operators.actor.permissions = ['system:role:manage'];
  reads.operators.actor.dataScope = 'organization';
  assert.ok((await reads.as('actor', () => reads.management.listPermissionTree())).length);
  assert.deepEqual(reads.state.logs, []);
});

test('global security writes require an explicitly permitted SaaS identity', async () => {
  await assert.rejects(guardCall(actor(['system:params:manage']), 'PUT', '/platform/security-baseline'), forbidden);
  await assert.rejects(guardCall({ ...actor(), isPlatformAdmin: true }, 'PUT', '/platform/security-baseline'), forbidden);
  await assert.rejects(guardCall({ ...actor([]), isSaasAdmin: true }, 'PUT', '/platform/security-baseline'), forbidden);
  assert.equal(await guardCall({ ...actor(['system:params:manage']), isSaasAdmin: true }, 'PUT', '/platform/security-baseline'), true);
  assert.equal(await guardCall(actor(['system:params:manage']), 'GET', '/platform/security-baseline'), true);
  const current = fixture();
  await assert.rejects(current.as('actor', () => current.service.saveSecurityBaseline({})), forbidden);
  const user = { ...actor(['system:params:manage']), isSaasAdmin: true };
  let received;
  PlatformController.prototype.saveSecurityBaseline.call({ platformService: {
    saveSecurityBaseline: (...args) => { received = args; }
  } }, { config: {}, operator: 'forged' }, { user });
  assert.equal(received[1], user);
});

test('user manager can read roles but cannot use the collection POST to modify one', async () => {
  assert.equal(await guardCall(actor(), 'GET', '/platform/roles'), true);
  await assert.rejects(guardCall(actor(), 'POST', '/platform/roles'), forbidden);
  assert.equal(await guardCall(actor(['system:role:manage']), 'POST', '/platform/roles'), true);
  let received;
  PlatformController.prototype.createRole.call({ platformService: { saveRole: input => { received = input; } } },
    { id: 'existing-role', name: 'Changed' }, { user: actor(['system:role:manage']) });
  assert.equal(received.id, undefined);
});

test('special account writes reject base and workspace administrators for an ordinary manager', async () => {
  const f = fixture();
  await assert.rejects(f.as('actor', () => f.management.resetUserPassword('admin', tenantId)), forbidden);
  await assert.rejects(f.as('actor', () => f.management.setUserStatus('admin', false, tenantId)), forbidden);
  f.workspaceAdmin();
  await assert.rejects(f.as('actor', () => f.management.resetUserPassword('target', tenantId)), forbidden);
  await assert.rejects(f.as('actor', () => f.management.setUserStatus('target', false, tenantId)), forbidden);
  assert.deepEqual(f.state.userWrites, []);
  assert.deepEqual(f.state.revoked, []);
});

test('authorized reset and disable keep password/state and session revocation in one transaction', async () => {
  const f = fixture();
  const result = await f.as('actor', () => f.management.resetUserPassword('target', tenantId));
  assert.ok(result.temporaryPassword);
  assert.equal(f.state.userWrites[0].mustChangePassword, true);
  assert.deepEqual(f.state.revoked, ['target']);
  await f.as('admin', () => f.management.setUserStatus('target', false, tenantId));
  assert.equal(f.state.userWrites[1].isActive, false);
  assert.deepEqual(f.state.revoked, ['target', 'target']);
  assert.ok(f.options.every(o => o.isolationLevel === Prisma.TransactionIsolationLevel.Serializable));
  const rollback = fixture();
  rollback.tx.authSession.updateMany = async () => { throw Error('revocation failed'); };
  await assert.rejects(rollback.as('actor', () => rollback.management.resetUserPassword('target', tenantId)), /revocation failed/);
  assert.deepEqual(rollback.state.userWrites, []);
});

test('single workspace grants use fixed-role and existing-admin protection before writes', async () => {
  const f = fixture();
  await assert.rejects(f.workspaceRepository.saveWorkspaceMember('ws-a', { userId: 'target', roleId: 'fixed' }, actor()), forbidden);
  f.workspaceAdmin();
  await assert.rejects(f.workspaceRepository.saveWorkspaceMember('ws-a', { userId: 'target', isActive: false }, actor()), forbidden);
  assert.deepEqual(f.state.members, []);
  const allowed = fixture();
  await allowed.workspaceRepository.saveWorkspaceMember('ws-a', { userId: 'target', roleId: 'fixed' }, allowed.operators.admin);
  assert.equal(allowed.state.members.length, 1);
});

test('SaaS reset uses its separate authority and ordinary reset cannot borrow it', async () => {
  const f = fixture();
  await assert.rejects(f.as('saas', () => f.management.resetUserPassword('target', tenantId)), forbidden);
  await assert.rejects(f.as('actor', () => f.management.resetTenantAdminPassword(tenantId)), forbidden);
  const result = await f.as('saas', () => f.management.resetTenantAdminPassword(tenantId));
  assert.equal(result.userId, 'admin');
  assert.deepEqual(f.state.revoked, ['admin']);
});

test('repository rechecks current base tenant permission even when a caller bypasses Guard', async () => {
  const f = fixture();
  f.operators.actor.permissions = ['system:user:manage'];
  await assert.rejects(f.as('actor', () => f.management.saveRole({ code: 'OPERATOR', name: 'Operator', tenantId })), forbidden);
  await assert.rejects(f.as('actor', () => f.management.saveRolePermissions('role-a', [], tenantId)), forbidden);
  f.operators.actor.permissions = ['*'];
  await assert.rejects(f.as('actor', () => f.management.resetUserPassword('target', tenantId)), forbidden);
  assert.deepEqual(f.state.userWrites, []);
  assert.deepEqual(f.state.roles, []);
});

test('role saves reject wildcard, unknown and incorrectly classified permissions', async () => {
  const f = fixture();
  const input = { id: 'role-a', code: 'OPERATOR', name: 'Operator', scope: 'operator', permissions: [] };
  await assert.rejects(f.as('actor', () => f.management.saveRole({ ...input, buttonPermissions: ['*'], tenantId })), invalid);
  await assert.rejects(f.as('actor', () => f.management.saveRole({ ...input, permissions: ['invented'], tenantId })), invalid);
  await assert.rejects(f.as('actor', () => f.management.saveRole({ ...input, buttonPermissions: ['rental-os:order:view'], tenantId })), invalid);
  await assert.rejects(f.as('actor', () => f.management.saveRole({ ...input, code: 'TENANT_ADMIN', tenantId })), invalid);
  assert.deepEqual(f.state.roles, []);
  assert.deepEqual(f.state.permissions, ['old']);
});

test('role metadata and complete permission set roll back together on insert failure', async () => {
  const f = fixture();
  f.failPermissions();
  await assert.rejects(f.as('actor', () => f.management.saveRole({ id: 'role-a', code: 'OPERATOR', name: 'Changed', scope: 'operator',
    permissions: ['rental-os:order:view'], tenantId })), /injected permission failure/);
  assert.deepEqual(f.state.roles, []);
  assert.deepEqual(f.state.permissions, ['old']);
  const good = fixture();
  await good.as('actor', () => good.management.saveRolePermissions('role-a', ['rental-os:order:view', 'rental-os:order:pickup'], tenantId));
  assert.deepEqual(good.state.permissions, ['p-view', 'p-pickup']);
  assert.deepEqual(good.state.roles, [{ buttonPermissions: ['rental-os:order:pickup'] }]);
  assert.equal(good.options[0].isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
});
