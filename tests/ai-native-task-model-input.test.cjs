'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { composePersistedTaskModelInput } = require('../apps/api/src/modules/ai-native/model-input/persisted-task-model-input.composition');
const { TASK_TEXT_MODEL_TOOL } = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
const { prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
const { PrismaGatewayInvocationBindings } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
const { AI_TOOL_DRAFT_VERSION, AI_TOOL_CODES, AI_TASK_STEP_CODES } = require('./fixtures/ai-native/local-shared.cjs');

async function setup() {
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1,
    credentialRef: 'vault-a', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model',
    serviceMode: 'tenant_managed', enabled: true, disabledAt: null };
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProviderProfile: [profile], aiBudgetReservation: [] });
  h.state.aiTaskRunPlan.length = 0; h.identity.user.permissions.push('system:params:manage');
  const transaction = h.db.$transaction.bind(h.db);
  h.db.$transaction = callback => transaction(tx => callback({ ...tx, aiGatewayInvocation: { ...tx.aiGatewayInvocation,
    create: args => tx.aiGatewayInvocation.create({ ...args, data: { id: randomUUID(), ...args.data } }) } }));
  let root;
  const control = { verified: true, beforeRoute: null, result: { text: 'Synthetic authorized summary', usage: { inputTokens: 1, outputTokens: 2 } }, sent: [], events: [], claimed: new Set() };
  const ports = {
    routing: { resolve: async (_caller, required) => {
      if (control.beforeRoute) await control.beforeRoute();
      const context = await root.authorization.execution.authorize('task-a');
      return { context, consumerScope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
        route: { profile: structuredClone(h.state.aiProviderProfile[0]), scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant-a' },
          role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } },
        selection: { mode: 'tenant_managed', revision: 1 }, scene: 'chat', requiredCapabilities: required };
    }, assertCurrent: async (_caller, route) => {
      if (route.route.profile.configRevision !== h.state.aiProviderProfile[0].configRevision) throw Error('synthetic stale route');
    } },
    admission: { admit: async value => { control.events.push('admit'); return { ...value, id: randomUUID() }; } },
    dispatch: { claim: async binding => { if (control.claimed.has(binding.callId)) throw Error('synthetic duplicate dispatch');
      control.claimed.add(binding.callId); control.events.push('claim'); }, finish: async () => {} },
    budget: { reserve: async call => {
      await new PrismaGatewayInvocationBindings(h.db, root.authorization.scopes, () => new Date(h.control.now)).resolveForReserve(call.context, call.request);
      control.events.push('reserve'); return { id: 'synthetic-budget' };
    }, dispatch: async () => { control.events.push('budget-dispatch'); }, settle: async () => { control.events.push('settle'); },
    abandon: async (_call, _id, reason) => { control.events.push(`unknown:${reason}`); } },
    audit: { append: async () => {} },
    transport: { invoke: async (_context, request, _route, signal) => { assert.equal(signal.aborted, false);
      control.sent.push(structuredClone(request)); return structuredClone(control.result); }, stream: async function* () { throw Error('invoke-only test'); } }
  };
  const config = { ...h.authorization, db: h.db, guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    scene: { code: 'synthetic-clarification', version: '1' }, gatewayScene: { sceneCode: 'synthetic-clarification', routeScene: 'chat', maxOutputTokens: 64 },
    priceVersion: 'synthetic-price-1', runtime: { ports, evidence: 'mock', verifyEvidence: async () => control.verified }, clock: () => new Date(h.control.now) };
  root = composePersistedTaskModelInput(config);
  await root.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  const lease = await root.tasks.claimRun(h.claim());
  const material = { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Explain these authorized facts only.' }] }], maxOutputTokens: 32 };
  const command = () => ({ taskId: 'task-a', registrationRef: 'summary-a', expectedTaskRevision: h.state.aiTask[0].revision,
    lease: { ...lease, revision: h.state.aiRun[0].revision }, material: structuredClone(material) });
  const planned = { registrationRef: 'summary-a', operation: 'external_unknown', toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION };
  const register = async (syntheticStart = true) => {
    await root.plans.savePlan({ taskId: 'task-a', runId: 'run-a', taskRevision: h.state.aiTask[0].revision, steps: [planned], limits: h.plan.limits }, command().lease);
    const { taskId, expiresAt, ...held } = command().lease;
    const registered = await root.registrations.register({ taskId, registrationRef: 'summary-a', expectedTaskRevision: h.state.aiTask[0].revision, lease: held });
    const step = h.state.aiStep[0];
    // Step start is synthetic here; this test covers publication and the Gateway, not runner transitions or MySQL locks.
    if (syntheticStart) step.status = 'RUNNING';
    const leaseNow = command().lease;
    return { ref: { plan: planned, registered: { ...registered, stepRevision: step.revision } }, lease: leaseNow,
      binding: { taskId, runId: step.runId, stepId: step.id, actionId: step.actionId, inputRef: step.inputRef,
        fingerprint: step.requestFingerprint, lease: leaseNow } };
  };
  return { ...h, root, config, control, material, command, register };
}

