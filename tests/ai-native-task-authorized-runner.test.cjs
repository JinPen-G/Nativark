'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
const compose = input => require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition').composeAuthorizedPersistentTaskInputRunner(input);

test('formal persisted authorization composes with actual runner, evidence, accounting and input repositories', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  const policies = h.clone(h.state.aiTaskActionPolicy), gates = h.clone(h.state.aiBudgetPolicy);
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 2);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.deepEqual(h.state.aiTaskActionPolicy, policies); assert.deepEqual(h.state.aiBudgetPolicy, gates);
});

test('original non-effect charge validation batches current run reads without weakening unknown or scope checks', { timeout: 12000 }, async () => {
  const h = await authorizedRunnerHarness(), configuration = h.configuration();
  configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
  const root = compose(configuration), release = root.runner.deps.leases.releaseRun;
  let originalLease;
  root.runner.deps.leases.releaseRun = async command => {
    originalLease = h.held();
    return release(command);
  };
  assert.equal((await root.runner.runPrepared(h.claim(), async () => {})).status, 'succeeded');
  assert.ok(h.state.aiTaskRunOverhead.length > 1);
  assert.equal(h.state.aiTaskRunPreparation.length, 1);
  const key = { scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' };
  const originalState = h.clone(h.state);
  const findMany = h.db.aiTaskExecutionCharge.findMany.bind(h.db.aiTaskExecutionCharge);
  const findUnique = h.db.aiTaskExecutionCharge.findUnique.bind(h.db.aiTaskExecutionCharge);
  const queries = [];
  let individualLookups = 0;
  h.db.aiTaskExecutionCharge.findUnique = async query => { individualLookups++; return findUnique(query); };
  h.db.aiTaskExecutionCharge.findMany = async query => { queries.push(h.clone(query)); return findMany(query); };
  const { taskPreparationNonEffectChargeIds } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-preparation');
  const ids = await taskPreparationNonEffectChargeIds(h.db, key, originalLease);
  assert.equal(individualLookups, 0, 'validated run charges must not incur one database round trip per interval');
  assert.equal(queries.length, 2, 'one bounded charge read per original evidence category');
  for (const query of queries) {
    assert.equal(query.where.scopeId, key.scopeId);
    assert.equal(query.where.taskId, key.taskId);
    assert.equal(query.where.runId, key.runId);
    assert.ok(query.where.chargeId.in.length > 0 && query.take <= 1001);
  }
  assert.deepEqual([...ids].sort(), h.state.aiTaskExecutionCharge.filter(row => row.stepId === null).map(row => row.chargeId).sort());
  assert.deepEqual(h.state, originalState, 'reading original time evidence cannot settle, reserve or execute anything');
  const target = h.state.aiTaskRunOverhead[0].chargeId;
  h.db.aiTaskExecutionCharge.findMany = async query => (await findMany(query)).map(row => row.chargeId === target ? { ...row, status: 'UNKNOWN' } : row);
  await assert.rejects(taskPreparationNonEffectChargeIds(h.db, key, originalLease), error => error.code === 'AI_RESULT_UNKNOWN');
  h.db.aiTaskExecutionCharge.findMany = async query => (await findMany(query)).filter(row => row.chargeId !== target);
  await assert.rejects(taskPreparationNonEffectChargeIds(h.db, key, originalLease), error => error.code === 'AI_ACCESS_DENIED');
  h.db.aiTaskExecutionCharge.findMany = async query => (await findMany(query)).map(row => row.chargeId === target ? { ...row, scopeId: 'scope-foreign' } : row);
  await assert.rejects(taskPreparationNonEffectChargeIds(h.db, key, originalLease), error => error.code === 'AI_ACCESS_DENIED');
  h.db.aiTaskExecutionCharge.findMany = findMany;
  h.db.aiTaskExecutionCharge.findUnique = findUnique;
  assert.deepEqual(h.state, originalState);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

test('preparation admission reply uses its declared window and the unchanged cumulative quota', { timeout: 12000 }, async () => {
  const h = await authorizedRunnerHarness(), configuration = h.configuration();
  configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
  const originalPlan = h.clone(h.state.aiTaskRunPlan), originalPolicies = h.clone(h.state.aiTaskPlanPolicy ?? []);
  const transact = h.db.$transaction.bind(h.db);
  let delayed = false;
  h.db.$transaction = async (...args) => {
    const value = await transact(...args);
    if (!delayed && h.state.aiTaskRunPreparation.some(row => row.chargeId && !row.completedAt)) {
      delayed = true;
      // Only a committed reply is delayed; no transaction or tool waits here.
      await new Promise(resolve => setTimeout(resolve, 5200));
      h.control.tick += 5200;
    }
    return value;
  };
  const root = compose(configuration);
  const prepare = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service').withAiTaskHeldPreparationWindow(
    async () => { h.control.tick += 11; }, 5000);
  const outcome = await root.runner.runPrepared(h.claim(), prepare);
  assert.equal(delayed, true); assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.deepEqual(h.state.aiTaskRunPlan, originalPlan); assert.deepEqual(h.state.aiTaskPlanPolicy ?? [], originalPolicies);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].maxActiveMs, 10000n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 5231n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);

  const late = await authorizedRunnerHarness(), lateConfig = late.configuration();
  lateConfig.clock = { now: () => late.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
  const lateTransaction = late.db.$transaction.bind(late.db);
  let exhausted = false, preparationStarted = false;
  late.db.$transaction = async (...args) => {
    const value = await lateTransaction(...args);
    if (!exhausted && late.state.aiTaskRunPreparation.some(row => row.chargeId && !row.completedAt)) {
      exhausted = true;
      late.control.tick += 10001; // A trusted reply cannot create time beyond the original 10000ms reservation.
    }
    return value;
  };
  const lateRoot = compose(lateConfig);
  await assert.rejects(lateRoot.runner.runPrepared(late.claim(), async () => { preparationStarted = true; }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(exhausted, true);
  assert.equal(preparationStarted, false);
  assert.deepEqual(late.executions, []);
  assert.equal(late.state.aiTaskExecutionBudget[0].maxActiveMs, 10000n);
  assert.equal(late.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.ok(late.state.aiTaskExecutionCharge.some(row => row.resource === 'ACTIVE_MS' && row.actualAmount === null && row.status === 'UNKNOWN'));
});

test('unknown resource cleanup rejection preserves uncertainty and the original reservations', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  let original;
  h.control.execute = () => {
    original = h.clone(h.state);
    h.identity.session = false;
    return { kind: 'unknown' };
  };
  await assert.rejects(root.runner.run(h.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.deepEqual(h.state, original, 'lost cleanup authority cannot guess a failed/no-effect result or free resources');
  assert.equal(h.state.aiTask[0].status, 'RUNNING');
  assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.ok(h.state.aiTaskExecutionCharge.some(row => row.status === 'RESERVED'));
});

test('settled input supervision failure preserves original time and explicit continuation while unknown supervision keeps its original occupancy', { timeout: 12000 }, async () => {
  const configure = async () => {
    const h = await authorizedRunnerHarness(), configuration = h.configuration();
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
    return { h, root: compose(configuration) };
  };
  const { h, root } = await configure();
  const { AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const originalSource = h.source.resolve;
  h.source.resolve = async () => { h.control.tick += 7; throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); };
  const release = root.runner.deps.leases.releaseRun;
  let originalPrefix;
  root.runner.deps.leases.releaseRun = async command => {
    originalPrefix = h.clone({ steps: h.state.aiStep, artifacts: h.state.aiTaskResultArtifact,
      charges: h.state.aiTaskExecutionCharge.filter(row => row.stepId != null) });
    const receipt = await release(command);
    h.control.tick += 18; // The original release reply is active time, not a new reservation.
    return receipt;
  };
  await assert.rejects(root.runner.run(h.claim()), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiTask[0].status, 'RUNNING', 'rejected supervision cannot fabricate aggregate success');
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskInputRequest.length, 0);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].maxActiveMs, 10000n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 35n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.deepEqual({ steps: h.state.aiStep, artifacts: h.state.aiTaskResultArtifact,
    charges: h.state.aiTaskExecutionCharge.filter(row => row.stepId != null) }, originalPrefix);
  const closing = h.state.aiTaskRunOverhead.at(-1);
  assert.equal(closing.activeMs, 25n); assert.ok(closing.completedAt && closing.measurementHash);

  const originalInputs = h.clone(h.state.aiTaskActionInput);
  const originalPlan = h.clone(h.state.aiTaskRunPlan);
  const originalCharges = h.clone(h.state.aiTaskExecutionCharge);
  const originalOverheads = h.clone(h.state.aiTaskRunOverhead);
  const originalStep = h.clone(h.state.aiStep[0]);
  const originalArtifact = h.clone(h.state.aiTaskResultArtifact[0]);
  const originalPolicies = h.clone(h.state.aiTaskActionPolicy);
  h.source.resolve = originalSource;
  root.runner.deps.leases.releaseRun = release;
  const beforeDenied = h.clone(h.state);
  h.identity.session = false;
  await assert.rejects(root.runner.run(h.claim()), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, beforeDenied, 'settled resources do not replace current execution authority');
  h.identity.session = true;
  const continued = await root.runner.run(h.claim());
  assert.equal(continued.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue'], 'the completed prefix is never executed again');
  assert.deepEqual(h.state.aiStep[0], originalStep);
  assert.deepEqual(h.state.aiTaskResultArtifact[0], originalArtifact);
  for (const row of originalCharges) assert.deepEqual(h.state.aiTaskExecutionCharge.find(current => current.chargeId === row.chargeId), row);
  for (const row of originalOverheads) assert.deepEqual(h.state.aiTaskRunOverhead.find(current => current.id === row.id), row);
  assert.deepEqual(h.state.aiTaskActionInput, originalInputs);
  assert.deepEqual(h.state.aiTaskRunPlan, originalPlan);
  assert.deepEqual(h.state.aiTaskActionPolicy, originalPolicies);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].maxActiveMs, 10000n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 45n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskInputRequest.length, 0);
  assert.equal(h.state.aiRun.length, 1);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));

  const { h: unknown, root: unknownRoot } = await configure();
  unknownRoot.runner.deps.inputs.afterSucceeded = () => new Promise(() => {});
  await assert.rejects(unknownRoot.runner.run(unknown.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(unknown.executions, ['input-clarify']);
  assert.equal(unknown.state.aiStep[0].status, 'SUCCEEDED');
  assert.ok(unknown.state.aiRun[0].leaseOwnerId, 'an uncertain input acknowledgement cannot authorize release');
  const original = unknown.state.aiTaskRunOverhead.at(-1);
  assert.equal(original.completedAt, null); assert.equal(original.activeMs, null);
  const charge = unknown.state.aiTaskExecutionCharge.find(row => row.chargeId === original.id);
  assert.equal(charge.status, 'UNKNOWN'); assert.equal(charge.actualAmount, null);
  assert.equal(unknown.state.aiTaskExecutionBudget[0].reservedActiveMs, charge.amount);
});

test('original orchestration reads and result accounting consume one cumulative active ledger without repeating unknown intervals', async () => {
  const h = await authorizedRunnerHarness(), configuration = h.configuration();
  configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
  const originalPlan = h.clone(h.state.aiTaskRunPlan), originalPolicies = h.clone(h.state.aiTaskPlanPolicy ?? []);
  h.storeControl.beforeRead = async name => { if (name === 'aiStep') h.control.tick += 2; };
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskExecutionCharge') h.control.tick += 4; };
  h.storeControl.beforeCommit = async () => { h.control.tick += 3; };
  const root = compose(configuration), result = await root.runner.run(h.claim());
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  const intervals = h.state.aiTaskRunOverhead;
  assert.equal(intervals.length, 3, 'one reserved orchestration interval per step bridges its result COMMIT without counting the tool twice');
  assert.deepEqual(intervals.map(row => row.segment), ['startup', 'pre:clarify', 'pre:continue'], 'atomic handoff preserves each original interval; the last also meters the aggregate');
  assert.ok(intervals.every(row => row.completedAt && row.activeMs > 0n && row.measurementHash));
  const expected = h.state.aiTaskResultArtifact.reduce((n, row) => n + row.activeMs, 0n)
    + intervals.reduce((n, row) => n + row.activeMs, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, expected);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.deepEqual(h.state.aiTaskRunPlan, originalPlan);
  assert.deepEqual(h.state.aiTaskPlanPolicy ?? [], originalPolicies);

  // A second instance can reconcile only the same original completed evidence.
  const read = await authorizedRunnerHarness(), r = read.compose(), lease = await r.authorization.tasks.claimRun(read.claim());
  await r.runner.deps.resources.open(lease, false);
  const overhead = r.runner.deps.resources.overhead;
  const beforeWrongDeadline = read.clone(read.state);
  await assert.rejects(overhead.begin({ ...lease, expiresAt: new Date(Date.parse(lease.expiresAt) + 1).toISOString() },
    'rewritten-execution-deadline', 100, false, false), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(read.state, beforeWrongDeadline, 'a rewritten deadline cannot persist a marker, charge or fresh window');
  const ticket = await overhead.begin(lease, 'original', undefined, false, false);
  assert.equal(ticket.remainingMs, read.plan.limits.maxStepMs, 'startup window comes from the original authorized plan');
  assert.equal(read.state.aiTaskExecutionCharge[0].amount, BigInt(read.plan.limits.maxStepMs));
  read.control.tick += 11;
  await overhead.complete(ticket, lease);
  const consumed = read.state.aiTaskExecutionBudget[0].consumedActiveMs;
  await read.compose().accounting.reconcile({ taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` });
  assert.equal(read.state.aiTaskExecutionBudget[0].consumedActiveMs, consumed);
  await assert.rejects(overhead.begin(lease, 'original', 100, false, false), e => e.code === 'AI_RESULT_UNKNOWN');
  const completed = read.state.aiTaskRunOverhead[0], originalMeasurement = completed.measurementHash;
  completed.measurementHash = 'a'.repeat(64);
  await assert.rejects(r.accounting.reconcile({ taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` }), e => e.code === 'AI_ACCESS_DENIED');
  completed.measurementHash = originalMeasurement;
  const originalBudgetFingerprint = read.state.aiTaskExecutionBudget[0].policyFingerprint;
  read.state.aiTaskExecutionBudget[0].policyFingerprint = 'b'.repeat(64);
  await assert.rejects(r.accounting.reconcile({ taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` }), e => e.code === 'AI_ACCESS_DENIED');
  read.state.aiTaskExecutionBudget[0].policyFingerprint = originalBudgetFingerprint;

  // A durable measurement with a lost COMMIT reply is not yet accounted. New
  // work remains closed until that same original evidence settles its charge.
  const lost = await authorizedRunnerHarness(), l = lost.compose(), lostLease = await l.authorization.tasks.claimRun(lost.claim());
  await l.runner.deps.resources.open(lostLease, false);
  const lostTicket = await l.runner.deps.resources.overhead.begin(lostLease, 'lost-measurement-reply', 100, false, false);
  lost.control.tick += 9; lost.storeControl.loseReply = true;
  await assert.rejects(l.runner.deps.resources.overhead.complete(lostTicket, lostLease), e => e.code === 'AI_RESULT_UNKNOWN');
  await l.runner.deps.resources.overhead.abandon(lostTicket, lostLease);
  assert.ok(lost.state.aiTaskRunOverhead[0].completedAt);
  const lostBudget = lost.clone(lost.state.aiTaskExecutionBudget);
  await assert.rejects(lost.compose().runner.deps.resources.overhead.begin(lostLease, 'new-key-after-lost-reply', 100, false, false), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(lost.state.aiTaskExecutionBudget, lostBudget);
  assert.equal(lost.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
  await lost.compose().accounting.reconcile({ taskId: lostLease.taskId, lease: lostLease, chargeId: lostTicket.key, evidenceRef: `overhead:${lostTicket.key}` });
  assert.equal(lost.state.aiTaskExecutionBudget[0].consumedActiveMs, 9n);
  assert.equal(lost.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.equal(lost.state.aiTaskExecutionCharge.length, 1);
  assert.deepEqual(lost.executions, []);

  const interrupted = await authorizedRunnerHarness(), i = interrupted.compose(), held = await i.authorization.tasks.claimRun(interrupted.claim());
  await i.runner.deps.resources.open(held, false);
  const pending = await i.runner.deps.resources.overhead.begin(held, 'uncertain', 100, false, false);
  await i.runner.deps.resources.overhead.abandon(pending, held);
  const before = interrupted.clone(interrupted.state.aiTaskExecutionBudget);
  await assert.rejects(interrupted.compose().runner.deps.resources.overhead.begin(held, 'different-key', 100, false, false), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(interrupted.state.aiTaskExecutionBudget, before);
  assert.equal(interrupted.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
  assert.equal(interrupted.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
  assert.deepEqual(interrupted.executions, []);
});

test('preparation hands its original clock to startup atomically without replay after rollback or lost COMMIT', async () => {
  for (const mode of ['normal', 'rollback', 'lost']) {
    const h = await authorizedRunnerHarness(), root = h.compose(), lease = await root.authorization.tasks.claimRun(h.claim());
    const resources = root.runner.deps.resources, preparation = resources.preparation;
    const plan = h.clone(h.state.aiTaskRunPlan), ticket = await preparation.begin(lease, undefined, 300);
    h.control.tick += 11; let injected = false;
    h.storeControl.beforeWrite = async (name, args) => {
      if (name === 'aiTaskRunPreparation' && args.data?.completedAt) h.control.tick += 5;
    };
    h.storeControl.beforeCommit = async draft => {
      if (injected || !draft.aiTaskRunPreparation.some(row => row.id === ticket.key && row.completedAt)
        || !draft.aiTaskRunOverhead.some(row => row.segment === 'startup')) return;
      injected = true; h.control.tick += 7;
      if (mode === 'rollback') throw Error('synthetic preparation/startup rollback');
      if (mode === 'lost') h.storeControl.loseReply = true;
    };
    const before = h.clone(h.state.aiTaskExecutionBudget);
    if (mode !== 'normal') {
      await assert.rejects(preparation.handoff(ticket, lease, false, false), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(injected, true); assert.deepEqual(h.executions, []);
      await assert.rejects(preparation.handoff(ticket, lease, false, false), error => error.code === 'AI_RESULT_UNKNOWN');
      if (mode === 'rollback') {
        assert.deepEqual(h.state.aiTaskExecutionBudget, before);
        assert.equal(h.state.aiTaskRunOverhead.length, 0); assert.equal(h.state.aiTaskExecutionCharge.length, 1);
        assert.equal(h.state.aiTaskRunPreparation[0].completedAt, null);
        await preparation.abandon(ticket, lease);
        assert.equal(h.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
        assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 300n);
      } else {
        const old = h.state.aiTaskRunPreparation[0], next = h.state.aiTaskRunOverhead[0];
        assert.equal(old.activeMs, 11n); assert.equal(next.completedAt, null);
        assert.equal(h.state.aiTaskExecutionCharge.find(row => row.chargeId === ticket.key).status, 'RECORDED');
        assert.equal(h.state.aiTaskExecutionCharge.find(row => row.chargeId === next.id).status, 'UNKNOWN');
        assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 11n);
        assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 1000n);
        const retained = h.clone(h.state.aiTaskExecutionBudget);
        await root.accounting.reconcile({ taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `preparation:${ticket.key}` });
        assert.deepEqual(h.state.aiTaskExecutionBudget, retained);
        await assert.rejects(resources.overhead.begin(lease, 'not-a-handoff-retry', 1000, false, false), error => error.code === 'AI_RESULT_UNKNOWN');
      }
    } else {
      const startup = await preparation.handoff(ticket, lease, false, false);
      assert.equal(injected, true); assert.equal(startup.remainingMs, 988);
      const old = h.state.aiTaskRunPreparation[0], next = h.state.aiTaskRunOverhead[0];
      assert.equal(old.activeMs, 11n); assert.deepEqual(old.completedAt, next.startedAt);
      assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 11n);
      h.control.tick += 3;
      const receipt = await root.authorization.tasks.releaseRun({ taskId: lease.taskId, runId: lease.runId,
        holderId: lease.holderId, expectedTaskRevision: h.state.aiTask[0].revision,
        expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
      await resources.overhead.completeAfterRelease(startup, lease, receipt);
      const released = h.clone(h.state.aiRun), closedBudget = h.clone(h.state.aiTaskExecutionBudget);
      const accountingLease = { ...lease, revision: receipt.revision, expiresAt: '' };
      await root.accounting.reconcile({ taskId: lease.taskId, lease: accountingLease, chargeId: ticket.key,
        evidenceRef: `preparation:${ticket.key}` });
      assert.deepEqual(h.state.aiRun, released); assert.deepEqual(h.state.aiTaskExecutionBudget, closedBudget);
      await assert.rejects(resources.preparation.begin(accountingLease, undefined, 300), error => error.code === 'AI_ACCESS_DENIED');
      h.identity.session = false;
      await assert.rejects(root.accounting.reconcile({ taskId: lease.taskId, lease: accountingLease, chargeId: ticket.key,
        evidenceRef: `preparation:${ticket.key}` }), error => error.code === 'AI_ACCESS_DENIED');
      h.identity.session = true;
      assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 26n);
      assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
      assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
      await assert.rejects(preparation.handoff(ticket, lease, false, false), error => error.code === 'AI_RESULT_UNKNOWN');
    }
    assert.deepEqual(h.state.aiTaskRunPlan, plan);
  }

  const h = await authorizedRunnerHarness(), root = h.compose(); let injected = false;
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiTaskRunPreparation' && args.data?.completedAt) h.control.tick += 5;
  };
  h.storeControl.beforeCommit = async draft => {
    if (!injected && draft.aiTaskRunPreparation.some(row => row.completedAt) && draft.aiTaskRunOverhead.some(row => row.segment === 'startup')) {
      injected = true; h.control.tick += 7;
    }
  };
  const result = await root.runner.runPrepared(h.claim(), async () => { h.control.tick += 11; });
  assert.equal(result.status, 'succeeded'); assert.equal(injected, true);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  const prep = h.state.aiTaskRunPreparation[0], startup = h.state.aiTaskRunOverhead.find(row => row.segment === 'startup');
  assert.deepEqual(prep.completedAt, startup.startedAt); assert.equal(startup.activeMs, 12n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 43n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));

  const unavailable = await authorizedRunnerHarness(), missing = unavailable.compose();
  missing.runner.deps.resources.preparation.handoff = undefined;
  assert.equal((await missing.runner.runPrepared(unavailable.claim(), async () => assert.fail('Missing atomic adapter cannot prepare'))).status, 'unavailable');
  assert.deepEqual(unavailable.executions, []); assert.equal(unavailable.state.aiTaskExecutionCharge.length, 0);
});

test('atomic original Run time handoff meters its COMMIT and keeps lost successor occupancy without replay', async () => {
  const missing = await authorizedRunnerHarness(), unavailable = missing.compose();
  unavailable.runner.deps.resources.overhead.completeAfterRelease = undefined;
  assert.equal((await unavailable.runner.run(missing.claim())).status, 'unavailable');
  assert.deepEqual(missing.executions, []);
  assert.equal(missing.state.aiTaskExecutionCharge.length, 0, 'an incomplete atomic/final-time adapter cannot report unaccounted success');
  const prepare = async () => {
    const h = await authorizedRunnerHarness(), root = h.compose(), lease = await root.authorization.tasks.claimRun(h.claim());
    await root.runner.deps.resources.open(lease, false);
    const overhead = root.runner.deps.resources.overhead, ticket = await overhead.begin(lease, 'handoff-original', 100, false, false);
    h.control.tick += 11;
    return { h, root, lease, overhead, ticket };
  };
  for (const mode of ['normal', 'rollback', 'lost']) {
    const { h, root, lease, overhead, ticket } = await prepare(); let injected = false;
    h.storeControl.beforeWrite = async (name, args) => {
      if (name === 'aiTaskRunOverhead' && args.where?.id === ticket.key && args.data?.completedAt) h.control.tick += 5;
    };
    h.storeControl.beforeCommit = async draft => {
      if (injected || !draft.aiTaskRunOverhead.some(row => row.id === ticket.key && row.completedAt)
        || !draft.aiTaskRunOverhead.some(row => row.segment === 'handoff-successor')) return;
      injected = true; h.control.tick += 7;
      if (mode === 'rollback') throw Error('synthetic atomic handoff rollback');
      if (mode === 'lost') h.storeControl.loseReply = true;
    };
    const before = h.clone(h.state.aiTaskExecutionBudget);
    if (mode !== 'normal') {
      await assert.rejects(overhead.rotate(ticket, lease, 'handoff-successor', 100, false), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(injected, true); assert.deepEqual(h.executions, []);
      if (mode === 'rollback') {
        assert.deepEqual(h.state.aiTaskExecutionBudget, before);
        assert.equal(h.state.aiTaskRunOverhead.length, 1); assert.equal(h.state.aiTaskExecutionCharge.length, 1);
        assert.equal(h.state.aiTaskRunOverhead[0].completedAt, null);
        await overhead.abandon(ticket, lease);
        assert.equal(h.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
        assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
      } else {
        assert.equal(h.state.aiTaskRunOverhead.length, 2); assert.equal(h.state.aiTaskExecutionCharge.length, 2);
        const old = h.state.aiTaskRunOverhead.find(row => row.id === ticket.key), next = h.state.aiTaskRunOverhead.find(row => row.id !== ticket.key);
        assert.equal(old.activeMs, 11n); assert.equal(next.completedAt, null);
        assert.equal(h.state.aiTaskExecutionCharge.find(row => row.chargeId === next.id).status, 'UNKNOWN');
        assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 11n);
        assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
        const retained = h.clone(h.state.aiTaskExecutionBudget);
        await assert.rejects(overhead.begin(lease, 'different-key-after-handoff-loss', 100, false, false), error => error.code === 'AI_RESULT_UNKNOWN');
        await assert.rejects(overhead.rotate(ticket, lease, 'different-successor', 100, false), error => error.code === 'AI_RESULT_UNKNOWN');
        await root.accounting.reconcile({ taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` });
        assert.deepEqual(h.state.aiTaskExecutionBudget, retained);
      }
      continue;
    }
    const next = await overhead.rotate(ticket, lease, 'handoff-successor', 100, false);
    assert.equal(injected, true); assert.equal(next.remainingMs, 88, '5ms measurement write + 7ms COMMIT reply consume the already-reserved successor');
    const old = h.state.aiTaskRunOverhead.find(row => row.id === ticket.key), opened = h.state.aiTaskRunOverhead.find(row => row.id === next.key);
    assert.equal(old.activeMs, 11n); assert.deepEqual(old.completedAt, opened.startedAt, 'one original timing boundary, no gap or overlap');
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 11n);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
    h.control.tick += 3;
    const release = await root.authorization.tasks.releaseRun({ taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
      expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
    await overhead.completeAfterRelease(next, lease, { released: true, revision: release.revision });
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 26n);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
    assert.ok(h.state.aiTaskExecutionCharge.every(charge => charge.status === 'RECORDED'));
    assert.deepEqual(h.executions, []);
  }
});

