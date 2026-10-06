'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');

test('actual persistent runner continues a second step within cumulative output budget', async () => {
  const h = await taskInputHarness();
  const result = await h.make().runner.run(h.claim());
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes,
    h.state.aiTaskResultArtifact.reduce((n, artifact) => n + artifact.outputBytes, 0n));
});

test('exhausted cumulative output prevents the next effect without resetting any counters', async () => {
  const h = await taskInputHarness();
  h.control.execute = async () => ({ kind: 'succeeded', payload: 'x'.repeat(4094) });
  await assert.rejects(h.make().runner.run(h.claim()), e => e.code === 'AI_RUN_LIMIT');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, 4096n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
});

test('two workers cannot claim and execute the same remaining steps', async () => {
  const h = await taskInputHarness(), claim = h.claim();
  const results = await Promise.allSettled([h.make().runner.run(claim), h.make().runner.run({ ...claim, holderId: 'workerId-b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'AI_REVISION_CONFLICT').length, 1);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
});
