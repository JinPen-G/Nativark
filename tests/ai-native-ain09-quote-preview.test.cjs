'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiQuotePreviewService } = require('../apps/api/src/modules/ai-native/quote-preview.service');

const scope = { kind: 'workspace', tenantId: 'tenant-quote', workspaceId: 'workspace-quote' };
const context = { contractVersion: 'ain-test', requestId: 'req-quote', authorizedAt: '2026-10-05T01:00:00.000Z', audience: 'operator', actor: { kind: 'user', userId: 'operator-quote' }, scope };
const input = { customerType: 'personal', customerId: 'customer-quote', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-quote', startAt: '2026-10-10T09:00:00+08:00', endAt: '2026-10-11T09:00:00+08:00', lines: [{ itemGroupId: 'group-quote', quantity: 2, pricingUnit: 'day_24h' }] };
const business = { profile: {}, category: {}, settings: {}, groups: [], couponTemplates: [], locations: [], operators: [] };
function quote() { return { id: 'quote-1', tenantId: scope.tenantId, quoteNo: 'RQ-1', request: input, chargeLines: [{ code: 'rental:camera', name: '租金', type: 'rental', amount: 200 }], rentalAmount: 200, discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 500, preAuthAmount: 0, payableAmount: 200, receivableAmount: 700, pricingPlanVersion: '3.0', priceVersionId: 'price-v3', priceVersion: '3', ruleVersion: '2.1', calendarVersion: '2026:v5', pricingContext: { timeZone: 'Asia/Shanghai' }, expiresAt: '2026-10-05T02:00:00.000Z', createdAt: '2026-10-05T01:00:00.000Z' }; }
const authority = { withQuote: async (value, consume) => { assert.deepEqual(value, input); return consume(context); } };

test('quote preview calls the formal Core pricing entry and exposes snapshot evidence without reserving inventory', async () => {
  let calls = 0;
  const service = new AiQuotePreviewService({ createQuote: async (tenantId, receivedContext, receivedInput) => { calls++; assert.equal(tenantId, scope.tenantId); assert.equal(receivedContext, business); assert.deepEqual(receivedInput, input); return quote(); } }, { current: async receivedScope => { assert.deepEqual(receivedScope, scope); return business; } }, authority, () => new Date('2026-10-05T01:30:00.000Z'));
  const result = await service.preview(input);
  assert.equal(result.status, 'quoted'); assert.equal(result.quote.reservation, 'not_reserved'); assert.equal(result.quote.priceVersionId, 'price-v3'); assert.equal(result.quote.timeZone, 'Asia/Shanghai'); assert.equal(calls, 1);
});

test('invalid or model-shaped fields are rejected before authority/Core', async () => {
  let calls = 0;
  const service = new AiQuotePreviewService({ createQuote: async () => { calls++; throw new Error('must not call'); } }, { current: async () => business }, { withQuote: async () => { calls++; throw new Error('must not authorize'); } }, () => new Date('2026-10-05T01:30:00.000Z'));
  const result = await service.preview({ ...input, lines: [{ ...input.lines[0], amount: 1, itemGroupId: undefined }] });
  assert.equal(result.status, 'missing_input'); assert.ok(result.missingFields.includes('lines.0.itemGroupId')); assert.equal(calls, 0);
});

test('Core failures are classified without leaking raw exceptions or claiming success', async () => {
  const service = new AiQuotePreviewService({ createQuote: async () => { throw new Error('当前库存没有可用的承接产品型号'); } }, { current: async () => business }, authority, () => new Date('2026-10-05T01:30:00.000Z'));
  const result = await service.preview(input);
  assert.equal(result.status, 'out_of_stock'); assert.equal(result.message, 'Core 未能生成报价；请核对输入或转人工处理'); assert.equal(result.quote, undefined);
});

test('expired Core quote is not presented as a usable quote', async () => {
  const service = new AiQuotePreviewService({ createQuote: async () => ({ ...quote(), expiresAt: '2026-10-05T01:29:00.000Z' }) }, { current: async () => business }, authority, () => new Date('2026-10-05T01:30:00.000Z'));
  const result = await service.preview(input);
  assert.equal(result.status, 'expired'); assert.equal(result.quote, undefined);
});

test('a Core quote for a different request is not returned as the current quote', async () => {
  const service = new AiQuotePreviewService({ createQuote: async () => ({ ...quote(), request: { ...input, endAt: '2026-10-12T09:00:00+08:00' } }) }, { current: async () => business }, authority, () => new Date('2026-10-05T01:30:00.000Z'));
  await assert.rejects(() => service.preview(input), error => error.code === 'INVALID_RESPONSE');
});

for (const field of ['rentalAmount', 'payableAmount', 'receivableAmount']) test(`invalid Core ${field} cannot enter the quote projection`, async () => {
  const service = new AiQuotePreviewService({ createQuote: async () => ({ ...quote(), [field]: Number.NaN }) }, { current: async () => business }, authority, () => new Date('2026-10-05T01:30:00.000Z'));
  await assert.rejects(() => service.preview(input), error => error.code === 'INVALID_RESPONSE');
});
