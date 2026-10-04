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

for (const marker of ['#', 'ℹ']) test(`B14-F counts ${marker} reporter summaries without hiding todo/skipped`, () => {
  const result = runner.runCommand('fake', [], 'summary', 100, () => ({ status: 0, stdout: `${marker} tests 9\n${marker} todo 2\n${marker} skipped 3\n`, stderr: '' }));
  assert.equal(result.todo, 2); assert.equal(result.skipped, 3); assert.equal(result.countsAvailable, true);
});
test('B14-F engineering commands inherit the guard and use the no-env admin mode', () => {
  let options;
  const result = runner.runCommand('fake', [], 'guard', 100, (_c, _a, value) => { options = value; return { status: 0, stdout: '', stderr: '' }; });
  assert.match(options.env.NODE_OPTIONS, /prisma-offline-preload\.cjs/);
  assert.ok(path.isAbsolute(options.env.AI_OFFLINE_AUDIT));
  assert.equal(result.countsAvailable, false);
  assert.ok(runner.commands().some(([_c, args]) => args.includes('ai-offline')));
});
test('B14-F relative audit path is anchored before children change working directory', () => {
  const previous = process.env.AI_OFFLINE_AUDIT;
  try {
    process.env.AI_OFFLINE_AUDIT = 'output/relative-audit.log';
    let options;
    runner.runCommand('fake', [], 'audit-path', 100, (_c, _a, value) => { options = value; return { status: 0, stdout: '', stderr: '' }; });
    assert.equal(options.env.AI_OFFLINE_AUDIT, path.resolve('output/relative-audit.log'));
  } finally {
    if (previous === undefined) delete process.env.AI_OFFLINE_AUDIT;
    else process.env.AI_OFFLINE_AUDIT = previous;
  }
});

test('B14-F builds before artifact tests and propagates spawn errors', () => {
  const calls = [];
  runner.runSuite({ testsRoot: path.resolve(__dirname), runner: (_c, args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; } });
  const build = calls.findIndex(args => args.includes('build'));
  const testFile = calls.findIndex(args => args.some(arg => /ai-native-b\d.*\.cjs$/.test(arg)));
  assert.ok(build >= 0 && build < testFile);
  assert.equal(runner.runCommand('fake', [], 'spawn-error', 100, () => ({ status: 0, error: new Error('failed'), stdout: '', stderr: '' })).status, 'failed');
});

test('B14-F report explicitly separates offline evidence from unrun environments', () => {
  const report = runner.runSuite({ testsRoot: path.resolve(__dirname), runner: (_command, args) => ({ status: args.includes('bad') ? 1 : 0, signal: null, stdout: '', stderr: '' }), testTimeout: 100, checkTimeout: 100 });
  assert.equal(report.tool, 'ai-native-b14-offline');
  assert.ok(report.unrun.includes('真实模型/供应商'));
  assert.equal(typeof report.failed, 'number');
  assert.equal(typeof report.todo, 'number');
  assert.equal(typeof report.skipped, 'number');
});
