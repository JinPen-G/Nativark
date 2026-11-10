const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ClientAuthService } = require('../apps/api/src/modules/client/client-auth.service');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { CustomerOperationsService } = require('../apps/api/src/modules/platform/customer-operations.service');
const { PlatformService } = require('../apps/api/src/modules/platform/platform.service');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { hashPassword, verifyPassword } = require('../apps/api/src/common/password');

test('corporate reversal retains only original locators and refuses unavailable or corrupted recovery storage', () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const helper = {};
  const shared = {};
  const sharedSource = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/ai-native/settings-operation-reference.ts'), 'utf8');
  new Function('exports', ts.transpileModule(sharedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(shared);
  const source = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/membership/corporate-payment-reference.ts'), 'utf8');
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(helper, () => shared);
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const reference = { version: 1, scope: 'tenant/workspace/operator', customerId: 'company', paymentId: 'original-payment', key: 'original-reverse-key' };
  helper.retainCorporatePaymentReference(storage, reference);
  assert.deepEqual(helper.readCorporatePaymentReference(storage, reference.scope, reference.customerId).pending, reference);
  assert.throws(() => helper.retainCorporatePaymentReference(storage, { ...reference, key: 'another' }));
  assert.equal(helper.readCorporatePaymentReference(undefined, reference.scope, reference.customerId).blocked, true);
  assert.throws(() => helper.retainCorporatePaymentReference(undefined, reference));
  assert.equal(helper.matchesCorporatePaymentReversal(reference, null), false);
  assert.equal(helper.matchesCorporatePaymentReversal(reference, { customerId: 'company', paymentId: 'original-payment', idempotencyKey: 'other-winner' }), true);
  assert.equal(helper.matchesCorporatePaymentReversal(reference, { customerId: 'company', paymentId: 'another-payment' }), false);
  helper.clearCorporatePaymentReference(storage, reference); assert.equal(data.size, 0);
  data.set([...data.keys()][0] ?? `rental.corporate-payment-reversal.v1:${encodeURIComponent(reference.scope)}:${encodeURIComponent(reference.customerId)}`, JSON.stringify({ ...reference, reason: 'sensitive' }));
  assert.equal(helper.readCorporatePaymentReference(storage, reference.scope, reference.customerId).blocked, true);
  const page = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/membership/CorporateMembershipPage.tsx'), 'utf8');
  assert.match(page, /retainCorporatePaymentReference\(reversalStorage\(\), reference\)/);
  assert.match(page, /customerApi\.creditPaymentReversal\(reference.customerId, reference.paymentId\)/);
  assert.match(page, /ConfirmAction label=\{t\("冲销回款"\)\}/);
});

test('corporate credit input retains the revision from its own read instead of a refreshed query', () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const helperSource = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/membership/corporate-credit-draft.ts'), 'utf8');
  const exported = {};
  new Function('exports', ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exported);
  const { bindCorporateCreditDraft, corporateCreditDraftChanged, prepareCorporateCreditDraft } = exported;
  const original = { customerId: 'company-a', revision: 3 }, refreshed = { customerId: 'company-a', revision: 4 };
  const baseline = bindCorporateCreditDraft('session-a', 'company-a', original);
  assert.equal(corporateCreditDraftChanged(baseline, refreshed), true);
  const command = prepareCorporateCreditDraft(baseline, 'session-a', 'company-a', { creditLimit: 100,
    settlementTermDays: 30, reason: 'original draft', expectedRevision: 4 });
  assert.equal(command.input.expectedRevision, 3, 'new query or form field cannot rebase old draft');
  assert.throws(() => prepareCorporateCreditDraft(baseline, 'session-b', 'company-a', command.input));
  assert.throws(() => prepareCorporateCreditDraft(baseline, 'session-a', 'company-b', command.input));
  assert.throws(() => prepareCorporateCreditDraft(undefined, 'session-a', 'company-a', command.input));
  const reload = bindCorporateCreditDraft('session-a', 'company-a', refreshed);
  assert.equal(prepareCorporateCreditDraft(reload, 'session-a', 'company-a', command.input).input.expectedRevision, 4);
  const newRecord = bindCorporateCreditDraft('session-a', 'company-a', null);
  assert.equal('expectedRevision' in prepareCorporateCreditDraft(newRecord, 'session-a', 'company-a', command.input).input, false);
  assert.equal(corporateCreditDraftChanged(newRecord, original), true);
  assert.throws(() => bindCorporateCreditDraft('session-a', 'company-a', { ...original, customerId: 'other' }));
  const source = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/membership/CorporateMembershipPage.tsx'), 'utf8');
  assert.doesNotMatch(source, /expectedRevision:\s*creditConfig\.data\?\.revision/);
  assert.match(source, /onSave=\{saveCreditDraft\}/);
  assert.match(source, /command\.scope !== currentCreditScope\(\)/);
  assert.match(source, /creditBaseline\?\.scope === creditScope && creditBaseline.customerId === selected.customerId\) return/);
});

