'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { createAiTaskRunnerOutcomePort } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner-outcome-adapter');

const lease = { runId: 'run-1', holderId: 'worker-1', revision: 4, fencingToken: '5' };
function harness() {
  const calls = [];
  const adapters = {
    commands: { transition: input => { calls.push(['command', input]); return { ...input, taskId: input.taskId, expectedRevision: input.expectedRevision }; } },
    transitions: { transition: async command => { calls.push(['transition', command]); return {
      event: { contractVersion: 'ain-c04-draft-1', type: 'task.transition', taskId: command.taskId,
        taskRevision: command.expectedRevision + 1, data: { to: command.to, reason: command.reason } }, runRevision: 5 }; } }
  };
  return { calls, port: createAiTaskRunnerOutcomePort(adapters) };
}

test('maps unknown and pause outcomes to existing task transition reasons', async () => {
  const h = harness();
  await h.port.commit({ taskId: 'task-1', taskRevision: 8, lease, outcome: { status: 'unknown', completedSteps: 0, cleanupFailed: 0 } });
  await h.port.commit({ taskId: 'task-1', taskRevision: 9, lease, outcome: { status: 'paused', pause: 'confirmation', completedSteps: 0, cleanupFailed: 0 } });
  assert.deepEqual(h.calls.filter(row => row[0] === 'command').map(row => [row[0], row[1].to, row[1].reason]), [['command', 'waiting_external', 'external_pending'], ['command', 'waiting_confirmation', 'confirmation_required']]);
});

test('maps a failure after completed steps to partial success, not aggregate failure', async () => {
  const h = harness();
  await h.port.commit({ taskId: 'task-1', taskRevision: 8, lease, outcome: { status: 'failed', errorCode: 'AI_RESOURCE_UNAVAILABLE', completedSteps: 1, cleanupFailed: 0 } });
  const command = h.calls.filter(row => row[0] === 'command').at(-1)[1];
  assert.deepEqual([command.to, command.reason], ['partially_succeeded', 'completed']);
});

test('does not accept a transition response without a new aggregate revision and run fence', async () => {
  const port = createAiTaskRunnerOutcomePort({
    commands: { transition: input => input },
    transitions: { transition: async () => ({ event: { taskRevision: 1 }, runRevision: 4 }) }
  });
  await assert.rejects(() => port.commit({ taskId: 'task-1', taskRevision: 1, lease, outcome: { status: 'succeeded', completedSteps: 1, cleanupFailed: 0 } }));
});
