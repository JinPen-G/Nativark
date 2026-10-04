'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const data = require('./fixtures/ai-native/scenarios/availability.cjs');
test('availability fixtures include conflict, no inventory and cross-scope branches', () => { assert.equal(data.assets.length, 2); assert.equal(data.windows.length, 2); assert.deepEqual(new Set(data.scenarios.map(item => item.expected)), new Set(['conflict', 'no_inventory', 'cross_scope'])); });
