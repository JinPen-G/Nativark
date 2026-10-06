'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const load = () => require('../apps/api/src/modules/ai-native/evaluation/offline-threat-suite.cjs');
test('offline runner only selects frozen real-entry suites, never arbitrary commands or paths', () => {
  const tool = load();
  assert.ok(tool.selectSuites(['knowledge-access']).every(row => row.file === 'tests/ai-native-knowledge-access.test.cjs'));
  for (const value of [['../../other'], ['https://example.invalid'], ['knowledge-access', 'knowledge-access'], 'knowledge-access', []]) assert.throws(() => tool.selectSuites(value));
});
test('missing counters, nonzero exit, timeout and skipped tests cannot become green acceptance', () => {
  const { summarizeRun } = load();
  assert.equal(summarizeRun('knowledge-access', 0, 'nothing', false).status, 'unavailable');
  assert.equal(summarizeRun('knowledge-access', 1, 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\nℹ todo 0', false).status, 'fail');
  assert.equal(summarizeRun('knowledge-access', 0, 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\nℹ todo 0', true).status, 'fail');
  assert.equal(summarizeRun('knowledge-access', 0, 'ℹ tests 1\nℹ pass 0\nℹ fail 0\nℹ skipped 1\nℹ todo 0', false).status, 'unavailable');
});
test('report projects only counts and case identity, not raw errors or model text', () => {
  const { summarizeRun } = load();
  const report = summarizeRun('knowledge-access', 0, 'synthetic-sensitive\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\nℹ todo 0', false);
  assert.equal(report.status, 'pass'); assert.equal(JSON.stringify(report).includes('synthetic-sensitive'), false);
});