test('original result persistence and COMMIT stay inside reserved orchestration without duplicate tool time or replay', async () => {
  const prepare = async (mode = 'normal', writeMs = 23, commitMs = 17) => {
    const h = await authorizedRunnerHarness(), configuration = h.configuration(); let resultCommit = false, injected = false;
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
    h.storeControl.beforeWrite = async (name, args) => {
      if (name === 'aiTaskResultArtifact' && args.data?.completeMeasurement === true) {
        h.control.tick += writeMs; resultCommit = true;
      }
    };
    h.storeControl.beforeCommit = async () => {
      if (!resultCommit) return;
      resultCommit = false; h.control.tick += commitMs;
      if (mode === 'normal' || injected) return;
      injected = true;
      if (mode === 'lost') h.storeControl.loseReply = true;
      else throw Error('synthetic result COMMIT rollback');
    };
    return { h, root: compose(configuration) };
  };
  for (const mode of ['normal', 'lost']) {
    const { h, root } = await prepare(mode), plan = h.clone(h.state.aiTaskRunPlan);
    assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
    assert.deepEqual(h.executions, ['input-clarify', 'input-continue'], 'lost delivery reads the original result, never repeats its callback');
    assert.deepEqual(h.state.aiTaskRunPlan, plan);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    assert.deepEqual(h.state.aiTaskResultArtifact.map(row => row.activeMs), [10n, 10n], 'original tool measurement is unchanged');
    const intervals = h.state.aiTaskRunOverhead;
    assert.deepEqual(intervals.map(row => row.activeMs), [0n, 40n, 40n]);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 100n, '20ms tool + 80ms actual result SQL/COMMIT, not 120ms');
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, BigInt(h.control.tick));
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
    assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
    assert.equal(h.state.aiTaskExecutionCharge.filter(row => row.stepId !== null && row.resource === 'ACTIVE_MS').length, 2);
  }
  const { h: rollback, root: rollbackRoot } = await prepare('rollback');
  assert.equal((await rollbackRoot.runner.run(rollback.claim())).status, 'unknown');
  assert.deepEqual(rollback.executions, ['input-clarify']);
  assert.equal(rollback.state.aiTaskResultArtifact.length, 1);
  assert.equal(rollback.state.aiTaskResultArtifact[0].completeMeasurement, false);
  const original = rollback.state.aiTaskExecutionCharge.find(row => row.stepId !== null && row.resource === 'ACTIVE_MS');
  assert.equal(original.status, 'UNKNOWN'); assert.equal(original.actualAmount, null);
  assert.equal(rollback.state.aiTaskExecutionBudget[0].reservedActiveMs, original.amount, 'rollback cannot fabricate tool time or refund original occupancy');
  assert.equal(rollback.state.aiTaskExecutionBudget[0].consumedActiveMs, 40n, 'only known current orchestration is recorded');

  const { h: exhausted, root: exhaustedRoot } = await prepare('normal', 1000, 17);
  await assert.rejects(exhaustedRoot.runner.run(exhausted.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(exhausted.executions, ['input-clarify']);
  assert.ok(exhausted.state.aiTaskResultArtifact[0].completeMeasurement, 'committed business/result evidence is not rolled back by a timing limit');
  const open = exhausted.state.aiTaskRunOverhead.find(row => row.completedAt === null);
  assert.ok(open); assert.equal(exhausted.state.aiTaskExecutionCharge.find(row => row.chargeId === open.id).status, 'UNKNOWN');
  assert.ok(exhausted.state.aiTaskExecutionBudget[0].reservedActiveMs >= 1000n, 'suffix outside the original allowance stays occupied, not free');
  assert.deepEqual(exhausted.state.aiTaskRunOverhead.map(row => row.segment), ['startup', 'pre:clarify'],
    'only the admitted startup-to-first-step handoff exists; no fresh post interval hides exhaustion');
});

