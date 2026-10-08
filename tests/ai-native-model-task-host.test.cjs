'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { modelHostHarness } = require('./fixtures/ai-native/task-model-host.cjs');
const { composeTaskModelHost } = require('../apps/api/src/modules/ai-native/runner/model-task-host.composition');

test('model host starts queued task and run, publishes under one lease, then settles the original invocation and four resources', async () => {
  const h = await modelHostHarness(), originalFence = h.state.aiRun[0].fencingToken, start = h.trace.length;
  h.config.task.material.messages[0].content[0].text = 'late caller mutation';
  h.storeControl.beforeWrite = async (name, args, data) => {
    if (name === 'aiGatewayInvocation') {
      assert.equal(data.aiTask[0].status, 'RUNNING'); assert.equal(data.aiRun[0].status, 'RUNNING');
      assert.equal(data.aiStep[0].status, 'RUNNING'); assert.equal(data.aiStep[0].effect, 'POSSIBLE');
      assert.deepEqual(h.modelControl.sent, []);
    }
  };
  const result = await h.root.application.start(h.query);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded');
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiStep[0].effect, 'NONE'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), originalFence.add(1).toFixed(0));
  assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.modelControl.sent[0].messages[0].content, 'Explain authorized facts.');
  assert.equal(h.state.aiGatewayInvocation[0].callId, h.state.aiTaskActionInput[0].payload.intent.requestId);
  assert.equal(h.state.aiStep[0].resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 4); assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.equal(h.state.aiBudgetReservation.length, 1); assert.equal(h.state.aiGatewayAccountingReceipt.length, 1);
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, 1n); assert.equal(h.state.aiGatewayAccountingReceipt[0].outputTokens, 2n);
  const trace = h.trace.slice(start);
  assert.ok(trace.indexOf('aiTaskActionInput.create') < trace.indexOf('aiTaskRunPlan.create'));
  assert.ok(trace.indexOf('aiTaskRunPlan.create') < trace.indexOf('aiStep.create'));
  assert.ok(trace.indexOf('aiStep.create') < trace.indexOf('aiGatewayInvocation.create'));
  const snapshot = await h.root.application.inspect(h.query);
  assert.equal(snapshot.steps[0].status, 'succeeded'); assert.equal(snapshot.resources.counters.calls.consumed, '1');
  assert.equal(JSON.stringify(snapshot).includes('vault-a'), false); assert.equal(JSON.stringify(snapshot).includes('Synthetic model result'), false);
  const page = await h.root.application.readEvents({ taskId: h.query.taskId, after: '0', limit: 100 });
  assert.equal(page.events.filter(e => e.type === 'step.changed' && e.data.status === 'succeeded').length, 1);
});

test('model host cannot substitute an absent financial reader or price version', async () => {
  const h = await modelHostHarness(), before = h.clone(h.state);
  assert.throws(() => composeTaskModelHost({ ...h.config, financialEvidence: undefined }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => composeTaskModelHost({ ...h.config, priceVersion: undefined }));
  assert.deepEqual(h.state, before); assert.deepEqual(h.modelControl.sent, []);
});

for (const mode of ['membership', 'ai_closed']) test(`model host checks ${mode} before any new preparation or claim`, async () => {
  const h = await modelHostHarness();
  if (mode === 'membership') h.identity.membership = false; else h.state.aiBudgetPolicy[0].enabled = false;
  const before = h.clone(h.state);
  await assert.rejects(h.root.application.start(h.query), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); assert.deepEqual(h.modelControl.sent, []);
});

test('model host leaves original publication after a lost acknowledgement without starting a step', async () => {
  const h = await modelHostHarness(); let lost = false;
  h.storeControl.beforeCommit = async draft => {
    if (!lost && draft.aiTaskActionInput.length) { lost = true; h.storeControl.loseReply = true; }
  };
  await assert.rejects(h.root.application.start(h.query), e => e.code === 'AI_RESULT_UNKNOWN');
  h.storeControl.beforeCommit = null;
  assert.equal(lost, true); assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal(h.state.aiTaskRunPlan.length, 0); assert.equal(h.state.aiStep.length, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.deepEqual(h.modelControl.sent, []); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  const snapshot = await h.root.application.inspect(h.query); assert.equal(snapshot.plan, null); assert.equal(snapshot.resources, null);
});

test('model host refuses a changed route after durable step start but before invocation registration', async () => {
  const h = await modelHostHarness(); let changed = false;
  h.storeControl.beforeCommit = async draft => {
    if (!changed && draft.aiStep[0]?.status === 'RUNNING') { changed = true; draft.aiProviderProfile[0].configRevision++; }
  };
  await assert.rejects(h.root.application.start(h.query));
  assert.equal(changed, true); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.deepEqual(h.modelControl.sent, []);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
});

test('model host keeps missing provider usage unknown and never settles it as zero', async () => {
  const h = await modelHostHarness(); h.modelControl.result = { text: 'No usage returned' };
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN'); assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
  assert.equal(h.modelControl.sent.length, 1); assert.equal(h.modelControl.events.includes('settle'), false);
});

for (const complete of [true, false]) test(`model host recovery reads ${complete ? 'completed' : 'unknown'} original evidence with the already-held lease and no new call`, async () => {
  const h = await modelHostHarness();
  if (!complete) h.modelControl.onInvoke = async () => { throw Error('synthetic interrupted transport'); };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED' || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic interrupted worker');
  };
  await assert.rejects(h.root.application.start(h.query)); h.storeControl.beforeWrite = null;
  const artifacts = h.clone(h.state.aiTaskResultArtifact), invocation = h.clone(h.state.aiGatewayInvocation);
  const charges = h.state.aiTaskExecutionCharge.map(c => c.chargeId), fence = h.state.aiRun[0].fencingToken.toFixed(0);
  const result = await h.root.application.reconcile(h.query);
  assert.equal(result.outcome.status, complete ? 'succeeded' : 'unknown');
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiGatewayInvocation, invocation);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), charges);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), fence); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, complete ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, complete ? 0n : 1n); assert.equal(h.modelControl.sent.length, 1);
});

test('model host cancellation during dispatch preserves original unknown occupancy and never emits a fresh invocation', async () => {
  const h = await modelHostHarness();
  h.modelControl.onInvoke = async () => h.root.taskTransitions.transition({ taskId: h.query.taskId,
    expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
});