const unauthorized = error => error?.status === 401;
const forbidden = error => error?.status === 403;

test('operator and staff tokens must match current session workspace, including switch requests', async () => {
  for (const audience of ['operator', 'staff']) {
    const service = Object.create(AuthService.prototype);
    let payload = { sid: 's', sub: 'u', tid: 't', wid: 'a', aud: audience }, scopedReads = 0, writes = 0;
    const session = { userId: 'u', currentWorkspaceId: 'b', audience };
    const user = { id: 'u', tenantId: 't', isActive: true };
    service.verifyAccessToken = () => payload;
    service.platformService = { getAuthSession: async () => session, findUserById: async () => user,
      findWorkspaceScopedUser: async (_u, wid) => { scopedReads++; assert.equal(wid, 'b'); return user; },
      setSessionWorkspace: async () => { writes++; }, listUserWorkspaces: async () => [] };
    await assert.rejects(service.resolveAccessContext('Bearer old', { audience, allowInvalidWorkspace: true }), error => error.status === 409);
    await assert.rejects(service.switchWorkspace('Bearer old', 'c', audience), error => error.status === 409);
    assert.equal(scopedReads, 0); assert.equal(writes, 0);
    payload = { ...payload, wid: undefined };
    await assert.rejects(service.resolveAccessContext('Bearer old', { audience }), error => error.status === 409);
    payload = { ...payload, wid: 'b' };
    assert.equal((await service.resolveAccessContext('Bearer new', { audience })).workspaceId, 'b');
    session.currentWorkspaceId = null; payload = { ...payload, wid: undefined };
    service.platformService.findWorkspaceScopedUser = async () => undefined;
    const sharedOnly = await service.resolveAccessContext('Bearer shared', { audience, allowInvalidWorkspace: true });
    assert.equal(sharedOnly.user, user); assert.equal(sharedOnly.workspaceValid, false);
  }
});

test('administrator password reset and client-session revocation commit or roll back together', async () => {
  let account = { passwordHash: 'old', mustChangePassword: false }, revoked = false, failRevoke = false;
  const tx = { clientAuthSession: { updateMany: async ({ where }) => {
    assert.deepEqual(where, { tenantId: 't', customerId: 'c', revokedAt: null });
    if (failRevoke) throw Error('session write failed'); revoked = true; return { count: 2 };
  } } };
  const prisma = { $transaction: async work => {
    const before = structuredClone(account), beforeRevoked = revoked;
    try { return await work(tx); } catch (error) { account = before; revoked = beforeRevoked; throw error; }
  } };
  const service = Object.create(MembershipService.prototype);
  service.prisma = prisma; service.lockCustomer = async (_t, _c, client) => assert.equal(client, tx);
  service.requireMembership = async () => undefined; service.requireCustomer = async () => ({ phone: 'phone', phoneMasked: 'masked' });
  service.customers = { upsertAccountCredentials: async (input, client) => {
    assert.equal(client, tx); account = { ...account, passwordHash: input.passwordHash, mustChangePassword: input.mustChangePassword }; return account;
  } };
  failRevoke = true;
  await assert.rejects(service.setTemporaryPassword('t', 'c', 'FixturePass8'), /session write failed/);
  assert.equal(account.passwordHash, 'old'); assert.equal(revoked, false);
  failRevoke = false;
  await service.setTemporaryPassword('t', 'c', 'FixturePass8');
  assert.equal(account.mustChangePassword, true); assert.equal(revoked, true);
});

