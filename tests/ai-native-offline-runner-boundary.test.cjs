'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { runCommand } = require('../scripts/ai-native-b14-offline.cjs');
for (const [kind, source] of [
  ['env-file-read', `require('node:fs').readFileSync('.env.ai-native-synthetic-never-created')`],
  ['dns', `require('node:dns').lookup('synthetic.invalid', () => {})`],
  ['network', `require('node:net').connect(1, '127.0.0.1')`],
  ['fetch', `fetch('https://synthetic.invalid')`]
]) test(`engineering child inherits offline guard for ${kind}`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-runner-guard-')), audit = path.join(dir, 'audit.log');
  try {
    const child = `const r=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(source)}],{encoding:'utf8'});process.stderr.write(r.stderr);process.exitCode=r.status;`;
    const result = runCommand(process.execPath, ['-e', child], 'synthetic nested child', 10000,
      (command, args, options) => spawnSync(command, args, { ...options, env: { ...options.env, AI_OFFLINE_AUDIT: audit } }));
    assert.equal(result.status, 'failed'); assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync(audit, 'utf8').trim(), kind);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
