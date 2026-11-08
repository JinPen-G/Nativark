const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, preferTsExts: true, compilerOptions: {
  target: 'ES2022', module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { PlatformRepository } = require('../apps/api/src/modules/platform/platform.repository');
const { PlatformService } = require('../apps/api/src/modules/platform/platform.service');
const { PlatformController } = require('../apps/api/src/modules/platform/platform.controller');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { Prisma } = require('@prisma/client');

test('platform parameter navigation follows explicit server grants without giving other tenant capabilities', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const source = ts.createSourceFile('authStore.ts', fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/auth/authStore.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
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
  new Function('exports', 'APP_ROUTES', declaration('apps/admin/src/app/navigation.tsx', 'canAccessRoute'))(access, { aiOperator: { path: '/ai-operator' } });
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
  const operators = { actor: actor(['system:user:manage', 'system:role:manage']), target: { ...actor(), id: 'target' },
    admin: { ...actor(), id: 'admin', isPlatformAdmin: true },
    saas: { ...actor(), id: 'saas', tenantId: 'platform', isSaasAdmin: true } };
  const state = { userWrites: [], revoked: [], members: [], roles: [], permissions: ['old'] };
  let failPermissionInsert = false;
  let privilegedWorkspace = false;
  const role = { id: 'role-a', tenantId, code: 'OPERATOR', name: 'Operator', fixedAllPermissions: false,
    dataScope: 'ALL', isActive: true, scope: 'PLATFORM', permissions: [], buttonPermissions: [] };
  const catalog = [
    { id: 'p-view', code: 'rental-os:order:view', kind: 'ACTION' },
    { id: 'p-pickup', code: 'rental-os:order:pickup', kind: 'BUTTON' }
  ];
  const tx = {
    user: {
      findFirst: async ({ where }) => {
        const user = operators[where.id];
        return user && (!where.tenantId || where.tenantId === user.tenantId)
          && (!where.isSaasAdmin || user.isSaasAdmin) ? user : null;
      },
      update: async ({ where, data }) => { state.userWrites.push({ id: where.id, ...data }); return operators[where.id]; }
    },
    authSession: { updateMany: async ({ where }) => { state.revoked.push(where.userId); return { count: 1 }; } },
    businessWorkspace: { findFirst: async () => ({ id: 'ws-a', tenantId, status: 'ACTIVE' }) },
    workspaceMember: {
      findFirst: async () => privilegedWorkspace ? { userId: 'target' } : null,
      upsert: async ({ create }) => { state.members.push(create); return { ...create, createdAt: new Date(), updatedAt: new Date() }; }
    },
    role: {
      findFirst: async ({ where }) => where.fixedAllPermissions ? { id: 'fixed' } : where.id?.not !== undefined || where.code ? null : role,
      findUnique: async () => role,
      upsert: async ({ update, create }) => { state.roles.push(update); return { ...role, ...create, ...update }; },
      update: async ({ data }) => { state.roles.push(data); return role; }
    },
    permission: { findMany: async ({ where }) => catalog.filter(row => where.code.in.includes(row.code)) },
    rolePermission: {
      deleteMany: async () => { state.permissions = []; },
      createMany: async ({ data }) => { if (failPermissionInsert) throw Error('injected permission failure'); state.permissions = data.map(row => row.permissionId); }
    },
    $queryRaw: async () => [{ id: role.id }]
  };
  const options = [];
  const repo = new PlatformRepository({ $transaction: async (work, option) => {
    options.push(option);
    const before = structuredClone(state);
    try { return await work(tx); } catch (error) { Object.assign(state, before); throw error; }
  } });
  // Persistence fixture already presents resolved roles; production still uses userInclude/toUserRow.
  repo.toUserRow = user => user;
  repo.toRoleRow = row => row;
  return { repo, state, options, tx, operators, role,
    failPermissions: () => { failPermissionInsert = true; },
    workspaceAdmin: () => { privilegedWorkspace = true; } };
}

test('global security writes require an explicitly permitted SaaS identity', async () => {
  await assert.rejects(guardCall(actor(['system:params:manage']), 'PUT', '/platform/security-baseline'), forbidden);
  await assert.rejects(guardCall({ ...actor(), isPlatformAdmin: true }, 'PUT', '/platform/security-baseline'), forbidden);
  await assert.rejects(guardCall({ ...actor([]), isSaasAdmin: true }, 'PUT', '/platform/security-baseline'), forbidden);
  assert.equal(await guardCall({ ...actor(['system:params:manage']), isSaasAdmin: true }, 'PUT', '/platform/security-baseline'), true);
  assert.equal(await guardCall(actor(['system:params:manage']), 'GET', '/platform/security-baseline'), true);
  await assert.rejects(PlatformService.prototype.saveSecurityBaseline.call({
    assertSaasAdmin: PlatformService.prototype.assertSaasAdmin
  }, {}, actor(['system:params:manage'])), forbidden);
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
  await assert.rejects(f.repo.resetUserPassword('admin', tenantId, 'actor'), forbidden);
  await assert.rejects(f.repo.setUserStatus('admin', false, tenantId, 'actor'), forbidden);
  f.workspaceAdmin();
  await assert.rejects(f.repo.resetUserPassword('target', tenantId, 'actor'), forbidden);
  await assert.rejects(f.repo.setUserStatus('target', false, tenantId, 'actor'), forbidden);
  assert.deepEqual(f.state.userWrites, []);
  assert.deepEqual(f.state.revoked, []);
});

test('authorized reset and disable keep password/state and session revocation in one transaction', async () => {
  const f = fixture();
  const result = await f.repo.resetUserPassword('target', tenantId, 'actor');
  assert.ok(result.temporaryPassword);
  assert.equal(f.state.userWrites[0].mustChangePassword, true);
  assert.deepEqual(f.state.revoked, ['target']);
  await f.repo.setUserStatus('target', false, tenantId, 'admin');
  assert.equal(f.state.userWrites[1].isActive, false);
  assert.deepEqual(f.state.revoked, ['target', 'target']);
  assert.ok(f.options.every(o => o.isolationLevel === Prisma.TransactionIsolationLevel.Serializable));
  const rollback = fixture();
  rollback.tx.authSession.updateMany = async () => { throw Error('revocation failed'); };
  await assert.rejects(rollback.repo.resetUserPassword('target', tenantId, 'actor'), /revocation failed/);
  assert.deepEqual(rollback.state.userWrites, []);
});

test('single workspace grants use fixed-role and existing-admin protection before writes', async () => {
  const f = fixture();
  await assert.rejects(f.repo.saveWorkspaceMember('ws-a', { userId: 'target', roleId: 'fixed' }, actor()), forbidden);
  f.workspaceAdmin();
  await assert.rejects(f.repo.saveWorkspaceMember('ws-a', { userId: 'target', isActive: false }, actor()), forbidden);
  assert.deepEqual(f.state.members, []);
  const allowed = fixture();
  await allowed.repo.saveWorkspaceMember('ws-a', { userId: 'target', roleId: 'fixed' }, allowed.operators.admin);
  assert.equal(allowed.state.members.length, 1);
});

test('SaaS reset uses its separate authority and ordinary reset cannot borrow it', async () => {
  const f = fixture();
  await assert.rejects(f.repo.resetUserPassword('target', tenantId, 'saas'), forbidden);
  await assert.rejects(f.repo.resetTenantAdminPassword(tenantId, 'actor'), forbidden);
  const original = f.tx.user.findFirst;
  f.tx.user.findFirst = async query => query.where.isPlatformAdmin
    ? { id: 'admin' } : original(query);
  const result = await f.repo.resetTenantAdminPassword(tenantId, 'saas');
  assert.equal(result.userId, 'admin');
  assert.deepEqual(f.state.revoked, ['admin']);
});

test('repository rechecks current base tenant permission even when a caller bypasses Guard', async () => {
  const f = fixture();
  f.operators.actor.permissions = ['system:user:manage'];
  await assert.rejects(f.repo.saveRole({ code: 'OPERATOR', name: 'Operator' }, tenantId, 'actor'), forbidden);
  await assert.rejects(f.repo.saveRolePermissions('role-a', [], tenantId, 'actor'), forbidden);
  f.operators.actor.permissions = ['*'];
  await assert.rejects(f.repo.resetUserPassword('target', tenantId, 'actor'), forbidden);
  assert.deepEqual(f.state.userWrites, []);
  assert.deepEqual(f.state.roles, []);
});

test('role saves reject wildcard, unknown and incorrectly classified permissions', async () => {
  const f = fixture();
  const input = { id: 'role-a', code: 'OPERATOR', name: 'Operator', scope: 'operator', permissions: [] };
  await assert.rejects(f.repo.saveRole({ ...input, buttonPermissions: ['*'] }, tenantId, 'actor'), invalid);
  await assert.rejects(f.repo.saveRole({ ...input, permissions: ['invented'] }, tenantId, 'actor'), invalid);
  await assert.rejects(f.repo.saveRole({ ...input, buttonPermissions: ['rental-os:order:view'] }, tenantId, 'actor'), invalid);
  await assert.rejects(f.repo.saveRole({ ...input, code: 'TENANT_ADMIN' }, tenantId, 'actor'), invalid);
  assert.deepEqual(f.state.roles, []);
  assert.deepEqual(f.state.permissions, ['old']);
});

test('role metadata and complete permission set roll back together on insert failure', async () => {
  const f = fixture();
  f.failPermissions();
  await assert.rejects(f.repo.saveRole({ id: 'role-a', code: 'OPERATOR', name: 'Changed', scope: 'operator',
    permissions: ['rental-os:order:view'] }, tenantId, 'actor'), /injected permission failure/);
  assert.deepEqual(f.state.roles, []);
  assert.deepEqual(f.state.permissions, ['old']);
  const good = fixture();
  await good.repo.saveRolePermissions('role-a', ['rental-os:order:view', 'rental-os:order:pickup'], tenantId, 'actor');
  assert.deepEqual(good.state.permissions, ['p-view', 'p-pickup']);
  assert.deepEqual(good.state.roles, [{ buttonPermissions: ['rental-os:order:pickup'] }]);
  assert.equal(good.options[0].isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
});
