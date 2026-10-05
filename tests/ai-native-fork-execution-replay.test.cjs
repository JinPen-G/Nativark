'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, command, clone, AiStepRegistrationRepository } = require('./fixtures/ai-native/step-registration.cjs');
const { createAiTaskRunnerRepositoryPorts } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.repository-adapter');

async function harness() {
  const h = setup(); const registered = await h.run();
  Object.assign(h.state.steps[0], { status: 'SUCCEEDED', effect: 'NONE', resultRef: 'result-1', errorCode: null });
  let reads = 0;
  const readAuthority = { resolve: async () => { reads++; return clone(h.state.grant.context); } };
  const repository = new AiStepRegistrationRepository(h.db, h.authority, () => new Date(h.state.clock), undefined, readAuthority);
  const input = { ...clone(command), stepId: registered.stepId, expectedStepRevision: registered.stepRevision };
  return { ...h, input, repository, readAuthority, get reads() { return reads; } };
}

test('actual replay adapter reads a persisted terminal projection under distinct read authority', async () => {
  const h = await harness();
  const ports = createAiTaskRunnerRepositoryPorts({ tasks: {}, registrations: h.repository, replays: h.repository, transitions: {}, commands: { register: () => clone(command) } });
  const result = await ports.steps.register({ registrationRef: command.registrationRef, toolCode: 'rental.order.explain', toolVersion: 'draft-1', operation: 'readonly' }, { taskId: command.taskId, ...command.lease, expiresAt: h.state.run.leaseExpiresAt.toISOString() });
  assert.equal(result.replayed, true); assert.equal(result.existingStatus, 'succeeded'); assert.equal(result.resultRef, 'result-1');
  assert.equal(h.reads >= 2, true); assert.equal(h.state.steps.length, 1);
});

for (const key of ['runId', 'requestFingerprint', 'toolCode', 'actionId']) test(`replay refuses changed ${key}`, async () => {
  const h = await harness(); h.state.steps[0][key] = key === 'requestFingerprint' ? 'b'.repeat(64) : 'other';
  await assert.rejects(h.repository.readReplay(h.input), error => ['AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'].includes(error.code));
});

test('replay fails closed without terminal read authority', async () => {
  const h = await harness(); const repository = new AiStepRegistrationRepository(h.db, h.authority, () => new Date(h.state.clock));
  await assert.rejects(repository.readReplay(h.input), error => error.code === 'AI_ACCESS_DENIED');
});

test('revocation during replay read suppresses the result reference', async () => {
  const h = await harness(); let revoked = false;
  h.readAuthority.resolve = async () => { if (revoked) throw Error('revoked'); return clone(h.state.grant.context); };
  h.state.hooks['step.read'] = () => { revoked = true; };
  await assert.rejects(h.repository.readReplay(h.input), error => error.code === 'AI_ACCESS_DENIED');
});

test('replay never treats missing terminal evidence as success', async () => {
  const h = await harness(); h.state.steps[0].resultRef = null;
  await assert.rejects(h.repository.readReplay(h.input), error => error.code === 'AI_STORAGE_UNAVAILABLE');
});
