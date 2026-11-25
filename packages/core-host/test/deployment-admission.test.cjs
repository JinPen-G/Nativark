'use strict';
/** 部署停新正式回归：原公共包配置只在内存 emit，正式出口加载真实服务、身份、HTTP 和 SQL 适配。
 * SQL/锁定回归保留窄身份租约；集成组使用原身份仓储和主体权威，仅替换存储运输。
 * 不连接数据库，不生成 Client。
 * 默认不创建临时目录，所有编译/事务产物随进程释放；失败也核对零磁盘产物。
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const root = path.resolve(__dirname, '../../..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !path.isAbsolute(args[1] || '')))
  throw Error('只接受 --deps <原只读 node_modules 绝对路径>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/core-deployment-admission');
assert.equal(fs.existsSync(temporary), false, '不覆盖既有任务目录');
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require('../../../tests/fixtures/ai-native/prisma-offline-preload.cjs');
const { createBuild } = require('../../../scripts/check-rental-package-build.cjs');
const actor = Object.freeze({ tenantId: 'tenant_platform', subjectId: 'saas-operator', audience: 'operator' });
const coreId = 'example-tickets', otherCoreId = 'rental', prefix = 'core-deployment-admission:';
const sqlSource = 'packages/core-host/src/mysql-deployment-admission.ts';
const serviceSource = 'packages/core-host/src/deployment-admission.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries([serviceSource, sqlSource, 'packages/core-host/src/binding.ts',
  'packages/platform-server/src/modules/platform/platform-principal.authority.ts',
  'packages/platform-server/src/modules/platform/platform-identity.repository.ts',
  'packages/platform-core-host/src/platform-core-admission.ts', 'packages/platform-core-host/src/core-management.controller.ts'
].map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));

function mutex() {
  let tail = Promise.resolve();
  return async () => {
    const previous = tail; let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous; return release;
  };
}
function sharedLock() {
  let readers = 0, writer = false; const pending = [];
  const drain = () => {
    if (writer || !pending.length) return;
    if (pending[0].mode === 'X') {
      if (readers) return;
      writer = true; pending.shift().resolve(() => { writer = false; drain(); });
    } else while (pending.length && pending[0].mode === 'S' && !writer) {
      readers++; pending.shift().resolve(() => { readers--; drain(); });
    }
  };
  return mode => new Promise(resolve => { pending.push({ mode, resolve }); drain(); });
}

// 只解释该适配的三个 SELECT 和两类写入。未知 SQL 拒绝，不能以空结果掩盖契约变化。
function fixture(api, Service, seed = []) {
  const f = { rows: structuredClone(seed), logs: [], queries: [], trace: [], config: {}, transactions: 0, writes: 0, audits: 0,
    currentActor: actor, isSaasAdmin: true };
  const parent = mutex(), locks = new Map();
  const lock = module => {
    if (!locks.has(module)) locks.set(module, sharedLock());
    return locks.get(module);
  };
  f.client = { async $transaction(work, options) {
    assert.deepEqual(options, { isolationLevel: 'ReadCommitted' }); f.transactions++;
    const releases = []; let staged, recorded = [], dirty = false, lockedModule;
    const tx = {
      async $queryRaw(parts, ...values) {
        const sql = parts.join('?').replace(/\s+/gu, ' ').trim(); f.queries.push({ sql, values });
        assert.match(sql, /^SELECT .+ FROM SystemParameterSet WHERE tenantId = \? AND module = \?/u);
        assert.equal(values[0], 'tenant_platform');
        assert([coreId, otherCoreId].some(id => values[1] === prefix + id));
        if (f.config.queryFailure) throw Error('secret sql-driver-detail');
        if (sql.includes('versionNo = 1')) {
          const mode = sql.endsWith('LOCK IN SHARE MODE') ? 'S' : 'X';
          if (mode === 'X') assert.match(sql, /FOR UPDATE$/u);
          assert.equal(lockedModule, undefined, '一次事务仅锁本次 Core canonical');
          releases.push(await lock(values[1])(mode)); lockedModule = values[1];
          f.trace.push('canonical:' + mode); staged = structuredClone(f.rows);
          return staged.filter(row => row.module === lockedModule && row.versionNo === 1);
        }
        assert.equal(lockedModule, values[1]); assert.match(sql, /status = 'archived'/u); assert.match(sql, /FOR UPDATE$/u);
        if (sql.includes('JSON_EXTRACT')) {
          assert.match(sql, /JSON_EXTRACT\(content, '\$\.result\.operationId'\) = CAST\(\? AS JSON\) ORDER BY versionNo FOR UPDATE$/u);
          assert(!sql.includes('LIMIT')); const operationId = JSON.parse(values[2]); f.trace.push('receipt:' + operationId);
          return staged.filter(row => row.module === lockedModule && row.status === 'archived' && row.content?.result?.operationId === operationId);
        }
        assert.match(sql, /LIMIT 1 FOR UPDATE$/u); f.trace.push('archive-presence');
        return staged.filter(row => row.module === lockedModule && row.status === 'archived').slice(0, 1).map(row => ({ id: row.id }));
      },
      async $executeRaw(parts, ...values) {
        assert(lockedModule); const sql = parts.join('?').replace(/\s+/gu, ' ').trim(); f.queries.push({ sql, values }); f.writes++;
        if (sql.startsWith('UPDATE')) {
          assert.match(sql, /WHERE id = \? AND tenantId = \? AND module = \? AND versionNo = 1 AND status = 'effective' AND content = CAST\(\? AS JSON\)$/u);
          const [content, operator, rowId, tenantId, module, previous] = values;
          assert.equal(tenantId, 'tenant_platform'); assert.equal(module, lockedModule); f.trace.push('canonical:update');
          if (f.config.casMiss) return 0;
          const row = staged.find(row => row.id === rowId && row.tenantId === tenantId && row.module === module && row.versionNo === 1 && row.status === 'effective');
          if (!row || !isDeepStrictEqual(row.content, JSON.parse(previous))) return 0;
          row.content = JSON.parse(content); row.operator = operator; dirty = true; return 1;
        }
        assert.match(sql, /^INSERT INTO SystemParameterSet \(id, tenantId, module, versionNo, status, content, operator, effectiveAt, createdAt, updatedAt\)/u);
        const archive = sql.includes("'archived'"); f.trace.push(archive ? 'archive:insert' : 'canonical:insert');
        if (f.config.duplicate === (archive ? 'archive' : 'canonical'))
          throw Object.assign(Error('private duplicate'), { code: 'P2010', meta: { code: '1062' } });
        const [rowId, tenantId, module] = values;
        assert.equal(tenantId, 'tenant_platform'); assert.equal(module, lockedModule);
        const versionNo = archive ? values[3] : 1, content = JSON.parse(values[archive ? 4 : 3]), operator = values[archive ? 5 : 4];
        if (staged.some(row => row.module === module && row.versionNo === versionNo))
          throw Object.assign(Error('duplicate key'), { code: 'P2010', meta: { code: '1062' } });
        staged.push({ id: rowId, tenantId, module, versionNo, status: archive ? 'archived' : 'effective', content, operator });
        dirty = true; return 1;
      },
      async lockParent() { releases.push(await parent()); f.trace.push('authority:tenant-X'); },
      audit(receipt) { recorded.push(structuredClone(receipt)); }
    };
    try {
      const value = await work(tx);
      if (dirty) f.rows = staged;
      f.logs.push(...recorded); f.trace.push('commit');
      if (f.config.commitLost) { f.config.commitLost = false; throw Error('commit acknowledgement lost'); }
      return value;
    } catch (error) { f.trace.push('exit-error'); throw error; }
    finally { for (const release of releases.reverse()) release(); }
  } };
  f.authority = {
    async lock(tx, request) {
      assert([coreId, otherCoreId].includes(request.coreId)); await tx.lockParent();
      const lease = { actor: f.currentActor, canManage: f.isSaasAdmin,
        async revalidate() {
          f.trace.push('lease:revalidate');
          if (f.config.revoked || !f.isSaasAdmin) throw Object.assign(Error('revoked'), { code: 'denied' });
        } };
      f.lastLease = lease; return lease;
    },
    async audit(tx, receipt) {
      f.trace.push('audit'); f.audits++;
      if (f.config.auditFailure) throw Error('audit failed');
      if (f.config.afterAuditActor) f.lastLease.actor = f.config.afterAuditActor;
      tx.audit(receipt);
    }
  };
  f.execution = api.createMysqlCoreDeploymentAdmissionExecution(f.client, f.authority);
  f.service = new Service(f.execution, { async requireRegistered(actual) { assert([coreId, otherCoreId].includes(actual)); } });
  f.change = async (operationId, state, expectedRevision, target = coreId, principal = actor) =>
    f.service.change(principal, { coreId: target, operationId, state, expectedRevision });
  f.read = work => f.client.$transaction(tx => work(api.createMysqlCoreDeploymentAdmission(tx)), { isolationLevel: 'ReadCommitted' });
  return f;
}

// 原 identity repository/authority/组合/Controller 均不替换。此层只补原 SQL 和两种 delegate 的存储运输。
function platformFixture(api, Service, modules, seed = []) {
  const f = fixture(api, Service, seed), expiry = new Date('2099-01-01T00:00:00Z');
  f.auth = {
    tenant: { id: actor.tenantId, status: 'active' },
    user: { id: actor.subjectId, tenantId: actor.tenantId, account: 'offline', displayName: '测试操作员', phone: null,
      organizationId: null, organization: null, isActive: true, isSaasAdmin: true, isPlatformAdmin: false,
      mustChangePassword: false, needsTenantOnboarding: false },
    role: { id: 'saas-role', tenantId: actor.tenantId, name: 'SaaS管理员', isActive: true, fixedAllPermissions: false,
      scope: 'OPERATOR', dataScope: 'ALL', buttonPermissions: [],
      permissions: [{ permission: { id: 'tenant-manage', code: 'system:tenant:manage' } }] },
    session: { id: 'original-session', userId: actor.subjectId, audience: 'operator', currentWorkspaceId: null,
      revokedAt: null, expiresAt: expiry }
  };
  f.identity = { tenantId: actor.tenantId, userId: actor.subjectId, audience: 'operator', isSaasAdmin: true,
    permissions: ['system:tenant:manage'], accessSession: { sessionId: f.auth.session.id,
      expiresAt: Math.floor(expiry.getTime() / 1000), workspaceId: null } };
  const forbiddenRootRead = () => { throw Error('身份/会话必须在原事务读取'); };
  let active;
  f.database = { user: { findFirst: forbiddenRootRead }, authSession: { findFirst: forbiddenRootRead },
    async $transaction(work, options) {
      assert.equal(active, undefined, '不能另开身份复核事务');
      return f.client.$transaction(async sqlTx => {
        const transaction = { ...sqlTx,
          async $queryRaw(parts, ...values) {
            assert.equal(active, transaction);
            const sql = parts.join('?').replace(/\s+/gu, ' ').trim(), { tenant, user, role, session } = f.auth;
            if (sql.includes('FROM SystemParameterSet')) return sqlTx.$queryRaw(parts, ...values);
            assert.match(sql, /FOR UPDATE$/u, '原身份读取必须使用行锁');
            if (sql === 'SELECT id, status FROM Tenant WHERE id = ? FOR UPDATE') {
              assert.deepEqual(values, ['tenant_platform']); await sqlTx.lockParent();
              f.trace.push('principal:Tenant:' + values[0]); return [structuredClone(tenant)];
            }
            if (sql === 'SELECT roleId, isActive, isSaasAdmin FROM `User` WHERE id = ? AND tenantId = ? FOR UPDATE') {
              assert.deepEqual(values, [actor.subjectId, actor.tenantId]); f.trace.push('principal:User');
              return [{ roleId: role.id, isActive: user.isActive, isSaasAdmin: user.isSaasAdmin }];
            }
            if (sql === 'SELECT id FROM auth_sessions WHERE id = ? AND userId = ? FOR UPDATE') {
              assert.deepEqual(values, [session.id, actor.subjectId]); f.trace.push('principal:Session'); return [{ id: session.id }];
            }
            if (sql === 'SELECT roleId FROM `UserRole` WHERE userId = ? ORDER BY roleId FOR UPDATE') {
              assert.deepEqual(values, [actor.subjectId]); f.trace.push('principal:UserRole'); return [];
            }
            if (sql === 'SELECT id FROM `Role` WHERE id = ? AND tenantId = ? FOR UPDATE') {
              assert.deepEqual(values, [role.id, actor.tenantId]); f.trace.push('principal:Role');
              return role.tenantId === values[1] ? [{ id: role.id }] : [];
            }
            if (sql === 'SELECT permissionId FROM `RolePermission` WHERE roleId = ? ORDER BY permissionId FOR UPDATE') {
              assert.deepEqual(values, [role.id]); f.trace.push('principal:RolePermission');
              return role.permissions.map(row => ({ permissionId: row.permission.id }));
            }
            if (sql === 'SELECT id FROM `Permission` WHERE id = ? FOR UPDATE') {
              assert(role.permissions.some(row => row.permission.id === values[0]));
              f.trace.push('principal:Permission'); return [{ id: values[0] }];
            }
            throw Error('未支持的身份 SQL: ' + sql);
          },
          async $executeRaw(parts, ...values) {
            assert.equal(active, transaction);
            const sql = parts.join('?').replace(/\s+/gu, ' ').trim();
            if (!sql.startsWith('INSERT INTO OperationLog')) return sqlTx.$executeRaw(parts, ...values);
            assert.equal(sql, 'INSERT INTO OperationLog (id, tenantId, userId, action, detail, createdAt) VALUES (?, ?, ?, ?, ?, NOW(3))');
            const [id, tenantId, userId, action, content] = values;
            assert.equal(tenantId, 'tenant_platform'); assert.equal(userId, actor.subjectId);
            assert.equal(action, 'core.deployment-admission.changed');
            f.trace.push('operation-log:insert'); f.audits++;
            if (f.config.operationLogFailure) throw Error('offline-operation-log-failure');
            sqlTx.audit({ id, tenantId, userId, action, detail: JSON.parse(content) });
            f.config.afterOperationLog?.(f.auth); return 1;
          },
          authSession: { async findFirst({ where }) {
            assert.equal(active, transaction); f.trace.push('read:session');
            const session = f.auth.session;
            assert.deepEqual({ ...where, expiresAt: undefined }, { id: 'original-session', userId: actor.subjectId,
              audience: 'operator', revokedAt: null, expiresAt: undefined });
            assert(where.expiresAt.gt instanceof Date);
            return session.id === where.id && session.userId === where.userId && session.audience === where.audience
              && session.revokedAt === null && session.expiresAt > where.expiresAt.gt ? structuredClone(session) : null;
          } },
          user: { async findFirst({ where }) {
            assert.equal(active, transaction); f.trace.push('read:user');
            assert.deepEqual(where, { id: actor.subjectId, isActive: true, tenant: { status: 'ACTIVE' } });
            const { user, role, tenant } = f.auth;
            return user.id === where.id && user.isActive === where.isActive && tenant.status === 'active'
              ? structuredClone({ ...user, role, roleAssignments: [] }) : null;
          } }
        };
        active = transaction;
        try { return await work(transaction); } finally { active = undefined; }
      }, options);
    }
  };
  f.users = new modules.PlatformIdentityRepository(f.database);
  f.deployment = { async requireRegistered(target) {
    if (target !== coreId && target !== otherCoreId) throw new modules.CoreAccessError('core_unavailable', '该Core未登记');
  } };
  f.admission = modules.composePlatformCoreAdmission({ database: f.database, users: f.users, deployment: f.deployment });
  assert(f.admission.principals instanceof modules.PlatformPrincipalAuthority);
  f.controller = new modules.CoreManagementController({ admission: f.admission });
  f.invoke = (method, body, identity = f.identity) => modules.runWithRequestIdentity(identity, () => f.controller[method](body));
  return f;
}

async function run() {
  const before = sourceHashes(), build = createBuild(deps);
  for (const config of ['packages/platform-contracts/tsconfig.json', 'packages/core-contracts/tsconfig.json', 'packages/core-host/tsconfig.json',
    'packages/platform-server/tsconfig.json', 'packages/platform-core-host/tsconfig.json'])
    build.compile(config);
  assert.equal(build.runtimeAliases.size, 0, '不替换正式 service/schema/SQL 模块');
  const { CoreDeploymentAdmissionService, CoreBindingService, CoreAccessError } = build.load(build.exported('@rental-os/core-host', true));
  const api = build.load(build.exported('@rental-os/core-host/mysql-deployment-admission', true));
  const cc = build.load(build.exported('@rental-os/core-contracts', true));
  const platform = { CoreAccessError, ...build.load(build.exported('@rental-os/platform-core-host', true)),
    ...build.load(build.exported('@rental-os/platform-server/principal', true)),
    ...build.load(build.exported('@rental-os/platform-server/identity', true)),
    ...build.load(build.exported('@rental-os/platform-server/request-identity', true)) };
  const { CORE_DEPLOYMENT_ADMISSION_MAX_REVISION: maximum } = cc;
  const denied = code => error => error instanceof CoreAccessError && error.code === code;
  const make = seed => fixture(api, CoreDeploymentAdmissionService, seed);
  let groups = 0, seed;
  const check = async (name, work) => { await work(); groups++; console.log('PASS ' + name); };

  await check('缺行/损坏/SQL失败保持unknown；共享锁与正式OpenAPI/严格请求合同', async () => {
    const f = make(); assert.equal((await f.read(reader => reader.readCurrent(coreId))).state, 'unknown');
    await assert.rejects(f.read(reader => reader.requireAccepting(coreId)), denied('core_unavailable'));
    f.config.queryFailure = true;
    const observed = await f.read(reader => reader.readCurrent(coreId)); assert.equal(observed.state, 'unknown');
    assert(!JSON.stringify(observed).includes('secret'));
    assert.equal(f.writes, 0); assert.equal(f.trace.includes('authority:tenant-X'), false);
    assert(f.queries.every(item => item.sql.endsWith('LOCK IN SHARE MODE')));
    // 完整生成两份实际资料，覆盖观察联合在管理响应及会话目录中的传递引用。
    const management = cc.createCoreManagementOpenApi(), session = cc.createCoreSessionOpenApi();
    for (const [key, route, request] of [
      ['changeAdmission', 'deployment-admission', { coreId, state: 'stopped', expectedRevision: 0, operationId: 'stop' }],
      ['readAdmission', 'deployment-admission/read', { coreId }],
      ['readAdmissionOperation', 'deployment-admission-operations/read', { coreId, operationId: 'stop' }]
    ]) {
      const declaration = cc.CORE_MANAGEMENT_HTTP[key], name = `PlatformCore.${key}`;
      assert.equal(declaration.method, 'POST'); assert.equal(declaration.path, route);
      const operation = management.paths[`/api/platform/core-host/${route}`].post;
      assert.equal(operation.operationId, `platformCore_${key}`);
      assert.deepEqual(operation['x-requiredPermissions'], ['system:tenant:manage']);
      assert.equal(operation['x-core-management-audience'], 'saas');
      assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
      assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${name}.Request`);
      assert.equal(operation.responses[200].content['application/json'].schema.$ref, `#/components/schemas/${name}.Response`);
      assert.equal(management.schemas[`${name}.Request`].additionalProperties, false);
      assert.deepEqual(declaration.request.parse(request), request);
      assert.equal(declaration.request.safeParse({ ...request, tenantId: 'caller-tenant', actor }).success, false);
      assert.deepEqual(cc.coreManagementHttpPolicy('POST', `/platform/core-host/${route}`),
        { permission: 'system:tenant:manage', audience: 'saas' });
      assert.equal(cc.coreManagementHttpPolicy('GET', `/platform/core-host/${route}`), undefined);
    }
    assert.equal(cc.ChangeCoreDeploymentAdmissionSchema.safeParse({ coreId, state: 'unknown', expectedRevision: 0, operationId: 'stop' }).success, false);
    assert.equal(cc.ChangeCoreDeploymentAdmissionSchema.safeParse({ coreId, state: 'stopped', operationId: 'stop' }).success, false);
    assert.equal(cc.CoreDeploymentAdmissionOperationQuerySchema.safeParse({ coreId }).success, false);
    assert.equal(session.paths['/api/platform/core-host/session-context'].get.operationId, 'platformCore_sessionContext');
    const observation = management.schemas['PlatformCore.readAdmission.Response'].properties.data;
    assert.deepEqual(observation.discriminator, { propertyName: 'state' });
    assert.deepEqual(observation.oneOf.flatMap(branch => branch.properties.state.enum), ['accepting', 'stopped', 'unknown']);
    assert.deepEqual(session.schemas['PlatformCore.Session.Response'].properties.data.properties.cores.items.properties.admission, observation);
  });
  await check('原服务停新/重开、旧收据优先、两Core同键隔离和修订上限', async () => {
    const f = make(), first = await f.change('Op-A', 'accepting', 0);
    assert.deepEqual(first, { coreId, state: 'accepting', revision: 1, operationId: 'Op-A' });
    assert.deepEqual(f.trace, ['authority:tenant-X', 'canonical:X', 'archive-presence', 'receipt:Op-A', 'receipt:Op-A',
      'canonical:insert', 'archive:insert', 'audit', 'lease:revalidate', 'commit']);
    await f.read(reader => reader.requireAccepting(coreId));
    const stopped = await f.change('Op-B', 'stopped', 1);
    await assert.rejects(f.read(reader => reader.requireAccepting(coreId)), denied('core_unavailable'));
    for (const admission of [first, stopped, { coreId, state: 'unknown', reason: '当前存储未确认' }]) {
      const context = cc.CoreSessionContextSchema.parse({ tenantId: 'tenant-a', subjectId: 'member-a',
        tenantHasRegisteredGrant: true, canManageMembers: false, assignable: [], cores: [{
          core: { id: coreId, name: '工单', description: '工单测试', version: '0.1.0', scope: { kind: 'tenant' } },
          grant: { tenantId: 'tenant-a', coreId, state: 'enabled', revision: 1, operationId: 'grant' },
          assignment: { tenantId: 'tenant-a', coreId, userId: 'member-a', state: 'assigned', revision: 1, operationId: 'assign' },
          admission, permissions: [`${coreId}:ticket:read`]
        }] });
      assert.equal(cc.canUseCorePage(context, coreId, [{ resource: 'ticket', action: 'read' }]), admission.state === 'accepting');
      assert.equal(cc.canUseCorePage(context, coreId, [{ resource: 'ticket', action: 'write' }]), false);
    }
    const writes = f.writes, audits = f.audits;
    assert.deepEqual(await f.change('Op-A', 'accepting', 0), first);
    assert.equal(f.writes, writes); assert.equal(f.audits, audits); assert.equal(f.rows[0].content.state, 'stopped');
    assert.deepEqual(await f.service.readOperation(actor, { coreId, operationId: 'op-a' }), { status: 'unavailable' });
    await assert.rejects(f.change('Op-A', 'stopped', 0), denied('operation_conflict'));
    await f.change('Op-C', 'accepting', 2); assert.equal(f.rows.length, 4); assert.equal(f.logs.length, 3);
    seed = structuredClone(f.rows);
    await f.change('Op-A', 'stopped', 0, otherCoreId);
    await f.read(reader => reader.requireAccepting(coreId));
    await assert.rejects(f.read(reader => reader.requireAccepting(otherCoreId)), denied('core_unavailable'));
    assert.deepEqual(f.rows.filter(row => row.module === prefix + coreId), seed);
    assert.equal((await f.service.readOperation(actor, { coreId: otherCoreId, operationId: 'Op-A' })).admission.state, 'stopped');
    const last = make([seed[0]]); last.rows[0].content = { ...last.rows[0].content, revision: maximum - 1, operationId: 'before-maximum' };
    const final = await last.change('maximum', 'stopped', maximum - 1);
    assert.equal(final.revision, maximum); assert.equal(last.rows[1].versionNo, 2147483647);
    const finalWrites = last.writes;
    await assert.rejects(last.change('overflow', 'accepting', maximum), denied('revision_conflict'));
    assert.deepEqual(await last.change('maximum', 'stopped', maximum - 1), final, '先读旧收据，不能先用当前MAX修订拒绝旧操作');
    assert.equal(last.writes, finalWrites);
  });
  await check('坏canonical和孤立归档拒绝初始化；原service仍先核已提交旧收据', async () => {
    for (const mutate of [row => { row.status = 'EFFECTIVE'; }, row => { row.content.coreId = 'other'; },
      row => { row.content.revision = 0; }, row => { row.content = '{bad'; }]) {
      const f = make(seed); mutate(f.rows[0]);
      assert.equal((await f.read(reader => reader.readCurrent(coreId))).state, 'unknown');
      assert.equal((await f.change('Op-A', 'accepting', 0)).revision, 1, '已提交结果观察不依赖当前canonical成功解析');
      await assert.rejects(f.change('Op-D', 'stopped', 3), denied('core_unavailable')); assert.equal(f.writes, 0);
    }
    const f = make(seed.filter(row => row.versionNo !== 1));
    await assert.rejects(f.change('new-initial', 'accepting', 0), denied('core_unavailable')); assert.equal(f.writes, 0);
    assert.equal((await f.service.readOperation(actor, { coreId, operationId: 'Op-A' })).admission.revision, 1);
  });
  await check('全部归档精确查询，重复/主体/摘要/结果/版本身份变化均拒绝', async () => {
    for (const mutate of [f => f.rows.push(structuredClone(f.rows[1])), f => { f.rows[1].versionNo = 9; },
      f => { f.rows[1].content.actor.subjectId = 'another'; }, f => { f.rows[1].content.fingerprint = '0'.repeat(64); },
      f => { f.rows[1].content.result.coreId = otherCoreId; }, f => { f.rows[1].content.extra = true; },
      f => { f.rows[1].operator = 'different'; }]) {
      const f = make(seed); mutate(f);
      await assert.rejects(f.service.readOperation(actor, { coreId, operationId: 'Op-A' }), denied('operation_conflict'));
      assert.equal(f.writes, 0);
    }
  });
  await check('canonical CAS/归档冲突/审计失败/末次撤权回滚状态、收据及审计', async () => {
    for (const [option, expected] of [['casMiss', denied('revision_conflict')], ['auditFailure', /audit failed/],
      ['revoked', error => error.code === 'denied'], ['duplicate', denied('operation_conflict')]]) {
      const f = make(seed), before = structuredClone(f.rows); f.config[option] = option === 'duplicate' ? 'archive' : true;
      await assert.rejects(f.change('Op-D', 'stopped', 3), expected);
      assert.deepEqual(f.rows, before); assert.equal(f.logs.length, 0);
    }
    const f = make(); f.config.duplicate = 'canonical';
    await assert.rejects(f.change('first', 'accepting', 0), denied('revision_conflict')); assert.equal(f.rows.length, 0);
  });
  await check('只读目的、失活租约、非SaaS与当前主体变化均不能写入', async () => {
    const f = make(seed); let repository, lease;
    await f.execution.run({ actor, coreId, purpose: 'read_current' }, async (store, current) => {
      repository = store; lease = current;
      await assert.rejects(store.save(seed[1].content), denied('denied'));
    });
    await assert.rejects(repository.current(), denied('denied'));
    await assert.rejects(lease.revalidate(), denied('denied')); assert.equal(f.writes, 0);
    const nonSaas = make(seed); nonSaas.isSaasAdmin = false;
    await assert.rejects(nonSaas.change('Op-D', 'stopped', 3), denied('denied')); assert.equal(nonSaas.queries.length, 0);
    const changed = make(seed); changed.currentActor = { ...actor, subjectId: 'another' };
    await assert.rejects(changed.change('Op-D', 'stopped', 3), denied('denied')); assert.equal(changed.queries.length, 0);
    for (const audience of ['staff', 'client']) {
      const other = make(seed);
      await assert.rejects(other.change('Op-D', 'stopped', 3, coreId, { ...actor, audience }), denied('denied'));
      assert.equal(other.transactions, 0);
    }
    const final = make(seed); final.config.afterAuditActor = { ...actor, subjectId: 'switched-before-commit' };
    await assert.rejects(final.change('Op-D', 'stopped', 3), denied('denied'));
    assert.deepEqual(final.rows, seed); assert.equal(final.logs.length, 0);
  });
  await check('并发首次登记沿父Tenant串行，第二个旧修订不能覆盖', async () => {
    const f = make(), results = await Promise.allSettled([f.change('one', 'accepting', 0), f.change('two', 'stopped', 0)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert(denied('revision_conflict')(results.find(item => item.status === 'rejected').reason));
    assert.equal(f.rows.length, 2); assert.equal(f.logs.length, 1);
  });
  await check('业务S锁持到原提交，管理X锁等待；其他Core保持独立', async () => {
    const f = make(seed); let finish, entered, writing = false;
    const ready = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { finish = resolve; });
    const reading = f.read(async reader => { await reader.requireAccepting(coreId); entered(); await pending; });
    await ready;
    const stopping = f.change('stop-after-business', 'stopped', 3).then(value => { writing = true; return value; });
    let beforeRelease;
    try {
      await Promise.resolve(); await Promise.resolve(); assert.equal(writing, false);
      assert(!f.trace.includes('canonical:X'));
      const other = await f.read(reader => reader.readCurrent(otherCoreId)); assert.equal(other.state, 'unknown');
      beforeRelease = f.trace.length;
    } finally { finish(); await reading; await stopping; }
    const releaseTrace = f.trace.slice(beforeRelease);
    assert(releaseTrace.indexOf('commit') >= 0 && releaseTrace.indexOf('commit') < releaseTrace.indexOf('canonical:X'));
    await assert.rejects(f.read(reader => reader.requireAccepting(coreId)), denied('core_unavailable'));
  });
  await check('COMMIT应答丢失后只核原收据，不自动重发或重复审计', async () => {
    const f = make(); f.config.commitLost = true;
    await assert.rejects(f.change('commit-unknown', 'stopped', 0), /acknowledgement lost/);
    assert.equal(f.transactions, 1); assert.equal(f.rows.length, 2); const writes = f.writes;
    const original = await f.service.readOperation(actor, { coreId, operationId: 'commit-unknown' });
    assert.equal(original.status, 'recorded'); assert.equal(original.admission.state, 'stopped');
    assert.equal(f.writes, writes); assert.equal(f.audits, 1);
  });
  await check('真实公共主体→部署组合→Controller：当前SaaS/会话/角色、锁序、审计回滚及HTTP收据', async () => {
    const makePlatform = rows => platformFixture(api, CoreDeploymentAdmissionService, platform, rows);
    const http = (status, code) => error => error.getStatus?.() === status
      && (code === undefined || error.getResponse().code === code);
    const change = (operationId, state = 'stopped', expectedRevision = 0) => ({ coreId, operationId, state, expectedRevision });
    const calls = [['changeAdmission', change('new')], ['readAdmission', { coreId }],
      ['readAdmissionOperation', { coreId, operationId: 'new' }]];
    const invalid = makePlatform();
    for (const [method, body] of calls) {
      await assert.rejects(invalid.invoke(method, { ...body, tenantId: 'body-cannot-authorize' }), http(400, 'input_invalid'));
      const missing = new platform.CoreManagementController({});
      await assert.rejects(missing[method](body), http(503, 'core_unavailable'));
    }
    assert.equal(invalid.transactions, 0);
    const f = makePlatform(), first = await f.invoke('changeAdmission', change('first', 'accepting'));
    assert.deepEqual(first, { coreId, operationId: 'first', state: 'accepting', revision: 1 });
    assert.equal(f.transactions, 1); assert.equal(f.rows.length, 2); assert.equal(f.logs.length, 1);
    const ordered = ['principal:Tenant:tenant_platform', 'principal:User', 'principal:Session', 'principal:UserRole',
      'principal:Role', 'principal:RolePermission', 'principal:Permission', 'read:session', 'read:user', 'canonical:X',
      'canonical:insert', 'archive:insert', 'operation-log:insert'];
    assert(ordered.every((event, index) => f.trace.indexOf(event) >= 0
      && (index === 0 || f.trace.indexOf(ordered[index - 1]) < f.trace.indexOf(event))), '原平台父行/身份锁必须先于canonical和审计');
    assert.deepEqual(f.trace.slice(f.trace.indexOf('operation-log:insert') + 1), ['read:session', 'read:user', 'commit']);
    assert.equal(f.logs[0].detail.targetId, coreId);
    assert.deepEqual(f.logs[0].detail.metadata, { operationId: 'first', revision: 1, actorTenantId: actor.tenantId,
      state: 'accepting', fingerprint: f.rows[1].content.fingerprint });
    assert.deepEqual(await f.invoke('readAdmission', { coreId }), first);
    const stopped = await f.invoke('changeAdmission', change('stop', 'stopped', 1));
    assert.deepEqual(await f.invoke('readAdmission', { coreId }), stopped);
    const writes = f.writes, auditCount = f.logs.length;
    assert.deepEqual(await f.invoke('readAdmissionOperation', { coreId, operationId: 'first' }), { status: 'recorded', admission: first });
    assert.deepEqual(await f.invoke('changeAdmission', change('first', 'accepting')), first);
    assert.deepEqual(await f.invoke('readAdmissionOperation', { coreId, operationId: 'missing' }), { status: 'unavailable' });
    assert.equal(f.writes, writes); assert.equal(f.logs.length, auditCount);
    await assert.rejects(f.invoke('changeAdmission', change('stale', 'accepting')), http(409, 'revision_conflict'));
    await assert.rejects(f.invoke('changeAdmission', change('first')), http(409, 'operation_conflict'));
    const unavailable = makePlatform(f.rows); unavailable.rows[0].content = { coreId, state: 'broken' };
    await assert.rejects(unavailable.invoke('readAdmission', { coreId }), http(503, 'core_unavailable'));
    assert.equal(unavailable.writes, 0);
    // ALS仍带旧权限，生产权威必须以同事务当前会话/原角色投影为准。
    for (const [mutate, status] of [
      [auth => { auth.user.isSaasAdmin = false; }, 403],
      [auth => { auth.role.isActive = false; }, 403],
      [auth => { auth.role.permissions = []; }, 403],
      [auth => { auth.session.revokedAt = new Date(); }, 401],
      [auth => { auth.session.currentWorkspaceId = 'switched'; }, 401]
    ]) {
      const rejected = makePlatform(f.rows); mutate(rejected.auth);
      for (const [method, body] of calls) await assert.rejects(rejected.invoke(method, body), http(status));
      assert.equal(rejected.writes, 0); assert.equal(rejected.logs.length, 0);
      assert.equal(rejected.trace.includes('canonical:X'), false);
    }
    await assert.rejects(f.invoke('readAdmission', { coreId }, {}), http(401));
    for (const [configure, expected] of [
      [current => { current.config.operationLogFailure = true; }, /offline-operation-log-failure/u],
      [current => { current.config.afterOperationLog = auth => { auth.role.isActive = false; }; }, http(403, 'denied')],
      [current => { current.config.afterOperationLog = auth => { auth.session.revokedAt = new Date(); }; }, http(401)]
    ]) {
      const rollback = makePlatform(f.rows), beforeRows = structuredClone(rollback.rows); configure(rollback);
      await assert.rejects(rollback.invoke('changeAdmission', change('rollback', 'accepting', 2)), expected);
      assert(rollback.trace.includes('canonical:update') && rollback.trace.includes('archive:insert')
        && rollback.trace.includes('operation-log:insert'));
      assert.deepEqual(rollback.rows, beforeRows); assert.equal(rollback.logs.length, 0);
      assert.equal(rollback.trace.includes('commit'), false);
    }
  });
  await check('真实CoreBindingService只在首次初始化取得准入；停新后原收据/已有绑定不重取', async () => {
    const range = { minInclusive: '0.1.0', maxExclusive: '0.2.0' };
    const manifest = cc.CoreManifestSchema.parse({ manifestVersion: 1, id: coreId, name: '测试Core', description: '绑定准入测试',
      author: 'offline', version: '0.1.0', source: { repository: 'https://github.com/example/offline', commit: 'a'.repeat(40) },
      license: 'MIT', compatibility: { platform: range, contract: range },
      runtime: { node: { minInclusive: '22.0.0', maxExclusive: '23.0.0' } }, entries: { server: 'dist/server.js' },
      permissions: [], scope: { kind: 'tenant' }, data: { version: '0.1.0', readable: range, migrations: [] }, requires: [] });
    const f = make(seed), state = { binding: undefined, receipts: [], initializations: 0 };
    let admissionCalls = 0, mutationCalls = 0, active;
    const access = new platform.PlatformCoreAccess({}, {});
    // 该窄执行夹具仅隔离业务绑定存储；初始化分支及准入SQL分别沿原Service和PlatformCoreAccess。
    const execution = { run(request, work) {
      assert.deepEqual(request.actor, actor); assert.deepEqual(request.scope, { tenantId: actor.tenantId, coreId });
      return f.client.$transaction(async tx => {
        const pending = structuredClone(state), handle = Object.freeze({});
        const lease = { actor, scope: request.scope, canInitialize: request.purpose === 'initialize',
          canReadOriginal: request.purpose === 'original_receipt',
          async beforeMutation() { mutationCalls++; },
          async beforeInitialization() { admissionCalls++; await access.requireBusinessAdmission(tx, request.scope.coreId); },
          async revalidate() { if (f.config.revoked) throw new CoreAccessError('denied', '原绑定租约已撤销'); } };
        active = { pending, handle };
        try {
          const result = await work({
            async binding() { return pending.binding; },
            async saveBinding(binding) { pending.binding = structuredClone(binding); },
            async receipt(operationId) { return pending.receipts.find(row => row.operation.operationId === operationId); },
            async saveReceipt(receipt) { pending.receipts.push(structuredClone(receipt)); }
          }, lease, handle);
          await lease.revalidate(); Object.assign(state, pending); return result;
        } finally { active = undefined; }
      }, { isolationLevel: 'ReadCommitted' });
    } };
    const registration = { manifest, server: { coreId, implementationVersion: manifest.version, initialization: {
      async initialize(context) { assert.equal(context.transaction, active.handle); active.pending.initializations++; }
    } } };
    const binding = new CoreBindingService(execution, new Map([[coreId, registration]]), {
      async requireAvailable(target, tenantId) { assert.equal(target, coreId); assert.equal(tenantId, actor.tenantId); }
    });
    const input = { coreId, operationId: 'initialize', expectedRevision: 0 };
    for (const stateName of ['stopped', 'unknown']) {
      f.rows[0].content = stateName === 'unknown' ? {} : { ...seed[0].content, state: stateName };
      await assert.rejects(binding.bind(actor, input), denied('core_unavailable'));
      assert.equal(state.binding, undefined); assert.equal(state.receipts.length, 0); assert.equal(state.initializations, 0);
    }
    f.rows[0].content = structuredClone(seed[0].content);
    const first = await binding.bind(actor, input);
    assert.equal(state.initializations, 1); assert.deepEqual(state.binding, first); assert.equal(state.receipts.length, 1);
    assert.equal(admissionCalls, 3);
    f.rows[0].content = { ...seed[0].content, state: 'stopped' };
    const queryCount = f.queries.length, mutations = mutationCalls;
    assert.deepEqual(await binding.bind(actor, input), first);
    const receipt = await binding.readOperation(actor, { coreId, operationId: 'initialize' });
    assert.equal(receipt.status, 'recorded'); assert.deepEqual(receipt.binding, first);
    assert.equal(mutationCalls, mutations, '原收据不重新进入初始化来源或准入');
    assert.deepEqual(await binding.bind(actor, { coreId, operationId: 'reuse', expectedRevision: 1 }), first);
    assert.equal(mutationCalls, mutations + 1); assert.equal(state.receipts.length, 2);
    assert.equal(admissionCalls, 3); assert.equal(f.queries.length, queryCount); assert.equal(state.initializations, 1);
    const beforeState = structuredClone(state); f.config.revoked = true;
    await assert.rejects(binding.bind(actor, { coreId, operationId: 'revoked-reuse', expectedRevision: 1 }), denied('denied'));
    assert.deepEqual(state, beforeState, '已有绑定不重取新准入，但原租约复验仍须成立');
  });
  assert.deepEqual(sourceHashes(), before, '编译与行为验证期间service/SQL源码不能漂移');
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ groups, builds: build.stages.length, emittedFiles: build.outputs.size, sourceHashes: before,
    database: 'not-connected', diskOutputs: 0, defaultClient: 'not-loaded' }));
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  assert.equal(fs.existsSync(temporary), false, '该用例只允许内存产物，不得遗留磁盘目录');
});
