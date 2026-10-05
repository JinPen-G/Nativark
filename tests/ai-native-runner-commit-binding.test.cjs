'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, command, clone } = require('./fixtures/ai-native/step-registration.cjs');
const { createAiTaskRunnerRepositoryPorts } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.repository-adapter');

for (const [name, mutate] of [
  ['task', result => { result.event.taskId = 'other-task'; }],
  ['run', result => { result.event.data.runId = 'other-run'; }],
  ['step', result => { result.event.data.stepId = 'other-step'; }],
  ['event type', result => { result.event.type = 'task.transition'; }],
  ['status', result => { result.event.data.status = 'succeeded'; }],
  ['task revision', result => { result.event.taskRevision++; }],
  ['step revision', result => { result.event.data.stepRevision++; }],
  ['run revision', result => { result.runRevision++; }]
]) test(`actual runner adapter rejects mismatched ${name} acknowledgement without repeating a committed transition`, async () => {
  const h = setup(), transition = h.transition(); let writes = 0;
  const lease = { taskId: command.taskId, ...command.lease, expiresAt: h.state.run.leaseExpiresAt.toISOString() };
  const ports = createAiTaskRunnerRepositoryPorts({ tasks: {}, registrations: h.repository,
    transitions: { transition: async value => { writes++; const result = await transition.transition(value); mutate(result); return result; } },
    commands: {
      register: (_plan, held) => ({ ...clone(command), lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } }),
      transition: (_kind, ref, held) => ({ taskId: command.taskId, stepId: ref.registered.stepId,
        expectedTaskRevision: ref.registered.taskRevision, expectedStepRevision: ref.registered.stepRevision,
        evidenceId: 'evidence-start', reason: 'start', lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } })
    } });
  const plan = { registrationRef: command.registrationRef, operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: 'draft-1' };
  const registered = await ports.steps.register(plan, lease);
  await assert.rejects(ports.steps.start({ plan, registered }, { ...lease, revision: registered.runRevision }), /AI_STORAGE_UNAVAILABLE/);
  assert.equal(writes, 1); assert.equal(h.state.steps[0].status, 'RUNNING');
  // A rejected acknowledgement is not proof of rollback or permission to resend.
});
