const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const user = permissions => ({ id: 'operator-id', tenantId: 't', displayName: 'Display name', permissions, isPlatformAdmin: false });

function inspectionFixture(stage) {
  const old = { id: 'first', stage }, original = { id: 'original', stage };
  const current = { id: 'o', status: 'completed', fulfillmentMode: 'pickup', ruleSnapshot: { fulfillment: { evidenceRequired: false } } };
  const controller = Object.create(RentalCoreController.prototype);
  controller.context = async () => ({});
  controller.service = { getOrder: async () => current,
    listInspectionTemplates: async () => [{ id: 'template', stage, fields: [] }],
    listInspections: async () => [original, old] };
  controller.business = { effectiveRuleAt: () => ({ config: { fulfillment: { evidenceRequired: false } } }),
    assertPickupOpenAt: async () => undefined, refreshFromDatabase: async () => undefined };
  controller.idempotent = { executeWithReplayFlag: async input => ({ replayed: true,
    result: await input.replay({ inspection: { id: original.id } }) }) };
  controller.committed = async (_tenant, result) => result;
  return { controller, original, current };
}

test('trusted inspection template stage requires the corresponding handover permission', async () => {
  for (const [stage, permissions] of [['return', ['rental-os:order:pickup']], ['pickup', ['rental-os:order:return']]]) {
    const { controller } = inspectionFixture(stage);
    await assert.rejects(controller.createInspection({ user: user(permissions), headers: {} }, 'o', { templateId: 'template', results: {} }), error => error.status === 403);
  }
  const { controller } = inspectionFixture('return');
  await assert.rejects(controller.createInspection({ user: user(['rental-os:order:operate']), headers: {} }, 'o', { templateId: 'missing', results: {} }), error => error.status === 400);
  await assert.rejects(controller.handover({ user: user(['rental-os:order:pickup']), headers: {} }, 'o', 'return'), error => error.status === 403);
});

test('inspection replay reads the exact original record even after the order advances', async () => {
  const { controller, original, current } = inspectionFixture('return');
  const result = await controller.createInspection({ user: user(['rental-os:order:return']), headers: {} }, 'o', { templateId: 'template', results: {} });
  assert.equal(result.inspection.id, original.id);
  assert.equal(result.order, current);
});

test('restricted quotation scope uses fulfillmentLocationId and still checks the return location', async () => {
  const guard = new ApiAuthGuard({}, undefined, undefined, undefined, {});
  const scoped = { ...user(['rental-os:order:create']), dataScope: 'store' };
  const call = body => guard.assertStaffLocationAccess({ method: 'POST', body, query: {} }, '/rental/v1/quotes', scoped, 'w', { mode: 'selected', locationIds: ['allowed'] });
  await call({ fulfillmentLocationId: 'allowed', returnLocationId: 'allowed' });
  await assert.rejects(call({ locationId: 'allowed' }), error => error.status === 403);
  await assert.rejects(call({ fulfillmentLocationId: 'allowed', returnLocationId: 'other' }), error => error.status === 403);
});

test('prepared order ownership comes only from the authenticated principal', async () => {
  const location = { id: 'location', name: 'Location' };
  const group = { id: 'group', code: 'GROUP', name: 'Group', inventoryMode: 'quantity', bundleComponents: [] };
  const service = Object.create(RentalCoreService.prototype);
  service.state = () => ({ profile: { categoryCode: 'camera' }, pricingGroups: [] });
  service.availability = async () => ({ available: true });
  service.resolveWorkspaceId = () => 'w';
  service.configStore = { readFulfillmentAdmission: require('./helpers/fulfillment-admission-fixture.cjs').fulfillmentAdmissionFixture('t', 'w', {
    locations: [{ ...location, status: 'enabled', capabilities: ['pickup', 'return'], operatorId: 'op' }],
    operators: [{ id: 'op', status: 'enabled', type: 'self_operated' }]
  }).read };
  service.validateFulfillmentSelection = () => ({ fulfillmentLocation: location, returnLocation: location });
  service.group = () => group;
  service.locationSnapshot = () => location;
  service.buildExceptionSnapshots = () => undefined;
  const input = { customerName: 'Customer', customerId: 'customer', customerType: 'personal', fulfillmentMode: 'pickup',
    fulfillmentLocationId: 'location', returnLocationId: 'location', startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-02T00:00:00Z',
    operator: 'forged-user-id', lines: [{ itemGroupId: 'group', quantity: 1 }] };
  const quote = { id: 'q', request: input, ruleSnapshot: { qualification: { required: false }, payment: { unpaidHoldMinutes: 15 } },
    inspectionTemplateSnapshots: [], chargeLines: [{ code: 'rental:GROUP', amount: 10 }], currency: 'CNY', payableAmount: 10 };
  const order = await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'authenticated-id' },
    () => service.prepareOrder('t', input, 'Display name', quote));
  assert.equal(order.createdBy, 'authenticated-id');
  await assert.rejects(runWithRequestIdentity({}, () => service.prepareOrder('t', input, 'Display name', quote)), error => error.status === 403);
});
