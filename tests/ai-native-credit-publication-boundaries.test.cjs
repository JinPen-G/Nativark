'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('@prisma/client');
const { assertPlatformCreditLimit, creditConsumption, creditAmount } = require('../apps/api/src/modules/ai-native/budget/platform-credit-limit');
const { readRuntimePublication, AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER, runtimeConfigurationProvider } = require('../apps/api/src/modules/ai-native/runtime-publication.configuration');

test('tenant and workspace limits count settled and unresolved micro-units exactly', async () => {
  const spent = new Prisma.Decimal('123456789012345.123456');
  const micro = new Prisma.Decimal('0.000001');
  const account = { grantedAmount: new Prisma.Decimal('123456789012345.123458'), allocationsJson: { shop: '123456789012345.123458' } };
  const tx = { $queryRaw: async () => [], aiTenantAiAllowance: { findUnique: async () => account }, aiBudgetReservation: { groupBy: async () => [
    { status: 'settled', _count: { _all: 1, actualMoney: 1 }, _sum: { actualMoney: spent } },
    { status: 'pending_reconciliation', _count: { _all: 1, reservedMoney: 1 }, _sum: { reservedMoney: micro } },
  ] } };
  assert.equal(creditAmount((await creditConsumption(tx, 'tenant', 'CNY')).spent), '123456789012345.123456');
  await assertPlatformCreditLimit(tx, 'tenant', 'shop', 'CNY', '0.000001');
  await assert.rejects(assertPlatformCreditLimit(tx, 'tenant', 'shop', 'CNY', '0.000002'));
  account.allocationsJson.shop = '123456789012345.123457';
  await assert.rejects(assertPlatformCreditLimit(tx, 'tenant', 'shop', 'CNY', '0.000001'));
});

test('strict publication validation rejects malformed input while bootstrap disables every execution section', () => {
  const invalid = { get: () => '{' };
  assert.throws(() => readRuntimePublication(invalid));
  const snapshot = AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER.useFactory(invalid);
  assert.equal(snapshot.state, 'unconfigured');
  assert.equal(runtimeConfigurationProvider(Symbol(), 'orderModel').useFactory(snapshot), undefined);
  assert.equal(readRuntimePublication({ get: () => undefined }).state, 'unconfigured');
});

test('deployment preflight reads a bounded UTF-8 publication without opening an application', async () => {
  const { checkPublication } = require('../scripts/ops/check-ai-publication.cjs');
  const valid = JSON.stringify({version:'ain-runtime-publication-1',revision:'r1',configurations:{}});
  assert.equal(await checkPublication([valid]),'configured');
  assert.equal(await checkPublication([]),'unconfigured');
  for (const value of ['{', Buffer.from([255]), Buffer.alloc(65537), valid.replace('r1','!')]) assert.equal(await checkPublication([value]),'invalid');
});