function clientFixture() {
  const now = Date.now(), session = { id: 's', tenantId: 't', customerId: 'c', workspaceId: 'w',
    createdAt: new Date(now), expiresAt: new Date(now + 60000), revokedAt: null,
    tenant: { status: 'ACTIVE', code: 'T' }, customer: { name: 'Customer', customerType: 'personal', phone: 'masked' },
    workspace: { id: 'w', tenantId: 't', status: 'ACTIVE', code: 'W', name: 'Workspace', categoryCode: 'camera' } };
  const account = { id: 'account', status: 'active', mustChangePassword: false, passwordHash: hashPassword('FixturePass8'),
    passwordUpdatedAt: new Date(now - 1000), customer: { status: 'active' } };
  let created = 0;
  const tx = { $queryRaw: async query => { assert.match(query.sql, /customer_profiles.*FOR UPDATE/); return [{ id: 'c' }]; },
    customerAccount: { findFirst: async () => account, updateMany: async ({ data }) => { Object.assign(account, data); return { count: 1 }; } },
    clientAuthSession: { findFirst: async () => session.revokedAt ? null : session, findUnique: async () => session,
      updateMany: async ({ where, data }) => {
        if (where.id && session.revokedAt) return { count: 0 };
        Object.assign(session, data); return { count: 1 };
      }, create: async () => { created++; return {}; } },
    customerMembership: { findFirst: async () => ({ status: 'active' }), findUnique: async () => ({ status: 'active' }) },
    customerProfile: { findFirst: async () => ({ id: 'c', customerType: 'personal', status: 'active', name: 'Customer', phone: 'masked' }) },
    businessWorkspace: { findFirst: async () => session.workspace }, clientWechatIdentity: { count: async () => 0 } };
  const prisma = { ...tx, $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'ReadCommitted'); return work(tx); } };
  const service = new ClientAuthService(prisma, {});
  service.parse = () => ({ sid: 's', sub: 'c', tid: 't', wid: 'w' });
  service.sign = () => 'fixture-not-a-real-token'; service.workspaceRows = async () => [];
  return { service, account, session, tx, created: () => created };
}

test('old customer sessions fail after password change and temporary sessions only allow exact change-password recovery', async () => {
  const { service, account, session } = clientFixture();
  account.passwordUpdatedAt = new Date(session.createdAt.getTime() + 1);
  await assert.rejects(service.authenticate('fixture'), unauthorized);
  await assert.rejects(service.refresh('fixture'), unauthorized);
  account.passwordUpdatedAt = new Date(session.createdAt.getTime() - 1); account.mustChangePassword = true;
  await assert.rejects(service.authenticate('fixture'), forbidden);
  await assert.rejects(service.authenticate('fixture', { method: 'POST', path: '/client/v1/orders' }), forbidden);
  await assert.rejects(service.authenticate('fixture', { method: 'GET', path: '/client/v1/auth/change-password' }), forbidden);
  const context = await service.authenticate('fixture', { method: 'POST', path: '/client/v1/auth/change-password' });
  assert.equal(context.customerId, 'c');
  await assert.rejects(service.changePassword(context, 'FixturePass8', 'FixturePass8'), error => error.status === 400);
  await service.changePassword(context, 'FixturePass8', 'NewFixturePass9');
  assert.equal(account.mustChangePassword, false); assert.equal(verifyPassword(account.passwordHash, 'NewFixturePass9'), true);
  assert.ok(session.revokedAt); await assert.rejects(service.authenticate('fixture'), unauthorized);
});

