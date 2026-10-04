'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function discoverTests(root = path.resolve(process.cwd(), 'tests')) {
  return fs.readdirSync(root)
    .filter(name => /^ai-native-b(?:0[2-9]|1[0-4])-.*\.(?:cjs|mjs)$/.test(name))
    .sort()
    .map(name => path.join(root, name));
}

function runCommand(command, args, label, timeout = 120_000, runner = spawnSync) {
  const guard = path.resolve(process.cwd(), 'tests/fixtures/ai-native/prisma-offline-preload.cjs');
  // NODE_OPTIONS is inherited by npm, compilers, test workers and their Node children.
  const nodeOptions = `--require ${JSON.stringify(guard.replace(/\\/g, '/'))} ${process.env.NODE_OPTIONS ?? ''}`.trim();
  const result = runner(command, args, {
    cwd: process.cwd(), encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
    env: { ...process.env, NODE_OPTIONS: nodeOptions,
      AI_OFFLINE_AUDIT: path.resolve(process.cwd(), process.env.AI_OFFLINE_AUDIT ?? 'output/ai-native-b14-offline-audit.log'),
      DATABASE_URL: 'mysql://127.0.0.1:1/ai_native_b14_offline_invalid', AI_NATIVE_OFFLINE: '1', CI: '1' },
  });
  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM' && result.status === null;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const count = name => {
    const matches = [...output.matchAll(new RegExp(`^(?:#|ℹ) ${name} (\\d+)\\s*$`, 'gm'))];
    return matches.length ? Number(matches[matches.length - 1][1]) : 0;
  };
  const countsAvailable = /^(?:#|ℹ) tests \d+\s*$/m.test(output);
  return { label, status: timedOut ? 'timeout' : result.error ? 'failed' : result.status === 0 ? 'passed' : 'failed', exitCode: timedOut ? null : result.status, countsAvailable, todo: count('todo'), skipped: count('skipped'), output: output.slice(-4000), guard };
}

function runOffline(testFile, timeout = 30_000, runner = spawnSync) {
  return runCommand(process.execPath, ['--require', path.resolve(process.cwd(), 'scripts/ai-native-b06-offline-guard.cjs'), '--test', testFile], path.relative(process.cwd(), testFile), timeout, runner);
}

function commands() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return [
    [npm, ['run', 'lint', '-w', '@rental-os/admin'], 'admin lint'],
    [npm, ['run', 'build', '-w', '@rental-os/admin', '--', '--mode', 'ai-offline'], 'admin offline build/typecheck'],
    [npm, ['run', 'typecheck', '-w', '@rental-os/miniprogram'], 'client typecheck'],
    [npm, ['run', 'typecheck', '-w', '@rental-os/staff-miniprogram'], 'staff typecheck'],
    [npm, ['run', 'build', '-w', '@rental-os/miniprogram'], 'client build'],
    [npm, ['run', 'build', '-w', '@rental-os/staff-miniprogram'], 'staff build'],
    [process.execPath, ['--require', path.resolve(process.cwd(), 'scripts/ai-native-b06-offline-guard.cjs'), '--test', path.resolve(process.cwd(), 'tests/miniprogram-static.test.cjs')], 'client static registration'],
    [process.execPath, ['--require', path.resolve(process.cwd(), 'scripts/ai-native-b06-offline-guard.cjs'), '--test', path.resolve(process.cwd(), 'tests/staff-miniprogram-static.test.cjs')], 'staff static registration'],
  ];
}

function runSuite(options = {}) {
  const runner = options.runner ?? spawnSync;
  // Artifact tests consume generated mini-program modules; build before discovering/running them.
  const checkResults = commands().map(([command, args, label]) => runCommand(command, args, label, options.checkTimeout ?? 180_000, runner));
  const testResults = discoverTests(options.testsRoot).map(file => runOffline(file, options.testTimeout ?? 30_000, runner));
  const results = [...testResults, ...checkResults];
  const failed = results.filter(result => result.status !== 'passed');
  return { tool: 'ai-native-b14-offline', generatedAt: new Date().toISOString(), tests: testResults.length, checks: checkResults.length, passed: results.length - failed.length, failed: failed.length, todo: results.reduce((sum, result) => sum + result.todo, 0), skipped: results.reduce((sum, result) => sum + result.skipped, 0), results, unrun: ['真实 HTTP', '数据库/迁移', '真实模型/供应商', '浏览器/微信开发者工具/真机', '支付与生产灰度'] };
}

if (require.main === module) {
  const report = runSuite();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.failed ? 1 : 0;
}

module.exports = { discoverTests, runCommand, runOffline, commands, runSuite };
