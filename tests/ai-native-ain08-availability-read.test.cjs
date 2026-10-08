'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiAvailabilityReadFactsService } = require('../apps/api/src/modules/ai-native/availability-read-facts.service');
const input = { locationId: 'location-a', startAt: '2026-10-10T00:00:00Z', endAt: '2026-10-11T00:00:00Z', lines: [{ itemGroupId: 'group-a', quantity: 1 }] };
const context = { contractVersion: 'ain-c03-draft-1', requestId: 'req-avail', authorizedAt: '2026-10-05T00:00:00Z', audience: 'staff', actor: { kind: 'user', userId: 'user-avail' }, scope: { kind: 'workspace', tenantId: 'tenant-avail', workspaceId: 'workspace-avail' }, access: { permissions: ['rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'selected', locationIds: ['location-a'] } } };
const authority = value => ({ withRead: async (_kind, _input, read) => read(typeof value === 'function' ? value() : value) });
const output = { available: true, locationId: input.locationId, startAt: input.startAt, endAt: input.endAt, lines: [{ itemGroupId: 'group-a', itemGroupCode: 'camera-a', itemGroupName: 'Camera', inventoryMode: 'quantity', requestedQuantity: 1, availableQuantity: 2, available: true, reasons: [] }] };
test('availability projection delegates calculation to Core and preserves returned facts', async () => {
  let calls = 0; const service = new AiAvailabilityReadFactsService({ availability: async (tenantId, value) => { calls++; assert.equal(tenantId, 'tenant-avail'); assert.deepEqual(value, input); return output; } }, authority(context), () => new Date('2026-10-05T01:00:00Z'));
  const result = await service.read(input); assert.deepEqual(result.result, output); assert.equal(calls, 1);
});
test('selected location scope rejects before Core and projection does not reserve stock', async () => {
  let calls = 0; const service = new AiAvailabilityReadFactsService({ availability: async () => { calls++; return output; } }, authority({ ...context, access: { ...context.access, locationScope: { mode: 'selected', locationIds: [] } } }));
  await assert.rejects(() => service.read(input), error => error.code === 'FORBIDDEN'); assert.equal(calls, 0);
});

test('projection rejects a Core result that is not bound to the requested availability lines', async () => {
  const mismatched = { ...output, lines: [{ ...output.lines[0], itemGroupId: 'group-other', requestedQuantity: 99 }] };
  const service = new AiAvailabilityReadFactsService(
    { availability: async () => mismatched },
    authority(context)
  );
  await assert.rejects(() => service.read(input), error => error.code === 'INVALID_RESPONSE');
});