for (const terminal of ['unknown', 'succeeded']) test(`formal model transition persists ${terminal} using bound evidence, never a second dispatch`, async () => {
  const h = await setup(); await h.root.publish(h.command());
  const r = await h.register(false);
  const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
  assert.throws(() => h.root.createTransitionAuthority(undefined));
  let financial;
  const authority = h.root.createTransitionAuthority({ readDispatch: async () => {
    if (!financial) throw Error('no financial fact'); return structuredClone(financial);
  } });
  const transitions = new AiStepTransitionRepository(h.db, authority, h.config.clock);
  const startCommand = h.root.commands.transition('start', r.ref, r.lease, null);
  const grant = await authority.resolve(startCommand);
  const validation = require('../apps/api/src/modules/ai-native/task-contract-validation');
  assert.equal(validation.isAiStepState(grant.next), true);
  const started = await transitions.transition(startCommand);
  assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  r.lease.revision = started.runRevision; r.ref.registered.taskRevision = started.event.taskRevision;
  r.ref.registered.stepRevision = started.event.data.stepRevision;
  const prepared = await h.root.invocations.prepare(r.ref, r.lease), step = h.state.aiStep[0];
  // Explicit persisted crash fixture, not a replacement transition authority.
  const artifact = { ...step, id: randomUUID(), stepId: step.id, stepFingerprint: step.requestFingerprint,
    leaseOwnerId: r.lease.holderId, fencingToken: h.state.aiRun[0].fencingToken,
    outcome: 'RUNNING', payload: {}, contentHash: require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint({}),
    outputBytes: 0n, activeMs: 0n, completeMeasurement: false, errorCode: null };
  h.state.aiTaskResultArtifact.push(artifact);
  for (const resource of ['STEPS', 'CALLS', 'ACTIVE_MS', 'OUTPUT_BYTES']) h.state.aiTaskExecutionCharge.push({
    ...artifact, chargeId: randomUUID(), resource, status: 'RESERVED', gatewayInvocationId: resource === 'CALLS' ? prepared.invocationId : null,
    requestFingerprint: 'a'.repeat(64) });
  if (terminal === 'succeeded') {
    const executor = await h.root.executors.resolve(TASK_TEXT_MODEL_TOOL, AI_TOOL_DRAFT_VERSION);
    const result = await executor.execute({ ...r.binding, lease: r.lease }, new AbortController().signal);
    assert.equal(result.kind, 'succeeded');
    Object.assign(artifact, { payload: result.payload, completeMeasurement: true, outcome: 'SUCCEEDED',
      contentHash: require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(result.payload),
      outputBytes: BigInt(Buffer.byteLength(JSON.stringify(result.payload))) });
    h.state.aiTaskResultArtifact[0] = artifact;
    const invocation = h.state.aiGatewayInvocation[0], config = h.state.aiTaskActionInput[0].payload.configuration;
    const receipt = { scopeId: step.scopeId, taskId: step.taskId, invocationId: invocation.id,
      tenantId: 'tenant-a', workspaceId: 'workspace-a', admissionId: randomUUID(), reservationId: randomUUID(),
      dispatchToken: 'synthetic-dispatch', requestHash: 'a'.repeat(64), state: 'dispatched' };
    h.state.aiGatewayAccountingReceipt.push(receipt);
    h.state.aiInvocationAdmission.push({ id: receipt.admissionId, tenantId: receipt.tenantId, workspaceId: receipt.workspaceId,
      actorId: invocation.actorId, callId: invocation.callId, profileId: config.configId, requestHash: receipt.requestHash,
      dispatchId: receipt.dispatchToken, revokedAt: null, status: 'completed' });
    financial = { state: 'dispatched', dispatchToken: receipt.dispatchToken, reservationId: receipt.reservationId,
      requestId: invocation.callId, callId: invocation.callId, actorId: invocation.actorId, scopeKey: `WORKSPACE:${step.scopeId}`,
      runId: step.runId, stepId: step.id, actionId: step.actionId, sceneCode: invocation.sceneCode,
      priceVersion: invocation.priceVersion, configRevision: config.configRevision, configurationHash: invocation.configurationHash };
  }
  const command = h.root.commands.transition(terminal === 'unknown' ? 'unknown' : 'succeed', r.ref, r.lease, artifact.id);
  const invocation = h.state.aiGatewayInvocation[0], originalActor = invocation.actorId;
  invocation.actorId = 'foreign';
  await assert.rejects(transitions.transition(command)); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  // Use the authenticated persisted invocation owner, never a caller-selected actor.
  h.state.aiGatewayInvocation[0].actorId = originalActor;
  await authority.resolve(command);
  const committed = await transitions.transition(command);
  assert.equal(committed.event.data.status, terminal);
  assert.equal(h.state.aiStep[0].effect, terminal === 'unknown' ? 'POSSIBLE' : 'NONE');
  assert.equal(h.control.sent.length, terminal === 'unknown' ? 0 : 1);
  await assert.rejects(transitions.transition(command));
});

