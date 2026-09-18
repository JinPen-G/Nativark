const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { resolveDedicatedTarget } = require('../scripts/ops/dedicated-env.cjs');
resolveDedicatedTarget(process.env.DATABASE_URL);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaClient } = require('@prisma/client');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { CustomerOperationsRepository } = require('../apps/api/src/modules/platform/customer-operations.repository');
const { CustomerOperationsService } = require('../apps/api/src/modules/platform/customer-operations.service');
const { SharedCustomerRepository } = require('../apps/api/src/modules/platform/shared-customer.repository');
const { ClientAuthService } = require('../apps/api/src/modules/client/client-auth.service');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { membershipBenefitScopeMatches } = require('../packages/shared/dist');
const prisma = new PrismaClient();
const operationsRepo = new CustomerOperationsRepository(prisma);
const memberships = new MembershipService(prisma, operationsRepo);
const operations = new CustomerOperationsService(prisma, new SharedCustomerRepository(prisma), operationsRepo);
const client = new ClientAuthService(prisma, { sendVerificationSms: async () => ({ configured: false }) });
const suffix = randomUUID().slice(0, 8);
const tenantId = `tm_${suffix}`, otherTenantId = `tm_other_${suffix}`;
const camera = `tm_camera_${suffix}`, camping = `tm_camping_${suffix}`, otherSpace = `tm_other_ws_${suffix}`;
const password = `Test!9${randomBytes(18).toString('hex')}`;
process.env.AUTH_TOKEN_SECRET ||= randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
let passed = 0;
const ok = label => { passed++; console.log(`PASS ${label}`); };
const inSpace = (workspaceId, work) => runWithRequestIdentity({ tenantId, workspaceId }, work);
async function cleanup() {
  await prisma.clientRegistrationChallenge.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.customerQualificationRevision.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.customerMembershipReview.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.customerMembershipPlanAssignment.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
}
(async () => {
  await prisma.tenant.create({ data: { id: tenantId, code: tenantId, name: '统一会员专项租户' } });
  await prisma.tenant.create({ data: { id: otherTenantId, code: otherTenantId, name: '隔离对照租户' } });
  for (const [id, tid, code, categoryCode, isDefault] of [[camera, tenantId, 'camera', 'CAMERA', true], [camping, tenantId, 'camping', 'CAMPING', false], [otherSpace, otherTenantId, 'other', 'CAMERA', true]]) {
    await prisma.businessWorkspace.create({ data: { id, tenantId: tid, code, name: code, categoryCode, isDefault, defaultMarker: isDefault ? 'default' : id } });
  }
  const registration = { name: '统一测试会员', phone: '13900000001', channel: 'admin', idempotencyKey: `reg-${suffix}` };
  const first = await inSpace(camera, () => memberships.registerPersonal(tenantId, registration, 'tester'));
  const again = await inSpace(camping, () => memberships.registerPersonal(tenantId, registration, 'tester'));
  assert.equal(first.customerId, again.customerId);
  assert.equal(first.review.id, again.review.id);
  assert.equal(await prisma.customerMembership.count({ where: { tenantId, customerId: first.customerId } }), 1);
  assert.equal(await prisma.customerMembershipReview.count({ where: { tenantId, customerId: first.customerId } }), 1);
  ok('两个空间注册同一客户只产生一份会员和一个审核');
  await memberships.review(tenantId, first.review.id, { status: 'approved' }, 'reviewer', { registration: true, qualification: false });
  for (const workspaceId of [camera, camping]) {
    const identity = await memberships.resolveBookingIdentity(tenantId, workspaceId, first.customerId);
    assert.equal(identity.personalCustomerId, first.customerId);
    assert.equal((await operations.assertTransactable(tenantId, workspaceId, first.customerId)).allowed, true);
  }
  ok('审核一次后同一会员可在两个品类建立预约身份');
  const benefits = [
    { type: 'rental_discount', calculation: 'percentage', value: 10, scope: { type: 'categories', categoryCodes: ['camera'] } },
    { type: 'rental_discount', calculation: 'percentage', value: 15, scope: { type: 'categories', categoryCodes: ['camping'] } },
    { type: 'deposit_reduction', calculation: 'amount', value: 5, scope: { type: 'workspaces', workspaceIds: [camera] } }
  ];
  let plan = await memberships.savePlan(tenantId, { code: 'GOLD', name: '统一金卡', targetType: 'personal', levelRank: 2, benefits }, 'tester');
  const versionId = plan.currentVersion.id;
  await memberships.publishPlan(tenantId, plan.id, versionId, 'publisher');
  const assignment = await memberships.assignPlan(tenantId, { customerId: first.customerId, planId: plan.id, planVersionId: versionId, source: 'manual', reason: '专项授予', effectiveTo: '2099-01-01T00:00:00.000Z' }, 'tester');
  const sourceSnapshot = JSON.stringify(assignment.snapshot);
  for (const workspaceId of [camera, camping]) {
    const resolved = await memberships.resolveBenefits(tenantId, workspaceId, first.customerId);
    assert.equal(resolved.personal.id, assignment.id);
  }
  assert.equal(membershipBenefitScopeMatches(benefits[0].scope, camera, 'camera'), true);
  assert.equal(membershipBenefitScopeMatches(benefits[0].scope, camping, 'camping'), false);
  assert.equal(membershipBenefitScopeMatches(benefits[1].scope, camping, 'camping'), true);
  assert.equal(membershipBenefitScopeMatches(benefits[2].scope, camping, 'camping'), false);
  ok('同一方案跨空间复用，摄影与露营权益按各自范围匹配');
  await assert.rejects(memberships.savePlan(tenantId, { code: 'BAD', name: '非法范围', targetType: 'personal', levelRank: 1, benefits: [{ ...benefits[2], scope: { type: 'workspaces', workspaceIds: [otherSpace] } }] }), /范围|租户|空间/);
  await assert.rejects(memberships.savePlan(tenantId, { code: 'EMPTY', name: '空范围', targetType: 'personal', levelRank: 1, benefits: [{ ...benefits[2], scope: { type: 'workspaces', workspaceIds: [] } }] }), /范围|空间|不能为空|至少/);
  await assert.rejects(memberships.resolveBookingIdentity(otherTenantId, otherSpace, first.customerId));
  assert.equal((await memberships.listPersonalMembers(otherTenantId)).length, 0);
  ok('跨租户客户和权益空间引用被拒绝');
  await memberships.savePlan(tenantId, { id: plan.id, code: 'GOLD', name: '新版金卡', targetType: 'personal', levelRank: 2, benefits: [{ ...benefits[0], value: 20, scope: { type: 'tenant' } }] }, 'editor');
  assert.equal(JSON.stringify((await memberships.listPlanAssignments(tenantId, first.customerId))[0].snapshot), sourceSnapshot);
  const updatedPlan = (await memberships.listPlans(tenantId)).find(row => row.id === plan.id);
  await memberships.publishPlan(tenantId, plan.id, updatedPlan.currentVersion.id, 'publisher');
  await memberships.restorePlanVersion(tenantId, plan.id, versionId, '验证范围恢复', 'tester');
  assert.equal(JSON.stringify((await memberships.listPlanAssignments(tenantId, first.customerId))[0].snapshot), sourceSnapshot);
  ok('方案编辑和恢复不改写已有授予快照');
  const corp = await memberships.saveCorporateMember(tenantId, { name: '统一企业', corporateName: '统一企业有限公司', phone: '13900000002' });
  const employee = await memberships.saveCorporateEmployee(tenantId, corp.customerId, { personalCustomerId: first.customerId, role: 'employee', reason: '专项' }, 'tester');
  for (const workspaceId of [camera, camping]) {
    const options = await memberships.listBookingOptions(tenantId, workspaceId, first.customerId);
    assert.equal(options.find(item => item.corporateCustomerId === corp.customerId).corporateMembershipId, employee.id);
  }
  ok('企业员工关系全租户唯一且跨空间复用');
  await operations.changeMembershipStatus(tenantId, first.customerId, { status: 'suspended', reason: '统一暂停测试' }, 'tester');
  await memberships.saveRegistrationSettings(tenantId, 'automatic');
  await memberships.registerPersonal(tenantId, registration, 'tester');
  for (const workspaceId of [camera, camping]) {
    assert.equal((await operations.assertTransactable(tenantId, workspaceId, first.customerId)).allowed, false);
    await assert.rejects(memberships.resolveBookingIdentity(tenantId, workspaceId, first.customerId));
  }
  ok('暂停作用于全部空间，重复注册不能绕过暂停');
  await operations.changeMembershipStatus(tenantId, first.customerId, { status: 'active', reason: '解除测试暂停' }, 'tester');
  const challenge = await client.createChallenge({ tenantCode: tenantId, method: 'sms', identifier: '13900000003', idempotencyKey: `otp-${suffix}` });
  assert.ok(challenge.developmentCode);
  const repeatedChallenge = await client.createChallenge({ tenantCode: tenantId, workspaceCode: 'camping', method: 'sms', identifier: '13900000003', idempotencyKey: `otp-${suffix}` });
  assert.equal(repeatedChallenge.challengeId, challenge.challengeId);
  const verified = await client.verifyChallenge({ challengeId: challenge.challengeId, code: challenge.developmentCode });
  const clientRegistration = { tenantCode: tenantId, workspaceCode: 'camping', name: '小程序统一会员', phone: '13900000003', password, verificationToken: verified.verificationToken, consent: { userAgreementVersion: 'test-v1', privacyPolicyVersion: 'test-v1', agreedAt: new Date().toISOString() }, idempotencyKey: `app-${suffix}` };
  const registered = await client.registerPersonal(clientRegistration);
  const replayed = await client.registerPersonal({ ...clientRegistration, workspaceCode: 'camera' });
  assert.equal(registered.customerId, replayed.customerId);
  const session = await client.login({ tenantCode: tenantId, loginIdentifier: '13900000003', password });
  const context = await client.authenticate(session.accessToken);
  const switched = await client.switchWorkspace(context, { workspaceCode: 'camping' });
  const nextContext = await client.authenticate(switched.accessToken);
  assert.equal(nextContext.customerId, registered.customerId);
  assert.equal(nextContext.workspaceId, camping);
  assert.equal(await prisma.customerMembership.count({ where: { tenantId, customerId: registered.customerId } }), 1);
  ok('验证码及注册按租户幂等，一次登录即可切换租赁品类');
  await operations.changeMembershipStatus(tenantId, registered.customerId, { status: 'suspended', reason: '客户端会员暂停' }, 'tester');
  assert.equal((await client.authenticate(switched.accessToken)).membershipStatus, 'suspended');
  assert.equal((await prisma.customerAccount.findUnique({ where: { tenantId_customerId: { tenantId, customerId: registered.customerId } } })).status, 'active');
  ok('会员暂停即时反映且不自动停用登录账号');
  const beforeReconnect = await memberships.listPersonalMembers(tenantId);
  await prisma.$disconnect();
  assert.deepEqual((await memberships.listPersonalMembers(tenantId)).map(row => row.customerId).sort(), beforeReconnect.map(row => row.customerId).sort());
  ok('数据库重连后统一会员与方案事实仍可读取');
  console.log(`Tenant membership DB tests passed: ${passed} groups`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await cleanup(); await prisma.$disconnect(); });
