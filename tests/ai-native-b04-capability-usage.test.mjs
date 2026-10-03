import test from 'node:test';
import assert from 'node:assert/strict';
import { toUsageDisplay } from '../apps/admin/src/features/ai-native/usage-display.ts';
test('usage display never turns unknown into zero or free', () => { assert.deepEqual(toUsageDisplay({ status: 'unknown' }), { label: '待核对', value: '未知用量', tone: 'warning' }); assert.deepEqual(toUsageDisplay({ status: 'pending_reconciliation' }), { label: '待核对', value: '未知用量', tone: 'warning' }); });
test('reserved and unpriced usage stay explicit', () => { assert.equal(toUsageDisplay({ status: 'reserved', amount: '4', unit: 'calls' }).value, '4 calls'); assert.equal(toUsageDisplay({ status: 'estimated' }).value, '未定价'); });
