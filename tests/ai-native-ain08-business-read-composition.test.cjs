'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });

const { composeAiBusinessReadFacts } = require('../apps/api/src/modules/ai-native/business-read-facts.composition');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');

function authorities() {
  const guard = { canActivate: async execution => {
    const request = execution.switchToHttp().getRequest();
    request.user = { id: 'operator-a', tenantId: 'tenant-a', isActive: true, isSaasAdmin: false, permissions: ['rental-os:order:view', 'rental-os:order:create'] };
    const { enterRequestIdentity } = require('../apps/api/src/common/request-identity');
    enterRequestIdentity({ tenantId: 'tenant-a', userId: 'operator-a', workspaceId: 'workspace-a', isSaasAdmin: false, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] }, staffApi: false });
    return true;
  } };
  const credentials = { current: async () => ({ authorization: 'Bearer synthetic', requestId: 'request-a', audience: 'operator' }) };
  return {
    business: new AiBusinessReadRouteAuthority(guard, credentials),
    order: new AiOrderRouteContextAuthority(guard, credentials, 'order-a')
  };
}

function core() {
  return {
    listItemGroupsPage: async () => ({ rows: [{ id: 'item-a', tenantId: 'tenant-a', categoryCode: 'camera', code: 'CAM-A', name: 'Camera', status: 'enabled', unit: 'day' }],
      truncated: false, nextCursor: null, source: 'persisted_workspace_configuration', configurationVersion: '1'.repeat(64) }),
    readAvailability: async (tenantId, input) => ({ available: true, locationId: input.locationId, startAt: input.startAt, endAt: input.endAt, lines: input.lines.map(line => ({ itemGroupId: line.itemGroupId, itemGroupCode: 'CAM-A', itemGroupName: 'Camera', inventoryMode: 'serialized', requestedQuantity: line.quantity, availableQuantity: line.quantity, available: true, reasons: [] })) }),
    getOrder: async () => ({ id: 'order-a', tenantId: 'tenant-a', orderNo: 'R-1', status: 'reserved', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', currency: 'CNY', rentalAmount: 100, serviceAmount: 0, discountAmount: 0, couponAmount: 0, depositAmount: 20, preAuthAmount: 20, finalPayableAmount: 100 })
  };
}

test('composition constructs real bounded read services and keeps unsupported reads unavailable', () => {
  const auth = authorities();
  const composed = composeAiBusinessReadFacts({ core: core(), memberships: { listPersonalOptions: async () => [] }, businessAuthority: auth.business, orderAuthority: auth.order });
  assert.equal(typeof composed.catalog.read, 'function');
  assert.equal(typeof composed.availability.read, 'function');
  assert.equal(typeof composed.membershipCandidates.read, 'function');
  assert.equal(typeof composed.order.read, 'function');
  assert.deepEqual(composed.readiness, { status: 'unavailable', code: 'AI_RESOURCE_UNAVAILABLE', reason: 'AIN-08 readiness projection requires a bounded diagnostic contract' });
  assert.deepEqual(composed.workbenchTodos, { status: 'unavailable', code: 'AI_RESOURCE_UNAVAILABLE', reason: 'AIN-08 workbench todo projection requires a bounded evidence contract' });
});

test('composition delegates to the real projections, not a fixture-owned result', async () => {
  const auth = authorities();
  const composed = composeAiBusinessReadFacts({ core: core(), memberships: { listPersonalOptions: async () => [] }, businessAuthority: auth.business, orderAuthority: auth.order });
  const catalog = await composed.catalog.read({ limit: 10 });
  assert.equal(catalog.items[0].id, 'item-a');
  assert.equal(catalog.scope.tenantId, 'tenant-a');
  const order = await composed.order.read();
  assert.equal(order.order.id, 'order-a');
  assert.equal(order.paymentEvidence, 'not_loaded');
});

test('the composed availability and membership readers preserve their bounded contracts', async () => {
  const auth = authorities();
  const composed = composeAiBusinessReadFacts({ core: core(), memberships: { listPersonalOptions: async () => { throw Error('unbounded member lookup must not run'); },
    listPersonalOptionsPage: async (_tenantId, query) => { assert.equal(query.limit, 10); return {
      rows: [{ customerId: 'customer-a', name: 'Customer A', phoneMasked: '138****0000', membershipStatus: 'active' }], truncated: false }; } }, businessAuthority: auth.business, orderAuthority: auth.order });
  const availability = await composed.availability.read({ locationId: 'location-a', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-02T00:00:00Z', lines: [{ itemGroupId: 'item-a', quantity: 1 }] });
  assert.equal(availability.result.available, true);
  assert.equal(availability.result.lines[0].requestedQuantity, 1);
  const candidates = await composed.membershipCandidates.read({ limit: 10 });
  assert.deepEqual(candidates.candidates, [{ customerId: 'customer-a', name: 'Customer A', phoneMasked: '138****0000', membershipStatus: 'active' }]);
});

for (const input of [
  {},
  { core: core(), memberships: {}, businessAuthority: authorities().business, orderAuthority: authorities().order },
  { core: core(), memberships: { listPersonalOptions: async () => [] }, businessAuthority: {}, orderAuthority: authorities().order },
  { core: core(), memberships: { listPersonalOptions: async () => [] }, businessAuthority: authorities().business, orderAuthority: {} }
]) test('missing composition dependency fails closed', () => {
  assert.throws(() => composeAiBusinessReadFacts(input), error => error instanceof ModelGatewayError && error.code === 'CONFIG_INVALID');
});
