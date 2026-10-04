'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const runner = require('../scripts/ai-native-b07-offline.cjs');
test('B07 runner discovers B02 through B07 and retains per-file failure statuses', () => { const files = runner.discoverTests(); assert.ok(files.length > 0); assert.ok(files.some(file => file.includes('ai-native-b07-'))); assert.ok(files.every(file => /ai-native-b(?:02|03|04|05|06|07)-/.test(file))); const result = runner.runOffline('tests/ai-native-b07-w01-injection.test.cjs', 5000); assert.equal(result.status, 'passed'); });