test('input checkpoint and terminal aggregate stay metered while original closed time reconciles without new execution rights', async () => {
  const prepare = async () => {
    const h = await authorizedRunnerHarness(), configuration = h.configuration(); let latestReplyGuard = 0;
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => { latestReplyGuard = ms; return setTimeout(callback, ms); }, clearTimeout: timer => clearTimeout(timer) };
    const root = compose(configuration), replyGuards = { reserve: [], record: [] }, overhead = root.runner.deps.resources.overhead;
    const begin = overhead.begin, complete = overhead.complete, rotate = overhead.rotate, afterRelease = overhead.completeAfterRelease;
    overhead.begin = (...args) => { replyGuards.reserve.push(latestReplyGuard); return begin(...args); };
    overhead.rotate = (...args) => { replyGuards.reserve.push(latestReplyGuard); return rotate(...args); };
    overhead.complete = (...args) => { replyGuards.record.push(latestReplyGuard); return complete(...args); };
    overhead.completeAfterRelease = (...args) => { replyGuards.record.push(latestReplyGuard); return afterRelease(...args); };
    return { h, root, replyGuards };
  };
  const receiptLease = (h, row) => ({ taskId: 'task-a', runId: 'run-a', holderId: row.leaseOwnerId,
    revision: h.state.aiRun[0].revision, fencingToken: h.state.aiRun[0].fencingToken.toFixed(0) });
  const { h: waiting, root: waitRoot } = await prepare(); waiting.control.needsInput = true;
  const requirement = waiting.source.resolve;
  waiting.source.resolve = async binding => { waiting.control.tick += 7; return requirement(binding); };
  waiting.storeControl.beforeCommit = async () => { waiting.control.tick += 3; };
  assert.equal((await waitRoot.runner.run(waiting.claim())).status, 'paused');
  const post = waiting.state.aiTaskRunOverhead.at(-1);
  assert.ok(post?.completedAt && post.activeMs >= 10n, 'question source and input COMMIT are active, not human wait');
  assert.equal(waiting.state.aiTask[0].status, 'WAITING_INPUT'); assert.equal(waiting.state.aiTaskInputRequest.length, 1);
  assert.equal(waiting.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n); assert.deepEqual(waiting.executions, ['input-clarify']);
  const waitSnapshot = waiting.clone(waiting.state);
  waiting.control.now = new Date(waiting.control.now.getTime() + 7200000);
  assert.deepEqual(waiting.state, waitSnapshot, 'released human wait creates neither active charges nor new steps');

  const { h, root, replyGuards } = await prepare();
  h.storeControl.beforeWrite = async (name, args) => { if (name === 'aiTask' && args.data?.status === 'SUCCEEDED') h.control.tick += 13; };
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  const closing = h.state.aiTaskRunOverhead.at(-1);
  assert.ok(closing?.completedAt && closing.activeMs >= 13n, 'aggregate CAS/acknowledgement is charged, not a free suffix');
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.equal(h.state.aiRun[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.ok(replyGuards.reserve.length > 0 && replyGuards.reserve.every(ms => ms === 15000));
  assert.ok(replyGuards.record.length > 0 && replyGuards.record.every(ms => ms === 15000));
  assert.equal(h.plan.limits.maxStepMs, 1000, 'a longer finite accounting reply guard never changes the original tool work ceiling');
  const current = receiptLease(h, closing), before = h.clone(h.state);
  await root.accounting.reconcile({ taskId: 'task-a', lease: current, chargeId: closing.id, evidenceRef: `overhead:${closing.id}` });
  assert.deepEqual(h.state, before, 'closed original time observation is exactly idempotent');
  await assert.rejects(root.evidence.resolve(await root.authorization.tasks.readMetadata('task-a'), { ...current, expiresAt: '' }, false), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(root.evidence.withAccountingRun({ ...current, expiresAt: '' }, async () => { throw Error('must not enter participant'); }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(root.accounting.reserve({ taskId: 'task-a', lease: current, chargeId: 'terminal-cannot-reserve-time', resource: 'active_ms', amount: 1n, target: { kind: 'run' } }), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);

  const { h: lost, root: lostRoot } = await prepare(); let injected = false;
  lost.storeControl.beforeWrite = async (name, args, data) => {
    if (!injected && name === 'aiTaskRunOverhead' && args.data?.completedAt && data.aiTask[0].status === 'SUCCEEDED') {
      injected = true; lost.storeControl.loseReply = true;
    }
  };
  await assert.rejects(lostRoot.runner.run(lost.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(injected, true); const original = lost.state.aiTaskRunOverhead.at(-1);
  assert.ok(original.completedAt && original.measurementHash); assert.equal(lost.state.aiTask[0].status, 'SUCCEEDED');
  const committedOriginalCharge = lost.state.aiTaskExecutionCharge.find(row => row.chargeId === original.id);
  assert.equal(committedOriginalCharge.status, 'RECORDED', 'measurement and original charge survived the same committed transaction');
  assert.equal(committedOriginalCharge.actualAmount, original.activeMs);
  const oldBudget = lost.clone(lost.state.aiTaskExecutionBudget), originalReceipt = lost.clone(original), runBefore = lost.clone(lost.state.aiRun);
  lost.control.now = new Date(lost.control.now.getTime() + 100001);
  const originalLease = receiptLease(lost, original);
  await lostRoot.accounting.reconcile({ taskId: 'task-a', lease: originalLease, chargeId: original.id, evidenceRef: `overhead:${original.id}` });
  assert.deepEqual(lost.state.aiTaskRunOverhead.find(row => row.id === original.id), originalReceipt);
  assert.deepEqual(lost.state.aiRun, runBefore, 'time reconciliation neither renews nor releases the old holder');
  assert.equal(lost.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.equal(lost.state.aiTaskExecutionBudget[0].consumedActiveMs, oldBudget[0].consumedActiveMs);
  assert.deepEqual(lost.state.aiTaskExecutionBudget, oldBudget, 'original already-settled final receipt never charges its time twice');
  assert.equal(lost.state.aiTaskExecutionBudget[0].consumedSteps, oldBudget[0].consumedSteps);
  assert.deepEqual(lost.executions, ['input-clarify', 'input-continue']);
  const final = lost.clone(lost.state);
  await assert.rejects(lostRoot.accounting.reconcile({ taskId: 'task-a', lease: { ...originalLease, revision: originalLease.revision + 1 }, chargeId: original.id, evidenceRef: `overhead:${original.id}` }), error => error.code === 'AI_ACCESS_DENIED');
  lost.identity.session = false;
  await assert.rejects(lostRoot.accounting.reconcile({ taskId: 'task-a', lease: originalLease, chargeId: original.id, evidenceRef: `overhead:${original.id}` }), error => error.code === 'AI_ACCESS_DENIED' || [401, 403].includes(error.getStatus?.()));
  assert.deepEqual(lost.state, final);
});

test('final released Run measurement and original ledger settle atomically without recreating timing or business work', async () => {
  for (const mode of ['normal', 'rollback', 'lost', 'revoked']) {
    const h = await authorizedRunnerHarness(), root = h.compose();
    const releaseRun = root.runner.deps.leases.releaseRun; let beforeLease, receipt, finalId, releasedRun, originalIds, injected = false;
    root.runner.deps.leases.releaseRun = async command => {
      beforeLease = { taskId: command.taskId, runId: command.runId, holderId: command.holderId,
        revision: command.expectedRunRevision, fencingToken: command.expectedFencingToken,
        expiresAt: h.state.aiRun[0].leaseExpiresAt.toISOString() };
      receipt = await releaseRun(command); h.control.tick += 18; return receipt;
    };
    h.storeControl.beforeWrite = async (name, args) => {
      if (!receipt || h.state.aiRun[0].leaseOwnerId !== null) return;
      assert.ok(['aiTaskRunOverhead', 'aiTaskExecutionCharge', 'aiTaskExecutionBudget'].includes(name), 'after release only original time receipt/accounting writes remain');
      if (name === 'aiTaskRunOverhead' && args.data?.completedAt) {
        finalId = args.where.id; releasedRun = h.clone(h.state.aiRun);
        originalIds = h.state.aiTaskExecutionCharge.map(row => row.chargeId); h.control.tick += 5;
      }
      if (mode === 'revoked' && finalId && name === 'aiTaskExecutionBudget') h.identity.session = false;
    };
    h.storeControl.beforeCommit = async draft => {
      if (!finalId || injected || !draft.aiTaskRunOverhead.find(row => row.id === finalId)?.completedAt
        || draft.aiTaskExecutionCharge.find(row => row.chargeId === finalId)?.status !== 'RECORDED') return;
      injected = true; h.control.tick += 7;
      if (mode === 'rollback') throw Error('synthetic final original accounting rollback');
      if (mode === 'lost') h.storeControl.loseReply = true;
    };
    if (mode === 'normal') assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
    else await assert.rejects(root.runner.run(h.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
    assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.deepEqual(h.state.aiRun, releasedRun);
    assert.deepEqual(h.state.aiTaskExecutionCharge.map(row => row.chargeId), originalIds, 'final accounting cannot allocate another interval or action');
    assert.equal(h.state.aiTaskResultArtifact.filter(row => row.completeMeasurement).length, 2);
    const final = h.state.aiTaskRunOverhead.find(row => row.id === finalId), charge = h.state.aiTaskExecutionCharge.find(row => row.chargeId === finalId);
    const current = { ...beforeLease, revision: receipt.revision, expiresAt: '' };
    h.identity.session = true;
    if (mode === 'normal' || mode === 'lost') {
      assert.equal(injected, true); assert.equal(final.activeMs, 18n); assert.equal(charge.status, 'RECORDED');
      assert.equal(charge.actualAmount, final.activeMs); assert.equal(charge.evidenceRef, `overhead:${finalId}`);
      assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 38n);
      assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
      const budget = h.clone(h.state.aiTaskExecutionBudget), measurement = h.clone(final);
      await root.accounting.reconcile({ taskId: beforeLease.taskId, lease: current, chargeId: finalId, evidenceRef: `overhead:${finalId}` });
      assert.deepEqual(h.state.aiTaskExecutionBudget, budget); assert.deepEqual(final, measurement);
    } else {
      assert.equal(final.completedAt, null); assert.equal(final.activeMs, null); assert.equal(charge.actualAmount, null);
      assert.ok(['RESERVED', 'UNKNOWN'].includes(charge.status));
      assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
      assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, charge.amount);
      await assert.rejects(root.accounting.reconcile({ taskId: beforeLease.taskId, lease: current,
        chargeId: finalId, evidenceRef: `overhead:${finalId}` }), error => error.code === 'AI_ACCESS_DENIED');
    }
    const stored = h.clone(h.state);
    await assert.rejects(root.runner.deps.resources.overhead.completeAfterRelease({ key: finalId, remainingMs: 100 }, beforeLease, receipt), error => error.code === 'AI_RESULT_UNKNOWN');
    await assert.rejects(root.accounting.reserve({ taskId: beforeLease.taskId, lease: current, chargeId: 'no-final-time-successor',
      resource: 'active_ms', amount: 1n, target: { kind: 'run' } }), error => error.code === 'AI_ACCESS_DENIED');
    assert.deepEqual(h.state, stored);
  }
});

test('original release acknowledgement remains metered without creating a lease or retrying ambiguous release', async () => {
  const prepare = async () => {
    const h = await authorizedRunnerHarness(), configuration = h.configuration();
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
    return { h, root: compose(configuration) };
  };
  const { h: direct, root: d } = await prepare(), before = await d.authorization.tasks.claimRun(direct.claim());
  await d.runner.deps.resources.open(before, false);
  const overhead = d.runner.deps.resources.overhead, ticket = await overhead.begin(before, 'release-observation', 100, false, false);
  direct.control.tick += 11;
  const released = await d.authorization.tasks.releaseRun({ taskId: before.taskId, runId: before.runId, holderId: before.holderId,
    expectedTaskRevision: direct.state.aiTask[0].revision, expectedRunRevision: before.revision, expectedFencingToken: before.fencingToken });
  direct.control.tick += 17;
  const releasedRun = direct.clone(direct.state.aiRun);
  direct.storeControl.beforeWrite = async name => { if (name === 'aiRun') throw Error('released original-time closure must not write Run metadata'); };
  let entered = false;
  await assert.rejects(d.evidence.withReleasedAccountingRun(before, { released: true, revision: released.revision + 1 },
    async () => { entered = true; }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(entered, false);
  await assert.rejects(overhead.completeAfterRelease(ticket, before, { released: true, revision: released.revision + 1 }), error => error.code === 'AI_RESULT_UNKNOWN');
  await overhead.completeAfterRelease(ticket, before, { released: true, revision: released.revision });
  const current = { ...before, revision: released.revision, expiresAt: '' }, snapshot = direct.clone(direct.state);
  assert.equal(direct.state.aiTask[0].status, 'RUNNING'); assert.equal(direct.state.aiRun[0].leaseOwnerId, null);
  assert.equal(direct.state.aiTaskExecutionBudget[0].consumedActiveMs, 28n);
  assert.equal(direct.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
  assert.deepEqual(direct.state.aiRun, releasedRun, 'closing time changes neither released CAS/fence/deadline nor metadata');
  await d.accounting.reconcile({ taskId: before.taskId, lease: current, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` });
  await assert.rejects(d.accounting.reserve({ taskId: before.taskId, lease: current, chargeId: 'released-cannot-reserve',
    resource: 'active_ms', amount: 1n, target: { kind: 'run' } }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(d.evidence.assertExecutable(current), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(d.evidence.withAccountingRun(current, async () => { entered = true; }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(overhead.begin(current, 'released-cannot-start', 100, false, false), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(overhead.completeAfterRelease(ticket, before, { released: true, revision: released.revision }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(direct.state, snapshot, 'released original time neither changes the Run nor grants new work');
  assert.deepEqual(direct.executions, []);

  const { h, root } = await prepare(); let releases = 0;
  const releaseRun = root.runner.deps.leases.releaseRun;
  root.runner.deps.leases.releaseRun = async command => { releases++; const receipt = await releaseRun(command); h.control.tick += 18; return receipt; };
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(releases, 1); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskRunOverhead.at(-1).activeMs, 18n, 'original release reply, not a new unreserved interval');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 38n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);

  for (const mode of ['lost', 'malformed', 'other-generation']) {
    const { h, root } = await prepare(); let attempts = 0;
    const release = root.runner.deps.leases.releaseRun;
    root.runner.deps.leases.releaseRun = async command => {
      attempts++; const receipt = await release(command); h.control.tick += 18;
      if (mode === 'lost') throw Error('synthetic release COMMIT reply lost');
      if (mode === 'malformed') return { ...receipt, released: false };
      // Explicit negative row double, not an authorized successor claim.
      const run = h.state.aiRun[0]; run.revision++; run.fencingToken = run.fencingToken.add(1);
      run.leaseOwnerId = 'other-holder'; run.leaseExpiresAt = new Date(h.control.now.getTime() + 100000);
      return receipt;
    };
    await assert.rejects(root.runner.run(h.claim()), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.equal(attempts, 1, mode); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
    assert.equal(h.state.aiTask[0].status, 'SUCCEEDED');
    const interval = h.state.aiTaskRunOverhead.at(-1);
    const charge = h.state.aiTaskExecutionCharge.find(row => row.chargeId === interval.id);
    assert.equal(interval.completedAt, null, mode); assert.equal(charge.actualAmount, null, mode);
    assert.ok(['RESERVED', 'UNKNOWN'].includes(charge.status));
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, charge.amount, 'uncertain release does not refund its original occupancy');
    if (mode === 'other-generation') assert.equal(h.state.aiRun[0].leaseOwnerId, 'other-holder');
  }
});

test('original pure Run time debt admits only same-plan recovery observation without resetting quotas or starting pending work', async () => {
  const prepare = async () => {
    const h = await authorizedRunnerHarness(), root = h.compose();
    let held = await root.authorization.tasks.claimRun(h.claim());
    await root.runner.deps.resources.open(held, false);
    const ticket = await root.runner.deps.resources.overhead.begin(held, 'original-pre-step-debt', 100, false, false);
    const registered = await root.runner.deps.steps.register(h.plan.steps[0], held);
    held = { ...held, revision: registered.runRevision };
    await root.runner.deps.resources.overhead.abandon(ticket, held);
    await root.authorization.tasks.releaseRun({ taskId: held.taskId, runId: held.runId, holderId: held.holderId,
      expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: held.revision, expectedFencingToken: held.fencingToken });
    return { h, root, ticket };
  };
  const { h, root, ticket } = await prepare(), before = h.clone(h.state);
  const recovery = await root.authorization.tasks.claimRecoveryRun({ ...h.claim(), holderId: 'same-original-time-observer' });
  assert.equal(recovery.purpose, 'recovery_only');
  await root.authorization.tasks.assertRecoveryRun(recovery);
  assert.deepEqual(h.state.aiTask, before.aiTask); assert.deepEqual(h.state.aiStep, before.aiStep);
  assert.deepEqual(h.state.aiTaskRunPlan, before.aiTaskRunPlan); assert.deepEqual(h.state.aiTaskActionInput, before.aiTaskActionInput);
  assert.deepEqual(h.state.aiTaskExecutionBudget, before.aiTaskExecutionBudget);
  await assert.rejects(root.accounting.reconcile({ taskId: recovery.taskId, lease: recovery, chargeId: ticket.key,
    evidenceRef: `overhead:${ticket.key}` }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiStep[0].status, 'PENDING'); assert.equal(h.state.aiStep[0].resultRef, null);
  assert.equal(h.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n); assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.deepEqual(h.executions, []);
  assert.deepEqual(await root.runner.recover(recovery), { status: 'unavailable', completedSteps: 0,
    cleanupFailed: 0, nextAction: 'manual_handoff' });
  assert.deepEqual(h.state.aiTask, before.aiTask); assert.deepEqual(h.state.aiStep, before.aiStep);
  assert.deepEqual(h.state.aiTaskRunPlan, before.aiTaskRunPlan); assert.deepEqual(h.state.aiTaskActionInput, before.aiTaskActionInput);
  assert.deepEqual(h.state.aiTaskExecutionCharge.find(row => row.chargeId === ticket.key), before.aiTaskExecutionCharge[0]);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.deepEqual(h.executions, []);
  for (const mutate of [
    x => { x.state.aiTaskRunPlan = []; },
    x => { x.state.aiTaskExecutionCharge[0].status = 'RECORDED'; },
    x => { x.state.aiTaskExecutionCharge[0].stepId = x.state.aiStep[0].id; },
    x => { x.state.aiTaskExecutionCharge[0].resource = 'CALLS'; },
    x => { x.state.aiTaskExecutionCharge[0].gatewayInvocationId = 'not-pure-time'; }
  ]) {
    const { h: other, root: candidate } = await prepare(); mutate(other);
    const snapshot = other.clone(other.state);
    await assert.rejects(candidate.authorization.tasks.claimRecoveryRun({ ...other.claim(), holderId: 'cannot-use-an-arbitrary-trace' }),
      error => error.code === 'AI_REVISION_CONFLICT');
    assert.deepEqual(other.state, snapshot); assert.deepEqual(other.executions, []);
  }
});

test('lost PENDING step admission recovers the same Run to manual observation without dispatch or changing original charges', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  let held = await root.authorization.tasks.claimRun(h.claim());
  await root.runner.deps.resources.open(held, false);
  const registered = await root.runner.deps.steps.register(h.plan.steps[0], held);
  held = { ...held, revision: registered.runRevision };
  const reserveStep = root.accounting.reserveStep.bind(root.accounting);
  root.accounting.reserveStep = async inputs => {
    await reserveStep(inputs);
    throw Error('synthetic_pending_admission_commit_reply_lost');
  };
  await assert.rejects(root.runner.deps.resources.reserve({ plan: h.plan.steps[0], registered }, held),
    error => error.code === 'AI_RESULT_UNKNOWN');
  const original = h.clone(h.state), actionId = h.state.aiStep[0].actionId;
  assert.equal(h.state.aiTaskExecutionCharge.length, 3);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RESERVED'));
  h.control.now = new Date(h.control.now.getTime() + 100001);
  const assertOriginalAdmission = () => {
    const originalIds = new Set(original.aiTaskExecutionCharge.map(row => row.chargeId));
    assert.deepEqual(h.state.aiTaskExecutionCharge.filter(row => originalIds.has(row.chargeId)), original.aiTaskExecutionCharge);
    const observations = h.state.aiTaskExecutionCharge.filter(row => !originalIds.has(row.chargeId));
    assert.ok(observations.every(row => row.resource === 'ACTIVE_MS' && row.stepId === null && row.actionId === null
      && row.gatewayInvocationId === null && row.status === 'RECORDED' && row.actualAmount !== null));
    const before = original.aiTaskExecutionBudget[0], after = h.state.aiTaskExecutionBudget[0];
    for (const field of ['policyVersion', 'policyFingerprint', 'maxSteps', 'maxCalls', 'maxActiveMs', 'maxOutputBytes',
      'reservedSteps', 'reservedCalls', 'reservedActiveMs', 'reservedOutputBytes', 'consumedSteps', 'consumedCalls', 'consumedOutputBytes']) {
      assert.deepEqual(after[field], before[field]);
    }
    assert.equal(after.consumedActiveMs, before.consumedActiveMs + observations.reduce((sum, row) => sum + row.actualAmount, 0n));
  };
  const recovered = await root.runner.run({ ...h.claim(), holderId: 'pending-admission-observer', recovery: true });
  assert.deepEqual(recovered, { status: 'unknown', completedSteps: 0, cleanupFailed: 0 });
  assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.equal(h.state.aiStep[0].status, 'PENDING'); assert.equal(h.state.aiStep[0].actionId, actionId);
  assert.deepEqual(h.state.aiStep, original.aiStep);
  assertOriginalAdmission();
  assert.deepEqual(h.state.aiTaskRunPlan, original.aiTaskRunPlan);
  assert.deepEqual(h.state.aiTaskActionInput, original.aiTaskActionInput);
  assert.equal(h.state.aiTaskResultArtifact.length, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.deepEqual(h.executions, []);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  const replay = await root.runner.run({ ...h.claim(), holderId: 'pending-admission-second-observer', recovery: true });
  assert.deepEqual(replay, recovered); assert.deepEqual(h.executions, []);
  assertOriginalAdmission();
  h.identity.session = false;
  const beforeRevocation = h.clone(h.state);
  await assert.rejects(root.runner.run({ ...h.claim(), holderId: 'revoked-pending-observer', recovery: true }));
  assert.deepEqual(h.state, beforeRevocation);
  assertOriginalAdmission();
});

test('explicit original PENDING start separates retained time debt from a first action without replay or false task success', async () => {
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const prepare = async (amount = 100) => {
    const h = await authorizedRunnerHarness({ aiTaskActionInput: [], aiTaskExecutionPhaseStart: [] });
    const configuration = h.configuration();
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => clearTimeout(timer) };
    const root = compose(configuration);
    // This is an explicitly persisted synthetic input, not a fabricated
    // production no-dispatch adapter or a client-side authorization flag.
    h.state.aiTaskActionInput.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', id: 'input-clarify',
      registrationRef: 'clarify', toolCode: 'rental.order.explain', toolVersion: '1',
      payload: h.inputFor('clarify'), fingerprint: requestFingerprint(h.inputFor('clarify')) });
    let held = await root.authorization.tasks.claimRun(h.claim());
    await root.runner.deps.resources.open(held, false);
    const ticket = await root.runner.deps.resources.overhead.begin(held, 'original-before-first-action', amount, false, false);
    const registered = await root.runner.deps.steps.register(h.plan.steps[0], held);
    held = { ...held, revision: registered.runRevision };
    await root.runner.deps.resources.overhead.abandon(ticket, held);
    await root.authorization.tasks.releaseRun({ taskId: held.taskId, runId: held.runId, holderId: held.holderId,
      expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: held.revision, expectedFencingToken: held.fencingToken });
    return { h, root, ticket };
  };
  const { h, root, ticket } = await prepare(), before = h.clone(h.state), actionId = h.state.aiStep[0].actionId;
  await assert.rejects(root.runner.run({ ...h.claim(), holderId: 'ordinary-worker-cannot-auto-continue' }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(h.executions, []); assert.deepEqual(h.state.aiTaskExecutionBudget, before.aiTaskExecutionBudget);
  // The refused worker still owns its original live lease. Advance only the
  // explicit wall-clock double; expiry itself is NOT our no-execution proof.
  h.control.now = new Date(h.control.now.getTime() + 100001);
  const application = new (require('../apps/api/src/modules/ai-native/runner/prisma-task-application').PrismaTaskApplication)({
    db: h.db, tasks: root.authorization.tasks, runner: root.runner, inputs: root.inputs,
    // Not exercised by start: explicit discovery-only fixture boundaries.
    recovery: { read: async () => { throw Error('unused discovery'); } }, events: { readPage: async () => { throw Error('unused events'); } },
    host: { holderId: 'explicit-original-pending-first-start', leaseMs: 100000 } });
  await assert.rejects(application.start({ taskId: 'task-a', runId: 'run-a', pendingStart: true }), error => error.code === 'AI_INVALID_INPUT');
  const start = await application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(start.kind, 'run_outcome'); const outcome = start.outcome;
  assert.equal(outcome.status, 'unavailable'); assert.equal(outcome.nextAction, 'manual_handoff');
  assert.equal(outcome.completedSteps, 2); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiStep[0].actionId, actionId); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTask[0].status, 'RUNNING', 'unknown original accounting must not become a fully successful aggregate');
  assert.deepEqual(h.state.aiTaskRunPlan, before.aiTaskRunPlan); assert.deepEqual(h.state.aiTaskActionInput, before.aiTaskActionInput);
  assert.deepEqual(h.state.aiTaskRunOverhead.find(row => row.id === ticket.key), before.aiTaskRunOverhead[0]);
  assert.deepEqual(h.state.aiTaskExecutionCharge.find(row => row.chargeId === ticket.key), before.aiTaskExecutionCharge[0]);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs, 100n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs,
    h.state.aiTaskResultArtifact.reduce((n, row) => n + row.activeMs, 0n)
    + h.state.aiTaskRunOverhead.filter(row => row.completedAt).reduce((n, row) => n + row.activeMs, 0n));
  const budgetAfter = h.clone(h.state.aiTaskExecutionBudget);
  await assert.rejects(root.runner.run({ ...h.claim(), holderId: 'cannot-replay-after-first-action' }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']); assert.deepEqual(h.state.aiTaskExecutionBudget, budgetAfter);

  for (const mutate of [
    x => { x.state.aiStep[0].effect = 'POSSIBLE'; },
    x => { x.state.aiTaskActionInput[0].payload.phase = 'tampered-original'; },
    x => { x.state.aiTaskResultArtifact.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' }); },
    x => { x.state.aiTaskExecutionPhaseStart.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' }); },
    x => { x.state.aiGatewayInvocation.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' }); },
    x => { x.state.aiTaskExecutionCharge.push({ ...x.clone(x.state.aiTaskExecutionCharge[0]), chargeId: 'original-step-reservation', stepId: x.state.aiStep[0].id }); },
    x => { x.state.aiTaskExecutionCharge[0].actualAmount = 0n; }
  ]) {
    const { h: other, root: candidate } = await prepare(); mutate(other); const snapshot = other.clone(other.state);
    await assert.rejects(candidate.runner.continuePending({ ...other.claim(), holderId: 'cannot-borrow-no-execution-proof' }), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.deepEqual(other.executions, []); assert.deepEqual(other.state.aiStep, snapshot.aiStep);
    assert.deepEqual(other.state.aiTaskExecutionBudget, snapshot.aiTaskExecutionBudget);
    assert.deepEqual(other.state.aiTaskExecutionCharge, snapshot.aiTaskExecutionCharge);
    assert.deepEqual(other.state.aiTaskRunOverhead, snapshot.aiTaskRunOverhead);
  }
  const { h: limited, root: limitedRoot } = await prepare(9999);
  assert.equal((await limitedRoot.runner.continuePending({ ...limited.claim(), holderId: 'original-debt-still-counts' })).status, 'unavailable');
  assert.deepEqual(limited.executions, []); assert.equal(limited.state.aiTaskExecutionBudget[0].reservedActiveMs, 9999n);
  assert.equal(limited.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.equal(limited.state.aiStep[0].status, 'PENDING');
  assert.equal(limited.state.aiTask[0].status, 'RUNNING');
});

for (const mode of ['platform_managed', 'tenant_managed']) test(`current ${mode} service and plan policy drive the actual runner without legacy budget seeding`, async () => {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [] });
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', mode, revision: 1, serviceEnabled: true,
    settings: mode === 'tenant_managed' ? { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://synthetic.example.test/v1',
      model: 'synthetic-model', timeoutMs: 30000, maxConcurrent: 2, maxOutputTokens: 2048 } : null,
    credentialsEncrypted: mode === 'tenant_managed' ? 'v2:synthetic:YWJj:YWJj:YWJj' : null });
  h.state.aiBudgetPolicy = h.state.aiBudgetPolicy.filter(policy => policy.scopeKind === 'PLATFORM');
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.order.explain', version: AI_TOOL_DRAFT_VERSION }], limits: h.clone(h.plan.limits), expiresAt: new Date('2027-01-01') });
  const gates = h.clone(h.state.aiBudgetPolicy);
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.deepEqual(h.state.aiBudgetPolicy, gates);
});

for (const field of ['auth', 'credentials', 'subscriptions']) test(`authorized runner requires explicit ${field}`, async () => {
  const h = await authorizedRunnerHarness(), input = h.configuration(); delete input.authorization[field];
  assert.throws(() => compose(input), /AI_RESOURCE_UNAVAILABLE|AI_ACCESS_DENIED/);
  assert.deepEqual(h.executions, []);
});
for (const field of ['registrationAuthority', 'transitionAuthority', 'inputSource', 'planAuthority', 'executors', 'commands']) {
  test(`authorized runner cannot silently default ${field}`, async () => {
    const h = await authorizedRunnerHarness(), input = h.configuration(); delete input[field];
    assert.throws(() => compose(input), /AI_RESOURCE_UNAVAILABLE|AI_ACCESS_DENIED/);
  });
}

test('caller-supplied permissive tasks and execution gate cannot replace the composed persisted authority', async () => {
  const h = await authorizedRunnerHarness(); h.state.aiBudgetPolicy[0].enabled = false;
  const root = compose({ ...h.configuration(), tasks: h.tasks, executionAuthorization: { authorize: async () => h.context() } });
  await assert.rejects(root.runner.run(h.claim()));
  assert.deepEqual(h.executions, []); assert.equal(h.state.aiStep.length, 0);
});

for (const [name, mutate] of Object.entries({
  'missing task policy': h => { h.state.aiTaskActionPolicy = []; },
  'missing platform gate': h => { h.state.aiBudgetPolicy = h.state.aiBudgetPolicy.slice(1); },
  'unreleased AI feature': h => { h.state.subscriptionFeatureCatalog[0].releaseStatus = 'PLANNED'; },
  'expired subscription': h => { h.state.tenant[0].subscription.endAt = h.control.now; },
  'revoked membership': h => { h.identity.membership = false; }
})) test(`actual composed runner denies ${name} without seeding replacements`, async () => {
  const h = await authorizedRunnerHarness(); mutate(h); const before = h.clone(h.state);
  await assert.rejects(h.compose().runner.run(h.claim()));
  assert.deepEqual(h.executions, []); assert.deepEqual(h.state, before);
});

test('authorized cumulative resource stop keeps its completed prefix and closes the original task without new charges', { timeout: 60000 }, async () => {
  for (const resource of ['output_bytes', 'active_ms']) {
    const h = await authorizedRunnerHarness();
    if (resource === 'output_bytes') h.control.execute = async () => ({ kind: 'succeeded', payload: 'x'.repeat(4094) });
    else {
      // Set this synthetic trusted plan before execution/budget initialization;
      // do not change an existing task's policy or counters to manufacture a stop.
      const fingerprint = require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint;
      // Keep the old exact 1000ms boundary: the new pre-tool interval cannot
      // borrow the whole next-step reservation. It must stop before any effect.
      const exact = await authorizedRunnerHarness();
      exact.plan.limits.maxTotalMs = 1000;
      exact.state.aiTaskRunPlan[0].payload.limits.maxTotalMs = 1000;
      exact.state.aiTaskRunPlan[0].planHash = fingerprint(exact.state.aiTaskRunPlan[0].payload);
      const exactResult = await exact.compose().runner.run(exact.claim());
      assert.equal(exactResult.status, 'failed'); assert.equal(exactResult.errorCode, 'AI_RUN_LIMIT');
      assert.deepEqual(exact.executions, []);
      assert.deepEqual(exact.state.aiStep.map(step => [step.status, step.effect]), [['PENDING', 'NONE']]);
      assert.equal(exact.state.aiTaskExecutionCharge.filter(charge => charge.stepId !== null).length, 0);
      assert.equal(exact.state.aiTaskExecutionCharge.length, 2, 'only startup and the admitted first-step orchestration, no step resource charges');
      assert.ok(exact.state.aiTaskExecutionCharge.every(charge => charge.stepId === null && charge.status === 'RECORDED'));
      assert.deepEqual(exact.state.aiTaskRunOverhead.map(row => row.segment), ['startup', 'pre:clarify']);
      assert.equal(exact.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
      assert.equal(exact.state.aiTaskExecutionBudget[0].reservedActiveMs, 0n);
      // The entire original quota may have been spent in prior orchestration.
      // Do not invent a tail or a terminal receipt when registration cannot fit.
      const exhausted = await authorizedRunnerHarness(), e = exhausted.compose();
      const held = await e.authorization.tasks.claimRun(exhausted.claim());
      await e.runner.deps.resources.open(held, false);
      const prior = await e.runner.deps.resources.overhead.begin(held, 'prior-orchestration', 10000, false, false);
      exhausted.control.tick += 10000;
      await e.runner.deps.resources.overhead.complete(prior, held);
      await e.authorization.tasks.releaseRun({ taskId: held.taskId, runId: held.runId, holderId: held.holderId,
        expectedTaskRevision: exhausted.state.aiTask[0].revision, expectedRunRevision: held.revision, expectedFencingToken: held.fencingToken });
      const originalBudget = exhausted.clone(exhausted.state.aiTaskExecutionBudget);
      assert.deepEqual(await exhausted.compose().runner.run(exhausted.claim()),
        { status: 'unavailable', completedSteps: 0, cleanupFailed: 0, nextAction: 'manual_handoff' });
      assert.deepEqual(exhausted.state.aiTaskExecutionBudget, originalBudget);
      assert.equal(exhausted.state.aiTask[0].status, 'RUNNING');
      assert.equal(exhausted.state.aiStep.length, 0);
      assert.equal(exhausted.state.aiTaskExecutionCharge.length, 1);
      assert.deepEqual(exhausted.executions, []);
      // Separate one-millisecond headroom fixture, below the original 10000ms
      // policy: first effect fits; its 10ms makes another full 1000ms step fail.
      // Neither an existing production policy nor a stored budget is raised.
      h.plan.limits.maxTotalMs = 1001;
      const saved = h.state.aiTaskRunPlan[0]; saved.payload.limits.maxTotalMs = 1001;
      saved.planHash = fingerprint(saved.payload);
    }
    const configuration = h.configuration();
    configuration.clock = { now: () => h.control.tick, setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: timer => clearTimeout(timer) };
    const root = compose(configuration), result = await root.runner.run(h.claim());
    assert.deepEqual(result, { status: 'partially_succeeded', completedSteps: 1, cleanupFailed: 0 });
    assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiTask[0].status, 'PARTIALLY_SUCCEEDED');
    assert.equal(h.state.aiRun[0].status, 'PARTIALLY_SUCCEEDED'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
    assert.deepEqual(h.state.aiStep.map(step => [step.status, step.effect]), [['SUCCEEDED', 'NONE'], ['PENDING', 'NONE']]);
    assert.equal(h.state.aiTaskRunPlan[0].payload.steps[1].registrationRef, 'continue', 'pending tail retains the immutable original plan identity');
    assert.equal(h.state.aiTaskResultArtifact.length, 1); assert.equal(h.state.aiStep[0].resultRef, h.state.aiTaskResultArtifact[0].id);
    const stepCharges = h.state.aiTaskExecutionCharge.filter(charge => charge.stepId !== null);
    assert.equal(stepCharges.length, 3); assert.ok(h.state.aiTaskExecutionCharge.every(charge => charge.status === 'RECORDED'));
    assert.ok(stepCharges.every(charge => charge.stepId === h.state.aiStep[0].id));
    const overheadCharges = h.state.aiTaskExecutionCharge.filter(charge => charge.stepId === null);
    assert.ok(overheadCharges.length >= 2);
    assert.ok(overheadCharges.every(charge => charge.resource === 'ACTIVE_MS' && h.state.aiTaskRunOverhead.some(row => row.id === charge.chargeId && row.completedAt)));
    const budget = h.state.aiTaskExecutionBudget[0];
    assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(budget.consumedSteps, 1n); assert.equal(budget.consumedActiveMs, 10n);
    assert.equal(budget.consumedOutputBytes, h.state.aiTaskResultArtifact[0].outputBytes);
    if (resource === 'output_bytes') assert.equal(budget.consumedOutputBytes, 4096n);
    for (const field of ['reservedSteps', 'reservedCalls', 'reservedActiveMs', 'reservedOutputBytes']) assert.equal(budget[field], 0n);
    assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(budget.consumedCalls, 0n, 'business reads are not model calls');
    const terminal = h.state.aiTaskEvent.at(-1);
    assert.deepEqual(terminal.payload.data, { from: 'running', to: 'partially_succeeded', reason: 'completed' });
    const facts = h.clone(h.state), executions = [...h.executions];
    assert.equal((await root.authorization.tasks.readMetadata('task-a')).status, 'partially_succeeded');
    await assert.rejects(root.runner.run(h.claim()));
    assert.deepEqual(h.executions, executions); assert.deepEqual(h.state, facts, 'terminal receipt is not a new task or reset allowance');
  }
});

test('resource preflight checks all original counters before reservation and never reclassifies a later reservation error', async () => {
  const { AiTaskRunnerError } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');
  const { AiTaskExecutionBudgetError } = require('../apps/api/src/modules/ai-native/task-execution-budget.ports');
  const h = await authorizedRunnerHarness(), root = h.compose(), deps = root.runner.deps;
  let lease = await root.authorization.tasks.claimRun(h.claim());
  await deps.resources.open(lease, false);
  const registered = await deps.steps.register(h.plan.steps[0], lease);
  lease = { ...lease, revision: registered.runRevision };
  const ref = { plan: h.plan.steps[0], registered }, source = deps.resources.source;
  const findBudget = h.db.aiTaskExecutionBudget.findUnique.bind(h.db.aiTaskExecutionBudget);
  const catalog = source.catalog.resolve.bind(source.catalog), before = h.clone(h.state);
  // Only the returned read snapshot is a boundary double. No stored counter,
  // original ledger, action result or grant is rewritten to manufacture evidence.
  const limits = { steps: ['consumedSteps', 'maxSteps'], active_ms: ['consumedActiveMs', 'maxActiveMs'],
    output_bytes: ['consumedOutputBytes', 'maxOutputBytes'], calls: ['consumedCalls', 'maxCalls'] };
  let reserves = 0, unknowns = 0;
  const reserve = root.accounting.reserve.bind(root.accounting), markUnknown = root.accounting.markUnknown.bind(root.accounting);
  const reserveStep = root.accounting.reserveStep.bind(root.accounting);
  root.accounting.reserve = (...args) => { reserves++; return reserve(...args); };
  root.accounting.reserveStep = (...args) => { reserves++; return reserveStep(...args); };
  root.accounting.markUnknown = (...args) => { unknowns++; return markUnknown(...args); };
  for (const [resource, [consumed, maximum]] of Object.entries(limits)) {
    h.db.aiTaskExecutionBudget.findUnique = async args => { const budget = await findBudget(args); return { ...budget, [consumed]: budget[maximum] }; };
    source.catalog.resolve = async () => ({ modelCall: resource === 'calls' });
    source.invocations = { prepare: async () => assert.fail('an exhausted call allowance cannot prepare an invocation') };
    await assert.rejects(deps.resources.reserve(ref, lease), error => error instanceof AiTaskRunnerError && error.code === 'AI_RUN_LIMIT');
    assert.equal(reserves, 0); assert.equal(unknowns, 0); assert.deepEqual(h.state, before);
  }
  h.db.aiTaskExecutionBudget.findUnique = findBudget; source.catalog.resolve = catalog; source.invocations = undefined;
  // Even the same error code emitted after a reserve attempt is not the
  // read-only preflight proof. Exercise the actual atomic entry; no complete
  // ticket was acknowledged, so proposed IDs cannot authorize cleanup writes.
  root.accounting.reserveStep = async () => { reserves++; throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT'); };
  await assert.rejects(deps.resources.reserve(ref, lease), error => error instanceof AiTaskExecutionBudgetError
    && error.code === 'AI_RESULT_UNKNOWN' && !(error instanceof AiTaskRunnerError));
  assert.equal(reserves, 1); assert.equal(unknowns, 0); assert.deepEqual(h.state, before);
});

test('disabled AI denies new claims while lawful metadata and lease cleanup still use current action policy', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  const lease = await root.authorization.tasks.claimRun(h.claim());
  h.state.aiBudgetPolicy[0].enabled = false;
  assert.equal((await root.authorization.tasks.readMetadata('task-a')).status, 'running');
  assert.equal((await root.authorization.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: lease.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken })).released, true);
  await assert.rejects(root.authorization.tasks.claimRun(h.claim()));
  assert.deepEqual(h.executions, []);
});
