'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const runner = require('../scripts/ai-native-b14-offline.cjs');

test('B14-F runner discovers B02-B14 tests in deterministic order', () => {
  const files = runner.discoverTests(path.resolve(__dirname));
  assert.ok(files.length >= 1);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.some(file => file.includes('ai-native-b14-a')));
});

test('B14-F runner propagates a failed command without hiding its exit code', () => {
  const fake = (_command, _args) => ({ status: 7, signal: null, stdout: 'failure', stderr: '' });
  const result = runner.runCommand('fake', [], 'synthetic failure', 100, fake);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
  assert.match(result.output, /failure/);
});

test('B14-F report explicitly separates offline evidence from unrun environments', () => {
  const report = runner.runSuite({ testsRoot: path.resolve(__dirname), runner: (_command, args) => ({ status: args.includes('bad') ? 1 : 0, signal: null, stdout: '', stderr: '' }), testTimeout: 100, checkTimeout: 100 });
  assert.equal(report.tool, 'ai-native-b14-offline');
  assert.ok(report.unrun.includes('真实模型/供应商'));
  assert.equal(typeof report.failed, 'number');
});
