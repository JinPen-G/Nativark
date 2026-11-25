'use strict';
/** 复用原 Core 授权测试的行存储与源码 loader，直接执行公共 principal、Rental 仓储和目录。
 * 不替换身份/权限算法，不建立第二个 runner，不读真实数据库或产生构建文件。 */
const assert = require('node:assert/strict');

module.exports = function registerCases({ test, fixture, sourceModule, loadPackage, lock, source }) {
  const { composeRentalCoreSessionReader } = sourceModule('core-session');
  const { RentalWorkspaceUnavailableError } = sourceModule('mysql-workspace-principal');
  const { composePlatformCoreSessionReader } = loadPackage('@rental-os/platform-core-host');
  const { createCoreDeployedCatalogue } = loadPackage('@rental-os/core-host');
  const { createTicketsManifest } = loadPackage('@rental-os/example-tickets-core');
  const { composeTicketsPlatformHost } = loadPackage('@rental-os/example-tickets-core/platform-host');
  const { corePermissionCode } = loadPackage('@rental-os/core-contracts');
  const tickets = createTicketsManifest(source);
  const ticketCodes = tickets.permissions.map(permission => corePermissionCode(tickets.id, permission));
  const permissions = (context, coreId) => context.cores.find(entry => entry.core.id === coreId)?.permissions;
  const noWrite = f => assert(!f.trace.some(row => row.event === 'execute' || row.event === 'audit'));

  function sessionFixture() {
    const f = fixture();
    const user = f.state.users.find(row => row.id === 'user');
    user.roleId = 'admin-role';
    f.state.roles.find(row => row.id === 'admin-role').permissions = [{ permission: { id: 'tenant-all', code: '*' } }];
    f.state.sessions.push({ id: 'user-session', userId: 'user', audience: 'operator', currentWorkspaceId: 'space',
      revokedAt: null, expiresAt: new Date('2099-01-01') });
    for (const coreId of ['rental', tickets.id]) {
      f.state.grants.push({ tenantId: 'tenant', coreId, state: 'enabled', revision: 1, operationId: coreId + '-grant' });
      f.state.assignments.push({ tenantId: 'tenant', coreId, userId: 'user', state: 'assigned', revision: 1, operationId: coreId + '-member' });
    }
    const ticketHost = composeTicketsPlatformHost({ database: f.database, users: f.input.authentication,
      audit: { recordCoreBusinessReceipt() { throw Error('目录不写业务审计'); } }, term: f.input.term, deployment: f.input.deployment });
    const catalogue = createCoreDeployedCatalogue({ lock: { ...lock, cores: [...lock.cores, { manifest: tickets, sha256: 'd'.repeat(64) }] },
      registrations: [...f.input.registrations.values(), { manifest: tickets, server: ticketHost.server }],
      observations: { async read() { throw Error('目录不从声明伪造物理就绪'); } } });
    const input = { database: f.database, authSource: f.input.authentication, catalogue };
    const reader = composeRentalCoreSessionReader(input);
    const run = work => f.withActor('user', work,
      { accessSession: { sessionId: 'user-session', expiresAt: 4070908800, workspaceId: 'space' } });
    return Object.assign(f, { input, run, read: () => run(reader) });
  }

  test('多 Core 目录保留租户通配工单与管理权；Rental 仍只取当前空间原权限', async () => {
    const f = sessionFixture(), context = await f.read();
    assert.deepEqual(permissions(context, tickets.id), ticketCodes);
    assert.equal(context.canManageMembers, true);
    assert.deepEqual(context.assignable.map(core => core.id).sort(), ['example-tickets', 'rental']);
    assert(permissions(context, 'rental').includes('rental:order:view'));
    assert(!permissions(context, 'rental').includes('rental:order:create'));
    assert(context.cores.every(entry => entry.permissions.every(code => code.startsWith(entry.core.id + ':') && code !== '*')));
    const queries = f.trace.filter(row => row.event === 'sql').map(row => row.detail);
    assert(queries.findIndex(sql => sql.includes('workspace_members')) < queries.findIndex(sql => sql.includes('platform_tenant_core_grants')));
    assert.equal(f.trace.filter(row => row.event === 'transaction').length, 1);
    noWrite(f);
  });

  test('租户渠道按原身份投影，无空间仍可进入，但 Core 授权、成员分配与空间业务不放宽', async () => {
    const integration = [{ permission: { id: 'integration', code: 'system:integration:manage' } }];
    for (const scenario of ['tenant', 'none', 'workspace', 'workspace-denied', 'grant', 'assignment', 'revoked']) {
      const f = sessionFixture(), inWorkspace = scenario.startsWith('workspace');
      f.state.roles.find(row => row.id === 'admin-role').permissions = scenario === 'none' ? [] : integration;
      f.state.roles.find(row => row.id === 'reader').permissions = scenario === 'workspace' ? integration : [];
      f.state.sessions.find(row => row.userId === 'user').currentWorkspaceId = inWorkspace ? 'space' : null;
      if (scenario === 'grant') f.state.grants.find(row => row.coreId === 'rental').state = 'disabled';
      if (scenario === 'assignment') f.state.assignments.find(row => row.coreId === 'rental').state = 'revoked';
      if (scenario === 'revoked') f.controls.beforeQuery = (state, _tx, sql) => {
        if (sql.includes('FROM platform_member_core_assignments')) state.roles.find(row => row.id === 'admin-role').permissions = [];
      };
      const read = composeRentalCoreSessionReader(f.input);
      const context = await f.withActor('user', read, { accessSession: {
        sessionId: 'user-session', expiresAt: 4070908800, ...(inWorkspace ? { workspaceId: 'space' } : {})
      } });
      const codes = permissions(context, 'rental') ?? [];
      assert.equal(codes.includes('rental:channel:manage'), ['tenant', 'workspace'].includes(scenario), scenario);
      assert(!codes.includes('rental:order:view'), '渠道授权不能开启订单');
      assert(!codes.includes('rental:governance:view') || scenario === 'workspace', '无空间不取得空间治理');
      assert(!codes.includes('rental:page.ai-operator:view') || scenario === 'workspace', '无空间不借渠道权取得 Agent 入口');
      noWrite(f);
    }
  });

  test('仅 Rental 成员/空间失效时工单仍可见；停用空间角色不回退租户通配', async () => {
    for (const revoke of [s => { s.members = s.members.filter(row => row.userId !== 'user'); },
      s => { s.members.find(row => row.userId === 'user').isActive = false; },
      s => { s.workspaces[0].status = 'DISABLED'; }, s => { s.roles.find(row => row.id === 'reader').isActive = false; }]) {
      const f = sessionFixture(); revoke(f.state);
      const context = await f.read();
      assert.deepEqual(permissions(context, tickets.id), ticketCodes);
      assert.equal(context.canManageMembers, true);
      assert(!permissions(context, 'rental').includes('rental:order:view'));
      assert(permissions(context, 'rental').includes('rental:member:view'), '原租户会员权保留');
      noWrite(f);
    }
  });

  test('空间缺失不能掩盖原会话撤销/切换、租户或角色归属错误及未知存储错误', async () => {
    for (const deny of [s => { s.sessions.find(row => row.userId === 'user').revokedAt = new Date(); },
      s => { s.sessions.find(row => row.userId === 'user').currentWorkspaceId = 'other'; },
      s => { s.sessions.find(row => row.userId === 'user').audience = 'staff'; },
      s => { s.sessions.find(row => row.userId === 'user').expiresAt = new Date(0); },
      s => { s.tenants[0].status = 'FROZEN'; }, s => { s.users.find(row => row.id === 'user').mustChangePassword = true; },
      s => { s.roles.find(row => row.id === 'admin-role').tenantId = 'other'; }]) {
      const f = sessionFixture(); f.state.members = []; deny(f.state);
      await assert.rejects(f.read(), error => !(error instanceof RentalWorkspaceUnavailableError)); noWrite(f);
    }
    const f = sessionFixture(), original = Error('STORAGE_UNAVAILABLE');
    f.controls.beforeQuery = (_s, _tx, sql) => { if (sql.includes('workspace_members')) throw original; };
    await assert.rejects(f.read(), error => error === original); noWrite(f);
  });

  test('原空间锁入口先复验 session；typed unavailable 保持 403 且不能当作完整业务身份', async () => {
    for (const invalid of ['workspace', 'session', 'password']) {
      const f = sessionFixture(); f.state.members = [];
      if (invalid === 'session') f.state.sessions.find(row => row.userId === 'user').revokedAt = new Date();
      if (invalid === 'password') f.state.users.find(row => row.id === 'user').mustChangePassword = true;
      await assert.rejects(f.database.$transaction(tx => f.input.authSource.lockWorkspaceSessionUser(tx,
        { tenantId: 'tenant', userId: 'user', workspaceId: 'space', sessionId: 'user-session', audience: 'operator' }),
      { isolationLevel: 'ReadCommitted' }), error => invalid !== 'workspace'
        ? error.getStatus() === 401 && !(error instanceof RentalWorkspaceUnavailableError)
        : error instanceof RentalWorkspaceUnavailableError && error.getStatus() === 403);
      assert(f.trace.some(row => row.event === 'read:session')); noWrite(f);
    }
    const f = sessionFixture(); f.state.members = [];
    f.controls.beforeQuery = (s, _tx, sql) => {
      if (sql.includes('workspace_members')) s.sessions.find(row => row.userId === 'user').revokedAt = new Date();
    };
    await assert.rejects(f.read(), error => error.getStatus() === 401 && !(error instanceof RentalWorkspaceUnavailableError));
  });

  test('最终身份/空间复验处理等待期间撤权，已收缩权限不因末次新增角色而扩大', async () => {
    for (const [change, expected] of [
      [s => { s.sessions.find(row => row.userId === 'user').revokedAt = new Date(); }, 'deny'],
      [s => { s.members.find(row => row.userId === 'user').isActive = false; }, 'workspace'],
      [s => { s.roles.find(row => row.id === 'admin-role').permissions = [{ permission: { id: 'read', code: 'example-tickets:ticket:read' } }]; }, 'tenant'],
      [s => { s.roles.find(row => row.id === 'reader').permissions.push({ permission: { id: 'create', code: 'rental-os:order:create' } }); }, 'gain']
    ]) {
      const f = sessionFixture();
      f.controls.beforeQuery = (s, _tx, sql) => { if (sql.includes('FROM platform_member_core_assignments')) change(s); };
      if (expected === 'deny') await assert.rejects(f.read(), error => error.getStatus() === 401);
      else {
        const context = await f.read();
        assert.deepEqual(permissions(context, tickets.id), expected === 'tenant' ? ['example-tickets:ticket:read'] : ticketCodes);
        assert.equal(context.canManageMembers, expected !== 'tenant');
        if (expected === 'tenant') assert.deepEqual(context.assignable, []);
        if (expected === 'workspace') assert(!permissions(context, 'rental').includes('rental:order:view'));
        if (expected === 'gain') assert(!permissions(context, 'rental').includes('rental:order:create'));
      }
      noWrite(f);
    }
  });

  test('公共单 Core 投影始终有界且读取当前原用户，未投影 Core 和管理身份不受影响', async () => {
    const f = sessionFixture(), seen = [];
    const read = composePlatformCoreSessionReader({ database: f.database, users: f.input.authSource, catalogue: f.input.catalogue,
      permissionProjection: { coreId: 'rental', async project(tx, user) {
        seen.push({ tx, user });
        return seen.length === 1 ? ['rental:order:view', 'rental:undeclared:write', ...ticketCodes, '*']
          : ['rental:order:create', ...ticketCodes, '*'];
      } } });
    f.controls.beforeQuery = (s, _tx, sql) => {
      if (sql.includes('FROM platform_member_core_assignments'))
        s.roles.find(row => row.id === 'admin-role').permissions = [{ permission: { id: 'read', code: 'example-tickets:ticket:read' } }];
    };
    const context = await f.run(read);
    assert.equal(seen.length, 2); assert.equal(seen[0].tx, seen[1].tx);
    assert.deepEqual(seen[0].user.permissions, ['*']);
    assert.deepEqual(seen[1].user.permissions, ['example-tickets:ticket:read']);
    assert.deepEqual(permissions(context, 'rental'), []);
    assert.deepEqual(permissions(context, tickets.id), ['example-tickets:ticket:read']);
    assert.equal(context.canManageMembers, false); noWrite(f);
    assert.throws(() => composePlatformCoreSessionReader({ database: f.database, users: f.input.authSource,
      catalogue: f.input.catalogue, permissionProjection: { coreId: 'not-registered', async project() { return []; } } }), /已登记/);
  });
};
