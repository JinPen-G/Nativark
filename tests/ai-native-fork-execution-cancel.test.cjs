'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, command, clone } = require('./fixtures/ai-native/step-registration.cjs');
const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { createAiTaskRunnerOutcomePort } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner-outcome-adapter');

async function cancellation(outcomes) {
  const h = setup(); await h.run();
  const first = h.state.steps[0];
  h.state.steps = outcomes.map((outcome, i) => ({ ...clone(first), id: `step-${i}`, actionId: `action-${i}`, sequence: i + 1, ...outcome }));
  h.state.task.status = 'CANCEL_REQUESTED'; h.state.task.cancelRequestedAt = new Date(h.state.clock);
  const transitions = new AiTaskTransitionRepository(h.db, { resolve: async () => clone(h.state.grant.context) }, () => new Date(h.state.clock));
  const port = createAiTaskRunnerOutcomePort({ transitions, commands: { transition: input => clone(input) } });
  const lease = { taskId: command.taskId, ...command.lease, revision: h.state.run.revision, expiresAt: h.state.run.leaseExpiresAt.toISOString() };
  return { h, run: () => port.commit({ taskId: command.taskId, taskRevision: h.state.task.revision, lease, outcome: { status: 'cancelled', completedSteps: outcomes.filter(x => x.status === 'SUCCEEDED').length, cleanupFailed: 0 } }) };
}

test('cancel after committed effects preserves succeeded rather than claiming rollback', async () => {
  const { h, run } = await cancellation([{ status: 'SUCCEEDED', effect: 'COMMITTED' }]);
  const result = await run(); assert.equal(h.state.task.status, 'SUCCEEDED'); assert.equal(result.outcomeStatus, 'succeeded');
});
test('cancel with committed and unstarted actions records partial success', async () => {
  const { h, run } = await cancellation([{ status: 'SUCCEEDED', effect: 'COMMITTED' }, { status: 'PENDING', effect: 'NONE' }]);
  const result = await run(); assert.equal(h.state.task.status, 'PARTIALLY_SUCCEEDED'); assert.equal(result.outcomeStatus, 'partially_succeeded');
});
test('cancel without committed effects is cancelled', async () => {
  const { h, run } = await cancellation([{ status: 'PENDING', effect: 'NONE' }]);
  await run(); assert.equal(h.state.task.status, 'CANCELLED');
});
test('reconciled waiting-external task resumes through the actual state machine before success', async () => {
  const h = setup(); await h.run();
  Object.assign(h.state.steps[0], { status: 'SUCCEEDED', effect: 'COMMITTED' });
  h.state.task.status = 'WAITING_EXTERNAL';
  const transitions = new AiTaskTransitionRepository(h.db, { resolve: async () => clone(h.state.grant.context) }, () => new Date(h.state.clock));
  const port = createAiTaskRunnerOutcomePort({ transitions, tasks: { readMetadata: async () => ({ taskId: command.taskId, status: 'waiting_external', revision: h.state.task.revision }) }, commands: { transition: input => clone(input) } });
  const result = await port.commit({ taskId: command.taskId, taskRevision: h.state.task.revision,
    lease: { taskId: command.taskId, ...command.lease, revision: h.state.run.revision, expiresAt: h.state.run.leaseExpiresAt.toISOString() },
    outcome: { status: 'succeeded', completedSteps: 1, cleanupFailed: 0 } });
  assert.equal(result.outcomeStatus, 'succeeded'); assert.equal(h.state.task.status, 'SUCCEEDED');
  assert.deepEqual(h.state.events.slice(-2).map(event => event.payload.data.to), ['running', 'succeeded']);
});

test('unknown effects keep cancellation pending', async () => {
  const { h, run } = await cancellation([{ status: 'UNKNOWN', effect: 'POSSIBLE' }]);
  await assert.rejects(run()); assert.equal(h.state.task.status, 'CANCEL_REQUESTED');
});