test('credential issuance rechecks the verified password under the reset lock', async () => {
  const { service, account, created } = clientFixture();
  const verifiedHash = account.passwordHash; account.passwordHash = hashPassword('ChangedFixture9');
  await assert.rejects(service.issueSession('t', 'c', 'w', undefined, undefined, verifiedHash), unauthorized);
  assert.equal(created(), 0);
  await service.issueSession('t', 'c', 'w', undefined, undefined, account.passwordHash);
  assert.equal(created(), 1);
});

test('reset racing with refresh cannot mint a new session after revocation', async () => {
  const { service, account, tx, created } = clientFixture();
  const currentHash = account.passwordHash;
  const read = tx.customerAccount.findFirst;
  let reads = 0;
  tx.customerAccount.findFirst = async () => {
    if (++reads === 1) return { ...account, passwordHash: currentHash };
    account.passwordHash = hashPassword('ResetFixturePass9'); return read();
  };
  service.prisma.customerAccount = tx.customerAccount;
  await assert.rejects(service.refresh('fixture-refresh'), unauthorized);
  assert.equal(created(), 0);
});

test('logout revokes only the session proved by the original refresh token without an access token', async () => {
  const guard = new ApiAuthGuard({ resolveAccessContext: async () => { throw Error('access token already cleared'); } });
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/auth/logout', headers: {} }) }) }), true);
  let revoked;
  const service = Object.create(AuthService.prototype);
  service.platformService = { getAuthSessionByRefreshHash: async () => ({ id: 'original', audience: 'operator' }),
    revokeAuthSession: async id => { revoked = id; } };
  assert.deepEqual(await service.logout({ refreshToken: 'fixture-refresh' }), { loggedOut: true });
  assert.equal(revoked, 'original'); revoked = undefined;
  await service.logout({ refreshToken: 'fixture-refresh' }, 'staff'); assert.equal(revoked, undefined);
});