test('current-authorized frozen input produces the original plan, step, invocation and one public Gateway call', async () => {
  const h = await setup();
  assert.equal(h.state.aiTaskActionInput.length, 0);
  const published = await h.root.publish(h.command());
  assert.equal((await h.root.publish(h.command())).replayed, true);
  const registered = await h.register(), row = h.state.aiTaskActionInput[0];
  assert.equal(row.id, published.id);
  assert.equal(AI_TOOL_CODES.includes(TASK_TEXT_MODEL_TOOL), false);
  assert.equal(AI_TASK_STEP_CODES.includes(TASK_TEXT_MODEL_TOOL), true);
  assert.equal(row.fingerprint, prepareGatewayTextIntent(row.payload.intent,
    { sceneCode: h.config.gatewayScene.sceneCode, maxOutputTokens: h.config.gatewayScene.maxOutputTokens }, 'invoke').intentHash);
  const prepared = await h.root.invocations.prepare(registered.ref, registered.lease);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiGatewayInvocation[0].id, prepared.invocationId);
  assert.deepEqual(h.control.sent, []); assert.deepEqual(h.control.events, []);
  assert.equal((await h.root.toolCatalog.resolve(TASK_TEXT_MODEL_TOOL, AI_TOOL_DRAFT_VERSION)).modelCall, true);
  const executor = await h.root.executors.resolve(TASK_TEXT_MODEL_TOOL, AI_TOOL_DRAFT_VERSION);
  const result = await executor.execute(registered.binding, new AbortController().signal);
  assert.equal(result.kind, 'succeeded'); assert.equal(h.control.sent.length, 1);
  assert.equal(h.control.sent[0].callId, row.payload.intent.requestId);
  assert.equal(h.control.sent[0].messages[0].content, h.material.messages[0].content[0].text);
  assert.equal(h.control.events.filter(e => e === 'reserve').length, 1); assert.ok(h.control.events.includes('settle'));
  assert.equal(await h.root.executors.resolve('caller.tool', AI_TOOL_DRAFT_VERSION), null);
});

test('publication rejects caller authority and late mutable material, and same-key changes conflict', async () => {
  const h = await setup(), command = h.command();
  await assert.rejects(h.root.publish({ ...command, configuration: { model: 'caller-model' } }), e => e.code === 'AI_INVALID_INPUT');
  h.control.beforeRoute = async () => { command.material.messages[0].content[0].text = 'late replacement'; h.control.beforeRoute = null; };
  await h.root.publish(command);
  assert.equal(h.state.aiTaskActionInput[0].payload.intent.messages[0].content[0].text, h.material.messages[0].content[0].text);
  await assert.rejects(h.root.publish(command), e => e.code === 'AI_REVISION_CONFLICT');
  const registered = await h.register();
  await assert.rejects(h.root.publish({ ...h.command(), registrationRef: 'late-step' }), e => e.code === 'AI_REVISION_CONFLICT');
  h.state.aiTaskActionInput[0].payload.priceVersion = 'tampered-price';
  await assert.rejects(h.root.invocations.prepare(registered.ref, registered.lease));
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.deepEqual(h.control.sent, []);
});

for (const change of ['config', 'owner', 'policy', 'evidence']) test(`${change} change refuses the frozen model call before invocation registration`, async () => {
  const h = await setup(); await h.root.publish(h.command()); const registered = await h.register();
  if (change === 'config') h.state.aiProviderProfile[0].configRevision++;
  if (change === 'owner') h.identity.membership = false;
  if (change === 'policy') h.state.aiTaskPlanPolicy[0].revision++;
  if (change === 'evidence') h.control.verified = false;
  await assert.rejects(h.root.invocations.prepare(registered.ref, registered.lease));
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.deepEqual(h.control.sent, []);
});

test('lost registration acknowledgement remains original-invocation reconciliation, never fresh readiness', async () => {
  const h = await setup(); await h.root.publish(h.command()); const registered = await h.register();
  h.storeControl.beforeCommit = async draft => { if (draft.aiGatewayInvocation.length && !h.state.aiGatewayInvocation.length) h.storeControl.loseReply = true; };
  await assert.rejects(h.root.invocations.prepare(registered.ref, registered.lease));
  assert.equal(h.state.aiGatewayInvocation.length, 1);
  h.storeControl.beforeCommit = null;
  await assert.rejects(h.root.invocations.prepare(registered.ref, registered.lease), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.deepEqual(h.control.sent, []);
});

test('missing usage is unknown without settlement, and aborted execution never sends a model request', async () => {
  const h = await setup(); await h.root.publish(h.command()); const registered = await h.register();
  await h.root.invocations.prepare(registered.ref, registered.lease);
  const executor = await h.root.executors.resolve(TASK_TEXT_MODEL_TOOL, AI_TOOL_DRAFT_VERSION);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(executor.execute(registered.binding, aborted.signal)); assert.deepEqual(h.control.sent, []);
  h.control.result = { text: 'Summary without provider usage' };
  const result = await executor.execute(registered.binding, new AbortController().signal);
  assert.equal(result.kind, 'unknown'); assert.equal(result.payload.usage.kind, 'unknown');
  assert.equal(h.control.events.includes('settle'), false); assert.equal(h.control.sent.length, 1);
});
