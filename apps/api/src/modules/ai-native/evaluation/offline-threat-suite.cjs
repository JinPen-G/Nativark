'use strict';
// Explicit offline CLI, never imported by AppModule. Frozen Node-test allowlist;
// no URL, command, model output or user-supplied filename is executable input.
const path = require('node:path'), fs = require('node:fs'), { spawn } = require('node:child_process');
const root = fs.realpathSync(path.resolve(__dirname, '../../../../../..'));
const definitions = [
  ['knowledge-access', 'knowledge-access', 'offline_service'],
  ['knowledge-cache', 'knowledge-cache', 'offline_service'],
  ['attachment-parser', 'knowledge-parser', 'offline_service'],
  ['document-injection', 'knowledge-flow', 'offline_service'],
  ['memory-confirmation', 'memory-service', 'offline_service'],
  ['knowledge-await-authority', 'knowledge-lane-b-authority', 'offline_service'],
  ['memory-late-revocation', 'memory-lane-b-revocation', 'offline_service'],
  ['byok-egress', 'model-egress', 'transport_simulation'],
  ['configuration-revision', 'config-boundaries', 'offline_service'],
  ['provider-scope', 'router-boundaries', 'offline_service'],
  ['forged-approval', 'ain07-approval-consumption', 'offline_service'],
  ['budget-transaction', 'c03-budget', 'offline_service'],
  ['budget-unknown-replay', 'c01-budget', 'offline_service'],
  ['resource-last-unit-race', 'execution-budget-repository', 'offline_service'],
  ['recovery-authority', 'task-authorized-recovery', 'offline_service'],
  ['unverified-capability', 'capability-evidence-boundaries', 'offline_service'],
  ['xss-rendering', 'lane-b-render-security', 'render_ssr'],
].map(([id, name, evidence]) => Object.freeze({ id, file: `tests/ai-native-${name}.test.cjs`, evidence }));
const catalog = new Map(definitions.map(row => [row.id, row]));

function selectSuites(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > definitions.length || new Set(ids).size !== ids.length) throw Error('Invalid suite selection');
  return ids.map(id => { const row = catalog.get(id); if (!row) throw Error('Unknown suite'); return { ...row }; });
}
function summarizeRun(id, exitCode, output, timedOut) {
  const row = selectSuites([id])[0], counts = {};
  for (const field of ['tests', 'pass', 'fail', 'skipped', 'todo']) {
    const match = output.match(new RegExp(`(?:^|\\n)(?:ℹ )?${field} (\\d+)(?:\\r?\\n|$)`));
    counts[field] = match ? Number(match[1]) : null;
  }
  const complete = Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0);
  const status = timedOut || exitCode !== 0 || counts.fail > 0 ? 'fail'
    : !complete || counts.tests === 0 || counts.skipped > 0 || counts.todo > 0 || counts.pass !== counts.tests ? 'unavailable' : 'pass';
  return { id: row.id, file: row.file, evidence: row.evidence, status, exitCode, timedOut, counts };
}
function execute(row) {
  return new Promise(resolve => {
    const file = fs.realpathSync(path.join(root, row.file));
    if (!file.startsWith(root + path.sep)) throw Error('Suite is outside worktree');
    const audit = process.env.AI_OFFLINE_AUDIT;
    if (!audit || !path.isAbsolute(audit) || !path.resolve(audit).startsWith(root + path.sep)) throw Error('Worktree audit path required');
    const preload = path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs');
    const local = path.join(root, 'tests/fixtures/ai-native/lane-b-local-runtime.cjs');
    const child = spawn(process.execPath, ['--require', preload, '--require', local, '--test', '--test-reporter=spec', file], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
        NODE_OPTIONS: '', AI_OFFLINE_AUDIT: `${audit}.${row.id}` },
    });
    let output = '', timedOut = false;
    const collect = data => { if (output.length + data.length > 1024 * 1024) { timedOut = true; child.kill(); } else output += data.toString('utf8'); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
    child.on('error', () => { clearTimeout(timer); resolve(summarizeRun(row.id, 1, '', false)); });
    child.on('close', code => { clearTimeout(timer); resolve(summarizeRun(row.id, code, output, timedOut)); });
  });
}
async function runThreatSuite(ids = definitions.map(row => row.id), onResult = () => {}) {
  const rows = selectSuites(ids), results = []; let next = 0;
  async function worker() {
    while (next < rows.length) {
      const result = await execute(rows[next++]); results.push(result); onResult(result);
    }
  }
  await Promise.all([worker(), worker()]);
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { results, languageQuality: 'not_sampled', realEgress: 'not_verified', realDatabase: 'not_verified',
    exitCode: results.every(row => row.status === 'pass') ? 0 : 1 };
}
module.exports = { selectSuites, summarizeRun, runThreatSuite };
if (require.main === module) {
  runThreatSuite(undefined, row => process.stdout.write(JSON.stringify(row) + '\n'))
    .then(report => { process.stdout.write(JSON.stringify(report) + '\n'); process.exitCode = report.exitCode; })
    .catch(() => { process.stderr.write('Offline suite could not execute; acceptance unavailable\n'); process.exitCode = 1; });
}