test('customer operational overview rejects tenant-only or mismatched identity and keeps legitimate restricted partitions', async () => {
  const permissions = ['rental-os:member:view', 'rental-os:order:view', 'rental-os:marketing:manage', 'rental-os:finance:view'];
  const user = { id: 'u', tenantId: 't', isActive: true, permissions, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
  const platform = Object.create(PlatformService.prototype);
  platform.requireWorkspaceDataSource = () => undefined;
  platform.findWorkspaceScopedUser = async () => undefined;
  platform.requireCustomerOperations = () => { throw Error('business must not be read'); };
  await runWithRequestIdentity({ tenantId: 't', userId: 'u', workspaceId: 'w', dataScope: 'all' }, async () => {
    await assert.rejects(platform.getCustomerProfileOverview('c', {}, user), forbidden);
    for (const scoped of [{ ...user, isActive: false }, { ...user, tenantId: 'other' }]) {
      platform.findWorkspaceScopedUser = async () => scoped;
      await assert.rejects(platform.getCustomerProfileOverview('c', {}, user), forbidden);
    }
  });
  const service = Object.create(CustomerOperationsService.prototype);
  service.getCustomerDetail = async () => { throw Error('authorized read reached'); };
  await runWithRequestIdentity({ tenantId: 't', userId: 'u', workspaceId: 'w', dataScope: 'all' }, async () => {
    await assert.rejects(service.getProfileOverview('t', 'w', 'c', { ...user, permissions: ['rental-os:member:view'] }), /authorized read reached/);
    await assert.rejects(service.getProfileOverview('t', 'w', 'c', { ...user, dataScope: 'own' }), forbidden);
    await assert.rejects(service.getProfileOverview('t', 'w', 'c', user), /authorized read reached/);
  });
  await runWithRequestIdentity({ tenantId: 't', userId: 'u', workspaceId: 'w', dataScope: 'all', locationScope: { mode: 'selected', locationIds: ['loc'] } }, () =>
    assert.rejects(service.getProfileOverview('t', 'w', 'c', user), /authorized read reached/));
});

test('customer profile partitions retain visible orders without financial facts and never query restricted ledgers', async () => {
  const calls = [], now = new Date(0);
  const user = { id: 'u', tenantId: 't', isActive: true, permissions: ['rental-os:member:view', 'rental-os:order:view'], dataScope: 'own',
    locationScope: { mode: 'selected', locationIds: ['loc'] } };
  const profile = { id: 'c', tenantId: 't', customerType: 'personal', name: 'Customer', phoneMasked: '***', status: 'active' };
  const service = Object.create(CustomerOperationsService.prototype);
  const visibility = [];
  service.customers = { findById: async (tenant, customer) => {
    assert.equal(tenant, 't'); assert.equal(customer, 'c'); return profile;
  } };
  const rows = [];
  service.prisma = {
    customerDeliveryAddress: { findMany: async () => [] }, customerMembershipPlanAssignment: { findMany: async () => [] },
    customerCorporateMembership: { findMany: async () => [] },
    customerQualificationRevision: { findMany: async () => { throw Error('restricted qualification read'); } },
    rentalBenefitAccount: { findMany: async () => { throw Error('restricted financial ledger read'); } },
    rentalRewardLedgerEntry: { findMany: async () => { throw Error('restricted reward read'); } },
    rentalCustomerCoupon: { findMany: async () => { throw Error('restricted coupon read'); } },
    rentalOrder: {
      findFirst: async ({ where }) => {
        visibility.push(where);
        return where.tenantId === 't' && where.workspaceId === 'w'
          && where.AND[0].OR[0].fulfillmentLocationId.in.includes('loc') ? { id: 'visible-order' } : null;
      },
      count: async ({ where }) => { calls.push(['count', where]); return rows.length; },
      findMany: async query => { calls.push(['orders', query]); return rows; }
    }
  };
  service.operations = { recordSensitiveAccess: async (_tenant, input) => { assert.equal(input.revealed, false); },
    listStatusHistory: async () => { throw Error('restricted status audit'); },
    listSensitiveAccess: async () => { throw Error('restricted sensitive audit'); } };
  const scope = { tenantId: 't', userId: 'u', workspaceId: 'w', dataScope: 'own', locationScope: { mode: 'selected', locationIds: ['loc'] },
    permissions: user.permissions };
  rows.push({ id: 'visible-order', orderNo: 'ORDER', workspaceId: 'w', categoryCode: 'camera', status: 'renting',
    customerId: 'c', membershipSnapshot: {}, startAt: now, endAt: now, createdAt: now,
    finalPayableAmount: 999, currency: 'CNY', workspace: { id: 'w', name: 'Workspace' } });
  const result = await runWithRequestIdentity(scope, () => service.getProfileOverview('t', 'w', 'c', user));
  assert.equal(result.profile.id, 'c'); assert.equal(result.orders.total, 1); assert.equal(result.orders.items[0].id, 'visible-order');
  assert.equal(visibility[0].workspaceId, 'w'); assert.equal(visibility[0].tenantId, 't');
  assert.deepEqual(visibility[0].AND[1].OR, [{ createdBy: 'u' }, { workOrders: { some: { OR: [{ createdBy: 'u' }, { assigneeId: 'u' }] } } }]);
  assert.equal(Object.hasOwn(result.orders.items[0], 'finalPayableAmount'), false, 'an ORM substitute returning extra fields cannot leak financial amount');
  assert.deepEqual(result.access, { orders: 'available', orderAmounts: 'restricted', benefits: 'restricted', qualifications: 'restricted', audit: 'restricted' });
  const query = calls.find(row => row[0] === 'orders')[1];
  assert.equal(query.select.finalPayableAmount, false);
  assert.equal(query.where.tenantId, 't'); assert.equal(query.where.workspaceId, 'w');
  assert.deepEqual(query.where.AND[0].OR, [{ fulfillmentLocationId: { in: ['loc'] } }, { returnLocationId: { in: ['loc'] } }]);
  assert.deepEqual(query.where.AND[1].OR, [{ createdBy: 'u' }, { workOrders: { some: { OR: [{ createdBy: 'u' }, { assigneeId: 'u' }] } } }]);
  calls.length = 0;
  const withFinance = { ...user, permissions: [...user.permissions, 'rental-os:finance:view'] };
  const financial = await runWithRequestIdentity({ ...scope, permissions: withFinance.permissions }, () => service.getProfileOverview('t', 'w', 'c', withFinance));
  assert.equal(financial.orders.items[0].finalPayableAmount, 999);
  assert.equal(financial.access.orderAmounts, 'available'); assert.equal(financial.access.benefits, 'restricted');
  calls.length = 0;
  const memberOnly = { ...user, permissions: ['rental-os:member:view'] };
  const restricted = await runWithRequestIdentity({ ...scope, permissions: memberOnly.permissions }, () => service.getProfileOverview('t', 'w', 'c', memberOnly));
  assert.equal(restricted.access.orders, 'restricted'); assert.deepEqual(calls, [], 'member-only profile must not query orders at all');
  assert.deepEqual(restricted.benefits, { accounts: [], rewards: [], coupons: [] });
  const { OPENAPI_COMPONENT_SCHEMAS: schemas, API_CONTRACT_OPERATIONS: operations } = require('../apps/api/src/contracts/openapi-document');
  assert.equal(operations.find(row => row.operationId === 'getCustomerProfileOverview').responseSchema, 'CustomerProfileOverview');
  assert.ok(schemas.CustomerProfileOverview.properties.access.properties.orderAmounts);
  assert.equal(schemas.CustomerProfileOverview.properties.orders.properties.items.items.required.includes('finalPayableAmount'), false);
  const sources = require('node:fs').readFileSync(require('node:path').join(__dirname, '../apps/admin/src/features/membership/CustomerProfileDetails.tsx'), 'utf8');
  for (const key of ['benefits', 'orders', 'qualifications', 'audit']) assert.ok(sources.includes(`access?.${key} === "restricted"`), `consumer preserves ${key} restriction`);
  await assert.rejects(runWithRequestIdentity({ ...scope, workspaceId: 'foreign' }, () => service.getProfileOverview('t', 'w', 'c', user)), forbidden);
  await assert.rejects(runWithRequestIdentity({ ...scope, userId: 'other' }, () => service.getProfileOverview('t', 'w', 'c', user)), forbidden);
  calls.length = 0;
  await assert.rejects(runWithRequestIdentity({ ...scope, locationScope: { mode: 'selected', locationIds: ['outside'] } }, () =>
    service.getProfileOverview('t', 'w', 'c', { ...user, locationScope: { mode: 'selected', locationIds: ['outside'] } })), error => error.status === 404);
  assert.deepEqual(calls, [], 'an invisible shared customer must fail before operational partitions are read');
});

test('client Guard passes only its matched server route to the temporary-password recovery gate', async () => {
  let received;
  const guard = new ApiAuthGuard({}, undefined, { authenticate: async (_token, route) => { received = route; throw Object.assign(Error('temporary'), { status: 403 }); } },
    { assertAllowed: async () => undefined });
  const request = { method: 'POST', url: '/api/client/v1/orders', headers: { authorization: 'Bearer fixture' },
    body: { path: '/client/v1/auth/change-password' } };
  await assert.rejects(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), forbidden);
  assert.deepEqual(received, { method: 'POST', path: '/client/v1/orders' });
});
